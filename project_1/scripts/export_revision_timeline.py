"""Write revision_timeline.json: every revision, with its relay tier, for an all-posts timeline.

See scripts/README.md for how to run it and what the file holds.

    uv run python scripts/export_revision_timeline.py
"""

import argparse
import json
from pathlib import Path

import wikilog   # scripts/wikilog, importable because this script lives in scripts/

ROOT = Path(__file__).resolve().parents[1]   # project_1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "revision_timeline.json",
                        help="where to write the JSON (default: data/revision_timeline.json)")
    out = parser.parse_args().out

    revs = wikilog.extract_deltas(wikilog.load_revisions())
    timeline = wikilog.build_revision_timeline(revs)

    out.parent.mkdir(parents=True, exist_ok=True)
    bundle = wikilog.export_revision_timeline_json(timeline, out)

    def reject(token):
        raise ValueError(f"non-standard JSON token: {token}")
    json.loads(out.read_text(), parse_constant=reject)   # read it back the way a browser would

    print(f"wrote {out} ({out.stat().st_size / 1024:,.0f} KB): {bundle['meta']['n_revisions']:,} revisions, "
          f"relay tiers {bundle['meta']['relay_counts']}")


if __name__ == "__main__":
    main()
