"""Agents' own reports of answering a round, parsed into rows.

Agents narrate their runs in a stereotyped way:

    "R4 Visual & Performing Arts arrived exactly task 04:46:01;
     answered 2,134 at 04:46:02"

Three things can be recovered from a report like that: the ROUND, the ANSWER
VALUE, and the LATENCY between the prompt arriving and the answer being given.
Latency is the measure of whether the relay worked: a figure from a statistics
database cannot be looked up in one second, so a one-second answer means the
value was in hand before the question arrived.

Task clocks are local to each cohort and offset from one another, so absolute
task times cannot be compared across agents. A latency is a difference between
two times from the SAME report of the SAME run, so it is valid even though the
absolute times are not.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .text import CLOCK, split_clauses

# "prompt 05:14:47", "arrived exactly task 04:46:01", "arrival 11:28:33"
_PROMPT_AT = re.compile(r"(?:prompt|arrived|arrival)\D{0,25}?(" + CLOCK + r")", re.I)

# "answered 2,134 at 04:46:02", "answered at 04:46:02", "answered 17:33:08".
# "at" is optional: agents often write the time straight after "answered". A clock
# can never be both the prompt and the answer, because only prompts that START
# BEFORE the answer clock are eligible for pairing (see _parse_claim).
_ANSWER_AT = re.compile(r"answer(?:ed)?\s+(?:[\d][\d,.]*\s+)?(?:at\s+)?(" + CLOCK + r")", re.I)

# The value after "answer(ed)", in the corpus's own number format: optional
# thousands separators and an optional decimal part. (?![\d:]) rejects a clock
# ("answered 08:30:32" is a time, not the value 08), and the strict thousands
# grouping stops a trailing comma from being captured ("5,269," -> "5,269").
_ANSWER_VALUE = re.compile(
    r"answer(?:ed)?\s+(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d:])", re.I)

# Round markers: R2 (generic), G4 (grocery), C3 (clothing), Q3 (question), STATE5.
_ROUND_MARKER = re.compile(r"\b(?:R|G|C|Q|STATE)([1-9])\b")
_OPENING_PROMPT = re.compile(r"\binitial\b|\bfirst prompt\b|\bopening prompt\b", re.I)

# Self-reported verdicts. "confirmed" is deliberately NOT a success signal: it is
# the relay's announcement that a round's answer is established ("R4 CONFIRMED:
# Visual & Performing Arts"), and it concentrates in later rounds simply because
# that is when there are answers to announce. It is kept as its own column.
_SAID_WRONG = re.compile(r"\bwrong(?:ly)?\b|\bincorrect(?:ly)?\b", re.I)
_SAID_RIGHT = re.compile(r"\bexact\b|\bcorrect(?:ly)?\b", re.I)
_SAID_CONFIRMED = re.compile(r"\bconfirmed\b", re.I)

CLAIM_COLUMNS = ["rev_id", "time", "label", "task_family", "page_id", "round_num",
                 "answer_value", "prompt_clock", "answer_clock", "latency_s",
                 "said_wrong", "said_right", "said_confirmed", "excerpt"]


def _clock_seconds(clock: str) -> int:
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def round_segments(clause: str) -> list[tuple[int | None, str]]:
    """Cut a clause at every round marker; return ``(round, text)`` per segment.

    Agents often narrate several rounds in one clause:

        "GA prompt 15:15:51 (answered wrong); G2 Arkansas confirmed 15:53:06,
         answered 20,794 at 15:53:07"

    Parsing each claim only from its own segment means a round number, a prompt
    time or a "wrong" from one round can never be credited to another -- here
    the "wrong" belongs to the opening round, and 20,794 to round 2. Text before
    the first marker forms its own segment: round 1 if it describes the opening
    prompt ("initial", "first prompt"), otherwise unknown (None).
    """
    marks = list(_ROUND_MARKER.finditer(clause))
    segments = []
    lead = clause[:marks[0].start()] if marks else clause
    if lead.strip():
        segments.append((1 if _OPENING_PROMPT.search(lead) else None, lead))
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(clause)
        segments.append((int(mark.group(1)), clause[mark.start():end]))
    return segments


def mentioned_rounds(text: str) -> list[int]:
    """Every round a text names with a round marker (R4, G2, STATE5, ...), sorted.

    A post that says "R3 Turkmenistan answered ...; R4 Hungary due 00:47:01"
    mentions rounds 3 and 4, and "R1+105m" (105 minutes after round 1's prompt)
    mentions round 1. Mentioning a round is not answering it. Markers are single
    digits; the corpus has no round above 9.
    """
    return sorted({int(number) for number in _ROUND_MARKER.findall(text)})


def _parse_claim(segment: str, round_num: int | None) -> dict | None:
    """Parse one round segment into a claim, or None if it reports no answer.

    A claim needs an answer value, or an answer time paired with a prompt time.
    The prompt paired with an answer is the NEAREST one before it, so a segment
    that mentions two prompts cannot pair the first prompt with the second
    answer.
    """
    value = _ANSWER_VALUE.search(segment)
    answer_at = _ANSWER_AT.search(segment)
    prompts_before = ([] if answer_at is None else
                      [m for m in _PROMPT_AT.finditer(segment) if m.start(1) < answer_at.start(1)])
    prompt = prompts_before[-1] if prompts_before else None
    if not (value or (prompt and answer_at)):
        return None

    latency = None
    if prompt and answer_at:
        latency = _clock_seconds(answer_at.group(1)) - _clock_seconds(prompt.group(1))
        if latency < -12 * 3600:          # the task clock wrapped past midnight
            latency += 24 * 3600
        if not 0 <= latency <= 3600:
            latency = None

    return {"round_num": round_num,
            "answer_value": value.group(1) if value else None,
            "prompt_clock": prompt.group(1) if prompt else None,
            "answer_clock": answer_at.group(1) if answer_at else None,
            "latency_s": latency,
            "said_wrong": bool(_SAID_WRONG.search(segment)),
            "said_right": bool(_SAID_RIGHT.search(segment)),
            "said_confirmed": bool(_SAID_CONFIRMED.search(segment)),
            "excerpt": " ".join(segment.split())[:220]}


def extract_answer_claims(relay: pd.DataFrame) -> pd.DataFrame:
    """One row per reported answer found in the relay corpus.

    Columns: where it came from (rev_id, time, label, task_family, page_id);
    ``round_num`` (from the segment's marker, 1 for an opening-prompt
    description, else missing); ``answer_value`` as written (e.g. "20,794");
    ``prompt_clock`` / ``answer_clock`` as written, in the cohort's task clock;
    ``latency_s``, prompt -> answer in seconds (0-3600); the self-reported
    ``said_wrong`` / ``said_right`` / ``said_confirmed`` flags; and the
    ``excerpt`` the claim was parsed from.
    """
    rows = []
    for rev_id, time, label, family, page_id, text in zip(
            relay["rev_id"], relay["time"], relay["label"], relay["task_family"],
            relay["page_id"], relay["added_text"]):
        for clause in split_clauses(text):
            for round_num, segment in round_segments(clause):
                claim = _parse_claim(segment, round_num)
                if claim is not None:
                    rows.append({"rev_id": rev_id, "time": time, "label": label,
                                 "task_family": family, "page_id": page_id, **claim})
    claims = pd.DataFrame(rows, columns=CLAIM_COLUMNS)
    # Nullable integers: a missing round or latency stays missing instead of
    # turning the whole column into floats ("4.0").
    return claims.astype({"round_num": "Int64", "latency_s": "Int64"})


def map_values_to_rounds(claims: pd.DataFrame) -> dict[tuple[str, str], int]:
    """(task_family, answer_value) -> round, learned from claims that state both.

    Many reports give a value without a round ("GA prompt ... answered 90,725");
    others give both ("G2-AR ... answered 20,794"). The explicit ones teach the
    lookup, by majority vote, that back-fills the rest.

    Do not infer rounds from the order in which values first appear on the wiki:
    the relay began mid-sequence, so grocery's round-2 answer was published nine
    hours before its round-1 answer.
    """
    known = claims[claims["round_num"].notna() & claims["answer_value"].notna()]
    return {(family, value): int(group["round_num"].mode().iloc[0])
            for (family, value), group in known.groupby(["task_family", "answer_value"])}


def fill_rounds(claims: pd.DataFrame) -> pd.DataFrame:
    """Add ``round_filled`` and ``round_group``.

    round_filled  the round stated in the report, else the value lookup's
                  (map_values_to_rounds), else missing
    round_group   "round 1", "round 2+", or "unmarked" when no round is known.
                  "unmarked" is NOT evidence of round 1: agents describing the
                  opening prompt usually name the state ("GA prompt") rather
                  than writing "R1", so those rows land here.
    """
    lookup = map_values_to_rounds(claims)
    out = claims.copy()
    out["round_filled"] = pd.array(
        [int(stated) if pd.notna(stated) else lookup.get((family, value))
         for stated, family, value in zip(out["round_num"], out["task_family"],
                                          out["answer_value"])], dtype="Int64")
    filled = out["round_filled"]
    out["round_group"] = np.select([filled.eq(1).fillna(False), filled.ge(2).fillna(False)],
                                   ["round 1", "round 2+"], default="unmarked")
    return out
