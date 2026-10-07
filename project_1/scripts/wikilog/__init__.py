"""wikilog -- the code that builds this project's JSON data files.

A trimmed copy of the ``wikilog`` package from the oai_collusion_investigation
repository, which analyses the full-wiki-logs corpus in four notebooks. Only the
functions the three exports reach are kept; everything else in them is
unchanged, so the exports are byte-identical to the analysis repository's.
Mentions of notebooks in the docstrings refer to that repository.

Modules, in the order data flows through them:

    load      read the corpus files (revisions, pages), checked against SHA256SUMS
    deltas    what each revision actually ADDED (page bodies are cumulative)
    relay     relay posts: tiers, benchmarks, cohorts, speech acts, addresses, phases
    claims    agents' own reports of answering a round
    graphs    page references: pages that name other pages
    timeline  the per-task event stream and the every-revision timeline
    swarm     the relay as a growing label-page network
    text      string helpers shared by the modules above
"""

from .claims import extract_answer_claims, fill_rounds
from .deltas import extract_deltas
from .load import DATA_DIR, load_pages, load_revisions
from .relay import relay_corpus
from .swarm import build_swarm_graph, export_swarm_graph_json
from .timeline import (build_revision_timeline, build_task_timeline,
                       export_revision_timeline_json, export_timeline_json)

__all__ = [
    "DATA_DIR", "build_revision_timeline", "build_swarm_graph", "build_task_timeline",
    "export_revision_timeline_json", "export_swarm_graph_json", "export_timeline_json",
    "extract_answer_claims", "extract_deltas", "fill_rounds", "load_pages", "load_revisions",
    "relay_corpus",
]
