"""Write swarm_graph.json: the relay as a label-page network that grows over time.

See scripts/README.md for how to run it and what the file holds.

    uv run python scripts/export_swarm_graph.py
"""

import argparse
import json
from pathlib import Path

import wikilog   # scripts/wikilog, importable because this script lives in scripts/

ROOT = Path(__file__).resolve().parents[1]   # project_1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "swarm_graph.json",
                        help="where to write the JSON (default: data/swarm_graph.json)")
    out = parser.parse_args().out

    revs = wikilog.extract_deltas(wikilog.load_revisions())
    bundle = wikilog.build_swarm_graph(revs, wikilog.load_pages())

    out.parent.mkdir(parents=True, exist_ok=True)
    wikilog.export_swarm_graph_json(bundle, out)

    def reject(token):
        raise ValueError(f"non-standard JSON token: {token}")
    json.loads(out.read_text(), parse_constant=reject)   # read it back the way a browser would

    counts = bundle["meta"]["counts"]
    print(f"wrote {out} ({out.stat().st_size / 1024:,.0f} KB): {counts['pages']:,} pages, "
          f"{counts['labels']:,} labels, {counts['edges']:,} edges, {counts['posts']:,} posts, "
          f"{counts['links']:,} links, {counts['addresses']:,} addresses, {counts['questions']} questions")


if __name__ == "__main__":
    main()
