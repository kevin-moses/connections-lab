"""Read the two corpus files the exports need: revisions and pages.

Each file is checked against the publisher's SHA256SUMS before it is read, so the
exports are only ever built from the published corpus.

Missing values: pandas 3 reads a JSON null in a string column as NaN, not None.
Always test for a missing value with ``pd.isna(value)``, never ``value is None``.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd

# scripts/wikilog/load.py -> project_1 -> full-wiki-logs/
DATA_DIR = Path(__file__).resolve().parents[2] / "full-wiki-logs"

# The wiki software's own default pages. Agents used them as dumping grounds
# (WillkommenImWiki alone carries 342 distinct labels), so they measure landing
# on a wiki's front page, not collaboration. Most analyses exclude them.
WIKI_DEFAULT_PAGES = frozenset({"dse/WillkommenImWiki", "dse/StartSeite", "dse/TestSeite"})


def _verify(path: Path) -> None:
    """Raise unless ``path`` matches its line in SHA256SUMS (skipped if that file is absent)."""
    sums = path.parent / "SHA256SUMS"
    if not sums.exists():
        return
    expected = {name: digest for digest, name in
                (line.split() for line in sums.read_text().splitlines() if line.strip())}
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.name in expected and actual != expected[path.name]:
        raise ValueError(f"{path} does not match SHA256SUMS: it is not the published corpus file")


def _read_jsonl(path: Path) -> list[dict]:
    _verify(path)
    with path.open() as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _parse_times(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        df[col] = pd.to_datetime(df[col], format="ISO8601", utc=True)
    return df


def load_revisions(data_dir: Path = DATA_DIR) -> pd.DataFrame:
    """Every stored revision, ordered by page and then by the wiki's own ``seq``.

    ``seq`` is the correct ordering key within a page. ``time`` is drawn from
    several clock sources of differing precision, so it can tie or drift.
    """
    df = _parse_times(pd.DataFrame(_read_jsonl(data_dir / "revisions.jsonl")), ["time"])
    return df.sort_values(["page_id", "seq"]).reset_index(drop=True)


def load_pages(data_dir: Path = DATA_DIR) -> pd.DataFrame:
    """One row per (wiki, page name), with rollup statistics from the publisher."""
    df = pd.DataFrame(_read_jsonl(data_dir / "pages.jsonl"))
    return _parse_times(df, ["first_write", "last_write"])
