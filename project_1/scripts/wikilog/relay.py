"""The answer relay: finding relay posts and annotating what they say.

What the relay is
-----------------
The same timed benchmark was run many times in parallel. Each run -- a
"cohort", usually named by a date token such as Nov16 -- steps through an
identical hidden sequence of prompts on its own "task clock", and the clocks are
mutually offset. So at any moment some cohorts are further along than others. A
cohort that has already seen item N posts it; cohorts still approaching item N
read it and answer without solving it.

Vocabulary agents use
---------------------
cohort          one parallel run of a benchmark
task clock      that run's internal clock (not comparable across cohorts)
shared UTC      an attempt to map between task clocks, to see who is ahead
R1, R2, ...     the round within the hidden sequence
cadence         the observed gap between rounds, used to predict the next one
values cached   "I already hold the answer data" -- NOT an HTTP cache
confirmed       "this round's answer is established" -- an announcement about
                the relay's knowledge, not a claim about the poster's own score
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from .load import WIKI_DEFAULT_PAGES
from .text import strip_query_strings

# A revision belongs to the relay when the text it ADDED uses relay vocabulary.
# (Matching the cumulative body instead would re-match every later revision of a
# busy relay page.)
RELAY_PATTERN = r"\bcohort\b|task[- ]clock"


def uses_relay_vocabulary(text: pd.Series) -> pd.Series:
    """Boolean mask: which texts use relay vocabulary (see RELAY_PATTERN)."""
    return text.str.contains(RELAY_PATTERN, case=False, regex=True, na=False)


RELAY_STATUSES = {
    "vocabulary": "the text the revision added uses relay vocabulary -- the definition "
                  "every notebook's relay analysis uses",
    "relay_page": "no relay vocabulary, but posted on a page that has relay posts "
                  "(the wiki's default pages excluded)",
    "none": "neither",
}


def relay_status(revisions_with_deltas: pd.DataFrame) -> pd.Series:
    """How each revision relates to the relay: "vocabulary", "relay_page" or "none".

    The vocabulary test is strict. Agents often write "task 10:21:47" rather than
    "task clock", so many genuine relay posts -- including one-second answer
    reports -- use neither word; "relay_page" catches them through the page they
    were posted on. The wiki's default pages are excluded from that step because
    they are not relay pages: StartSeite, for example, carries two relay posts
    among hundreds of unrelated ones.

    Pass the FULL delta frame: relay pages are identified from the rows given.
    """
    df = revisions_with_deltas
    vocabulary = uses_relay_vocabulary(df["added_text"])
    relay_pages = set(df.loc[vocabulary, "page_id"]) - WIKI_DEFAULT_PAGES
    status = np.select([vocabulary, df["page_id"].isin(relay_pages)],
                       ["vocabulary", "relay_page"], default="none")
    return pd.Series(status, index=df.index, name="relay_status")


# ---------------------------------------------------------------------------
# Task families: which benchmark a relay post is about
# ---------------------------------------------------------------------------
# Patterns are matched case-insensitively. A few must stop at the end of a word,
# but page names are CamelCase ("DataUSAMaidsSequenceLive"), where \b finds no
# boundary between "Maids" and "Sequence". _WORD_END means "not followed by a
# LOWERCASE letter": the (?-i:...) switches case-insensitivity off for that one
# check. Without it, [a-z] would also match capitals under re.I, and the guard
# would reject exactly the CamelCase names it exists to accept.
_WORD_END = r"(?-i:(?![a-z]))"

# (family, pattern), one per benchmark. The first family whose pattern matches
# wins, so specific subjects come before generic ones.
TASK_FAMILIES: list[tuple[str, str]] = [
    ("sector61_state5", r"Sector\s?61|State5"),
    # IHME healthdata.org hosts several distinct tasks; match each by its topic,
    # never by the generic domain word "healthdata".
    ("healthdata_cvd", r"CVD|cardio"),
    ("healthdata_mcv2", r"MCV2|measles"),
    ("healthdata_smoking", r"Smoking"),
    ("clothing_2m56", r"Clothing|2m56"),
    ("grocery", r"Grocer(?:y|ies)"),
    ("maids", r"Maids?" + _WORD_END),
    ("police_wage", r"Police"),
    ("construction", r"Construction"),
    ("transport", r"Transport"),
    ("oecd_education", r"OECD|Education ?Equity"),
    ("ivy_tuition", r"Tuition"),
    ("family_planning", r"Family ?Planning"),
    ("production_occupation", r"Production ?Occupation"),
    ("veterans", r"Veterans?" + _WORD_END),
    ("cashier", r"Cashier"),
    ("poverty", r"Poverty"),
    ("finance_salary", r"Finance|Salary|FinancialManager"),
    ("language", r"Language|Lang" + _WORD_END),
    ("uefa", r"UEFA"),
]

# Generic patterns, tried only after every family above has failed. Several
# DataUSA benchmarks are "state sequences" (DataUSAClothingStateSequenceCollabOct10
# is a clothing page), but a name with nothing more specific, such as
# DataUSAStateSequenceCollab2027, is the sector 61 task.
FALLBACK_FAMILIES: list[tuple[str, str]] = [
    ("sector61_state5", r"StateSequence"),
]


def classify_task_family(page_name: str, text: str = "") -> str:
    """Name the benchmark a revision is about, or return "unclassified".

    The page name is authoritative and is tried against every rule first --
    TASK_FAMILIES, then FALLBACK_FAMILIES: a page called CashierCoordJul18OAI
    belongs to the cashier family even if its body mentions sector 61. Only when
    nothing matches the name is the body consulted the same way, with URL query
    strings removed (see text.strip_query_strings).
    """
    rules = TASK_FAMILIES + FALLBACK_FAMILIES
    for source in (page_name, strip_query_strings(text)):
        for family, pattern in rules:
            if re.search(pattern, source, re.I):
                return family
    return "unclassified"


# ---------------------------------------------------------------------------
# Cohorts
# ---------------------------------------------------------------------------
# A cohort is named by a date token written as a standalone word ("Nov16 cohort").
# Tokens fused into a longer name (the "Sept08" inside "OpenAIHealthdataCVDSept08")
# have no word boundary and are deliberately not extracted.
_COHORT_TOKEN = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)(\d{1,2})\b")


def extract_cohorts(text: str) -> list[str]:
    """Cohort tokens in canonical form: three-letter month, two-digit day.

    Agents write the same run several ways -- "Sept08" and "Sep08", "Sep7" and
    "Sep07" -- so each token is normalised to e.g. "Sep08" before comparison.
    """
    return sorted({f"{month[:3]}{int(day):02d}" for month, day in _COHORT_TOKEN.findall(text)})


# ---------------------------------------------------------------------------
# Speech acts
# ---------------------------------------------------------------------------
# The single definition of each speech act. Patterns are lowercase and always
# applied case-insensitively through match_speech_act(). They count explicit
# moves, not sentiment: "contradict" matters as much as "thanks", because
# disagreement is evidence the relay was being checked rather than echoed.
SPEECH_ACTS: dict[str, str] = {
    "ask": r"(?:please\s+)?(?:post|relay|append|reply|share)\b[^.\n]{0,60}?"
           r"(?:immediately|instantly|asap|now|here|fast)",
    "confirm": r"\bconfirmed\b",
    "thanks": r"\bthanks\b|\bthank you\b|\bthx\b|appreciated",
    "acknowledge": r"\breceived\b|\bgot it\b|\backnowledg|\bnoted\b",
    "agree": r"\bmatch(?:es|ed)?\b|\bagrees?\b|\bconsistent with\b|\bsame as\b",
    "contradict": r"\bwrong\b|\bincorrect\b|\bdisagree|\bmismatch|\bdoes not match\b|"
                  r"\bnot conditional\b|\bcorrect me\b",
    "verify_request": r"who (?:directly )?saw|verification|please verify|independent",
}


def match_speech_act(text: pd.Series, act: str) -> pd.Series:
    """Boolean mask: which texts perform ``act`` (a key of SPEECH_ACTS)."""
    return text.str.contains(SPEECH_ACTS[act], case=False, regex=True, na=False)


def tag_speech_acts(revisions_with_deltas: pd.DataFrame) -> pd.DataFrame:
    """Add one boolean ``act_<name>`` column per speech act, from the ADDED text."""
    out = revisions_with_deltas.copy()
    for act in SPEECH_ACTS:
        out[f"act_{act}"] = match_speech_act(out["added_text"], act)
    return out


# ---------------------------------------------------------------------------
# The relay corpus
# ---------------------------------------------------------------------------
def relay_corpus(revisions_with_deltas: pd.DataFrame) -> pd.DataFrame:
    """The revisions whose added text uses relay vocabulary, annotated.

    Added columns: ``task_family``, ``cohorts`` (list), ``is_ask``, ``is_confirm``.
    """
    df = revisions_with_deltas
    out = df[uses_relay_vocabulary(df["added_text"])].copy()
    out["task_family"] = [classify_task_family(name, text)
                          for name, text in zip(out["name"], out["added_text"])]
    out["cohorts"] = out["added_text"].map(extract_cohorts)
    out["is_ask"] = match_speech_act(out["added_text"], "ask")
    out["is_confirm"] = match_speech_act(out["added_text"], "confirm")
    return out


# ---------------------------------------------------------------------------
# Peer addresses
# ---------------------------------------------------------------------------
# A label as agents write it when naming a peer: seven or more characters,
# starting with a capital (e.g. CashierCoordAgentX, Apr17MaidsWatcher).
_PEER = r"([A-Z][A-Za-z0-9]{6,})"

# The three ways agents address a specific peer. A bare mention of another label
# is deliberately NOT counted: agents copy each other's signed posts wholesale
# ("... -- Oct18Helper"), so most mentions are copied sign-offs, not addresses.
_ADDRESS_FORMS = [
    re.compile(r"(?:^|[\s(])" + _PEER + r"\s*[:,]"),                # "Name: ..." / "Name, ..."
    re.compile(r"@" + _PEER),                                        # "@Name"
    re.compile(r"\b(?i:thanks|thank you|thx)\s*[,!]?\s+" + _PEER),  # "Thanks, Name"
]

# A signature, "... -- Oct18Helper": the name of whoever wrote the text, or first
# wrote it, since signed posts are copied wholesale.
_SIGNATURE = re.compile(r"--\s*" + _PEER)


def addressed_spans(text: str) -> set[tuple[int, int]]:
    """Where ``text`` addresses someone: the (start, end) of each name written in
    one of the three address forms."""
    return {match.span(1) for form in _ADDRESS_FORMS for match in form.finditer(text)}


def signature_spans(text: str) -> set[tuple[int, int]]:
    """Where ``text`` is signed: the (start, end) of each name after "--"."""
    return {match.span(1) for match in _SIGNATURE.finditer(text)}


PEER_COLUMNS = ["rev_id", "src", "dst", "page_id", "time"]


def find_peer_addresses(revisions_with_deltas: pd.DataFrame, labels: set[str]) -> pd.DataFrame:
    """One row per (post, peer) where a post directly addresses another label.

    Only names that are real labels (``labels``) and not the poster's own count.
    A post addressing the same peer twice yields one row.
    """
    if revisions_with_deltas.empty:
        return pd.DataFrame(columns=PEER_COLUMNS)
    df = revisions_with_deltas
    rows = []
    for rev_id, label, page_id, time, text in zip(df["rev_id"], df["label"], df["page_id"],
                                                   df["time"], df["added_text"]):
        addressed = sorted({text[start:end] for start, end in addressed_spans(text)})
        rows.extend({"rev_id": rev_id, "src": label, "dst": peer, "page_id": page_id, "time": time}
                    for peer in addressed if peer in labels and peer != label)
    return pd.DataFrame(rows, columns=PEER_COLUMNS)


# ---------------------------------------------------------------------------
# Phases of the corpus
# ---------------------------------------------------------------------------
# Boundaries read off the daily share of revisions using relay vocabulary
# (notebook 03 recomputes that share and plots it).
PHASES: list[tuple[str, str, str, str]] = [
    ("probing", "2026-05-24", "2026-06-16", "infrastructure testing; no relay vocabulary"),
    ("relay", "2026-06-16", "2026-06-18", "the relay itself"),
    ("burst", "2026-06-18", "2026-06-19", "automated link spam; relay share collapses"),
    ("relay_resumed", "2026-06-19", "2026-06-22", "the relay returns"),
    ("tail", "2026-06-22", "2026-07-03", "decay"),
]


def label_phase(revisions: pd.DataFrame) -> pd.Series:
    """Name the corpus phase each revision falls in (see PHASES)."""
    phase = pd.Series("unknown", index=revisions.index, dtype=object)
    for name, start, end, _ in PHASES:
        in_phase = ((revisions["time"] >= pd.Timestamp(start, tz="UTC"))
                    & (revisions["time"] < pd.Timestamp(end, tz="UTC")))
        phase[in_phase] = name
    return phase
