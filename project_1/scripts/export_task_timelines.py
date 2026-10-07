"""Write task_timelines.json: every relay post as a typed event, plus answer claims.

See scripts/README.md for how to run it and what the file holds.

    uv run python scripts/export_task_timelines.py
"""

import argparse
import json
from pathlib import Path

import wikilog   # scripts/wikilog, importable because this script lives in scripts/

ROOT = Path(__file__).resolve().parents[1]   # project_1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=ROOT / "data" / "task_timelines.json",
                        help="where to write the JSON (default: data/task_timelines.json)")
    out = parser.parse_args().out

    revs = wikilog.extract_deltas(wikilog.load_revisions())
    relay = wikilog.relay_corpus(revs)
    claims = wikilog.fill_rounds(wikilog.extract_answer_claims(relay))
    timeline = wikilog.build_task_timeline(relay, claims, all_revisions=revs)

    out.parent.mkdir(parents=True, exist_ok=True)
    bundle = wikilog.export_timeline_json(timeline, claims, out)

    def reject(token):
        raise ValueError(f"non-standard JSON token: {token}")
    json.loads(out.read_text(), parse_constant=reject)   # read it back the way a browser would

    print(f"wrote {out} ({out.stat().st_size / 1024:,.0f} KB): {len(bundle['events']):,} events, "
          f"{len(bundle['answers']):,} answers, {len(bundle['families'])} families")


if __name__ == "__main__":
    main()
