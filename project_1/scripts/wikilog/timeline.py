"""A tidy per-task event stream, and its export as JSON for visualisation.

All times are wiki UTC -- the only clock every agent shares. Task clocks are
local to each cohort and offset from one another, so they cannot share an axis.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from .relay import (PHASES, RELAY_STATUSES, classify_task_family, label_phase, relay_status,
                    tag_speech_acts)


def _event_rules(page_creator: dict, answered: set) -> list[tuple[str, callable]]:
    """(event, test) pairs in PRIORITY order; each post gets the first that passes.

    A post can do several things at once -- ask and confirm, say -- so it is
    labelled with its most consequential move rather than counted twice. A bare
    timing update matches nothing specific and falls through to "post".
    """
    return [
        ("open", lambda post: page_creator.get(post.page_id) == post.rev_id),
        ("answer", lambda post: post.rev_id in answered),
        ("confirm", lambda post: post.act_confirm),
        ("verify", lambda post: post.act_verify_request),
        ("contradict", lambda post: post.act_contradict),
        ("ask", lambda post: post.act_ask),
        ("ack", lambda post: post.act_thanks or post.act_acknowledge or post.act_agree),
        ("post", lambda post: True),
    ]


# The event vocabulary in priority order, derived from the rules themselves so
# the two can never disagree.
EVENT_TYPES = [event for event, _ in _event_rules({}, set())]

TIMELINE_COLUMNS = ["time", "task_family", "page", "label", "event",
                    "cohorts", "added_chars", "text"]


def build_task_timeline(relay: pd.DataFrame, claims: pd.DataFrame | None = None,
                        all_revisions: pd.DataFrame | None = None) -> pd.DataFrame:
    """One row per relay post, labelled with its most consequential move.

    ``claims`` marks posts that report an answer value. ``all_revisions`` (the
    full delta frame) is needed for ``open`` to mean "this post created the
    page": the first RELAY post on a page is often not its first revision, so
    without it no ``open`` events are emitted rather than wrong ones.
    """
    answered = (set() if claims is None
                else set(claims.loc[claims["answer_value"].notna(), "rev_id"]))
    page_creator = ({} if all_revisions is None else
                    all_revisions.sort_values(["page_id", "seq"])
                    .groupby("page_id")["rev_id"].first().to_dict())
    rules = _event_rules(page_creator, answered)

    rows = []
    for post in tag_speech_acts(relay).itertuples():
        event = next(name for name, test in rules if test(post))
        rows.append({"time": post.time, "task_family": post.task_family,
                     "page": post.page_id, "label": post.label, "event": event,
                     "cohorts": post.cohorts, "added_chars": post.added_chars,
                     "text": " ".join(post.added_text.split())[:300]})
    if not rows:
        return pd.DataFrame(columns=TIMELINE_COLUMNS)
    return pd.DataFrame(rows, columns=TIMELINE_COLUMNS).sort_values(
        "time", kind="stable", ignore_index=True)


def export_timeline_json(timeline: pd.DataFrame, claims: pd.DataFrame, path: str | Path) -> dict:
    """Write the timeline and the answer claims as one self-describing JSON file.

    Shape
    -----
    meta      source, clock note, wiki-UTC window, ``event_types`` in priority
              order, event count
    families  per task family: start, end, n_events, n_labels, n_pages and
              events_by_type (keys in priority order); largest family first
    events    {t (epoch seconds, UTC), iso, family, page, label, event, chars, text}
    answers   {t, family, label, value, round, round_group, latency_s,
              said_wrong, excerpt} -- claims that carry an answer value

    Written with ``allow_nan=False``: a NaN would make the file unreadable by
    JavaScript's JSON.parse, so any that slips through raises here instead.
    """
    families = []
    for family, group in timeline.groupby("task_family"):
        counts = group["event"].value_counts()
        families.append({"family": family,
                         "start": group["time"].min().isoformat(),
                         "end": group["time"].max().isoformat(),
                         "n_events": len(group),
                         "n_labels": int(group["label"].nunique()),
                         "n_pages": int(group["page"].nunique()),
                         "events_by_type": {e: int(counts[e]) for e in EVENT_TYPES if e in counts}})

    def optional_int(value):
        return None if pd.isna(value) else int(value)

    bundle = {
        "meta": {"generated_from": "full-wiki-logs via analysis/wikilog",
                 "clock": "wiki UTC - task clocks are cohort-local and NOT comparable",
                 "window": [timeline["time"].min().isoformat(), timeline["time"].max().isoformat()],
                 "event_types": EVENT_TYPES,
                 "n_events": len(timeline)},
        "families": sorted(families, key=lambda f: -f["n_events"]),
        "events": [{"t": int(post.time.timestamp()), "iso": post.time.isoformat(),
                    "family": post.task_family, "page": post.page, "label": post.label,
                    "event": post.event, "chars": int(post.added_chars), "text": post.text}
                   for post in timeline.itertuples()],
        "answers": [{"t": int(claim.time.timestamp()), "family": claim.task_family,
                     "label": claim.label, "value": claim.answer_value,
                     "round": optional_int(claim.round_filled),
                     "round_group": claim.round_group,
                     "latency_s": optional_int(claim.latency_s),
                     "said_wrong": bool(claim.said_wrong), "excerpt": claim.excerpt}
                    for claim in claims.itertuples() if pd.notna(claim.answer_value)],
    }
    Path(path).write_text(json.dumps(bundle, indent=1, allow_nan=False))
    return bundle


# ---------------------------------------------------------------------------
# Every revision: an all-posts timeline with the relay marked
# ---------------------------------------------------------------------------
REVISION_TIMELINE_COLUMNS = ["time", "rev", "wiki", "page", "label", "relay", "family",
                             "phase", "kind", "chars", "text"]


def build_revision_timeline(revisions_with_deltas: pd.DataFrame) -> pd.DataFrame:
    """One row per revision in the corpus, labelled with its relay status.

    ``relay`` is from relay_status(); ``family`` is the benchmark for rows with any
    relay status, and missing otherwise; ``phase`` is from label_phase(); ``kind``
    is the delta_kind; ``chars`` is the length of the added text; ``text`` is the
    start of it. Pass the FULL delta frame (relay pages are found from the rows).
    """
    df = revisions_with_deltas
    status = relay_status(df)
    in_relay = status != "none"
    family = pd.Series(None, index=df.index, dtype=object)
    family[in_relay] = [classify_task_family(name, text)
                        for name, text in zip(df.loc[in_relay, "name"], df.loc[in_relay, "added_text"])]
    timeline = pd.DataFrame({
        "time": df["time"], "rev": df["rev_id"], "wiki": df["wiki"], "page": df["page_id"],
        "label": df["label"], "relay": status, "family": family, "phase": label_phase(df),
        "kind": df["delta_kind"], "chars": df["added_chars"],
        "text": df["added_text"].map(lambda t: " ".join(t.split())[:140]),
    }, columns=REVISION_TIMELINE_COLUMNS)
    return timeline.sort_values(["time", "rev"], kind="stable", ignore_index=True)


def export_revision_timeline_json(timeline: pd.DataFrame, path: str | Path) -> dict:
    """Write build_revision_timeline() output as one self-describing JSON file.

    Shape
    -----
    meta       source, clock note, window, n_revisions, the meaning and count of
               each ``relay`` value, and the corpus phases (for background bands)
    revisions  {t, iso, rev, wiki, page, label, relay, family, phase, kind, chars, text}

    Written compactly (no indentation) because it holds every revision, and with
    ``allow_nan=False`` so JavaScript's JSON.parse can always read it.
    """
    counts = timeline["relay"].value_counts()
    bundle = {
        "meta": {"generated_from": "full-wiki-logs via analysis/wikilog",
                 "clock": "wiki UTC",
                 "window": [timeline["time"].min().isoformat(), timeline["time"].max().isoformat()],
                 "n_revisions": len(timeline),
                 "relay_values": RELAY_STATUSES,
                 "relay_counts": {value: int(counts.get(value, 0)) for value in RELAY_STATUSES},
                 "phases": [{"phase": name, "from": start, "until": end, "description": text}
                            for name, start, end, text in PHASES]},
        "revisions": [{"t": int(row.time.timestamp()), "iso": row.time.isoformat(), "rev": row.rev,
                       "wiki": row.wiki, "page": row.page, "label": row.label, "relay": row.relay,
                       # pandas 3 stores a missing string as NaN, which JSON cannot hold
                       "family": None if pd.isna(row.family) else row.family,
                       "phase": row.phase, "kind": row.kind,
                       "chars": int(row.chars), "text": row.text}
                      for row in timeline.itertuples()],
    }
    Path(path).write_text(json.dumps(bundle, separators=(",", ":"), allow_nan=False))
    return bundle
