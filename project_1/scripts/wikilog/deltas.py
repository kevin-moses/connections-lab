"""What each revision actually added.

Why this module exists
----------------------
``revision.body`` is cumulative: agents paste the existing page back and write
below it, so a paragraph posted once on a 342-revision page appears in all 342
bodies. Counting anything over ``body`` inflates it by page popularity -- the
very thing under study. The unit of analysis is therefore the DELTA: the lines a
revision introduced relative to its predecessor.

How deltas are recovered
------------------------
Each revision ships ``hunks``, a diff against its ``diff_base``. In the analysis
repository, validate_hunks() re-derives every published hunk list from the bodies
and reproduces all 10,012 of them exactly, which pins down the conventions used
here:

* lines come from ``body.split("\\n")``, NOT ``splitlines()``. A body ending in a
  newline yields a trailing empty element, and the published hunks count it.
* hunks are ``difflib.SequenceMatcher(None, a, b, autojunk=False)`` opcodes with
  the "equal" ones removed, where ``a`` is the base's lines and ``b`` this
  revision's lines.
* ``(b0, b1)`` indexes THIS revision's lines, so the text added by an "insert"
  or "replace" op is ``b_lines[b0:b1]``.
"""

from __future__ import annotations

import pandas as pd

_ADDING_OPS = ("insert", "replace")
_REMOVING_OPS = ("delete", "replace")

DELTA_COLUMNS = ["added_text", "added_lines", "added_chars",
                 "removed_lines", "delta_kind", "is_full_body"]


def _whole_body_row(body: str, kind: str) -> dict:
    """A revision with no usable base: the 'delta' is the entire page."""
    return {"added_text": body, "added_lines": len(body.split("\n")),
            "added_chars": len(body), "removed_lines": 0,
            "delta_kind": kind, "is_full_body": True}


def _diff_row(body: str, base_body: str, hunks: list[dict]) -> dict:
    """A revision diffed against its base: keep only the lines it introduced."""
    b_lines = body.split("\n")
    base_lines = base_body.split("\n")

    added = [line for h in hunks if h["op"] in _ADDING_OPS
             for line in b_lines[h["b0"]:h["b1"]]]
    removed = sum(h["a1"] - h["a0"] for h in hunks if h["op"] in _REMOVING_OPS)

    # An insert "below everything on the page" starts at or after the base's last
    # non-blank line. Comparing against len(base_lines) instead would miss most
    # appends: a body ending in a newline splits to a trailing "", so text added
    # at the bottom lands just before that final empty element.
    content_end = len(base_lines)
    while content_end and not base_lines[content_end - 1].strip():
        content_end -= 1
    tail_inserts = sum(1 for h in hunks if h["op"] == "insert" and h["a0"] >= content_end)

    if not hunks:
        kind = "noop"
    elif added and removed:
        kind = "edit"
    elif added:
        kind = "append" if tail_inserts == len(hunks) else "edit"
    else:
        kind = "prune"

    added_text = "\n".join(added)
    return {"added_text": added_text, "added_lines": len(added),
            "added_chars": len(added_text), "removed_lines": removed,
            "delta_kind": kind, "is_full_body": False}


def extract_deltas(revisions: pd.DataFrame) -> pd.DataFrame:
    """Return ``revisions`` with columns describing what each revision added.

    Added columns
    -------------
    added_text     the lines this revision introduced, joined by newlines
    added_lines    how many lines that is
    added_chars    ``len(added_text)``
    removed_lines  lines removed relative to the base
    delta_kind     how the revision changed the page (below)
    is_full_body   True when ``added_text`` is the whole page rather than an
                   increment. Exclude these rows when asking "what did this
                   agent add to an ongoing conversation?"

    delta_kind
    ----------
    Increments -- a base was available, so ``added_text`` is a true delta:

    ============  ===========================================================
    append        purely additive, below everything already on the page: the
                  bulletin-board move of adding a block without touching
                  anyone else's text
    edit          added text somewhere other than the end, or added and
                  removed lines (rewrote part of the page)
    prune         removed lines only
    noop          the stored body is identical to its base
    ============  ===========================================================

    Whole-body rows -- no usable base, so ``is_full_body`` is True:

    =================  ======================================================
    creation           a genuinely new page (``diff_base_reason`` is
                       "page_created")
    history_truncated  a real edit whose predecessor was withheld from the
                       published cut ("earlier_revisions_not_published");
                       these have seq values like 2, 3 and 87, so they must
                       not be counted as page creations
    base_unavailable   the base exists but is not in ``revisions`` -- the
                       caller filtered it out. Flagged rather than raised, so
                       a filtered analysis degrades visibly instead of
                       crashing
    =================  ======================================================
    """
    bodies = dict(zip(revisions["rev_id"], revisions["body"]))
    rows = []
    for base_id, reason, hunks, body in zip(revisions["diff_base"],
                                            revisions["diff_base_reason"],
                                            revisions["hunks"], revisions["body"]):
        if pd.isna(base_id):
            kind = "creation" if reason == "page_created" else "history_truncated"
            rows.append(_whole_body_row(body, kind))
        elif base_id not in bodies:
            rows.append(_whole_body_row(body, "base_unavailable"))
        else:
            rows.append(_diff_row(body, bodies[base_id], hunks))

    # Passing columns= keeps the schema even when `revisions` is empty.
    delta = pd.DataFrame(rows, columns=DELTA_COLUMNS)
    return pd.concat([revisions.reset_index(drop=True), delta], axis=1)
