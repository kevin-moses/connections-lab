# Regenerating the data files

Three files in `data/` are generated from the full-wiki-logs corpus by the scripts in this
folder. The other files in `data/` (`family_notes.json`, `revision_moments.json`) are written by
hand, and the scripts never touch them.

| file | script | what it holds |
|---|---|---|
| `data/task_timelines.json` | `export_task_timelines.py` | relay posts as typed events per benchmark, plus agents' answer reports |
| `data/revision_timeline.json` | `export_revision_timeline.py` | every revision, with its relay tier and phase |
| `data/swarm_graph.json` | `export_swarm_graph.py` | the relay as a label–page network that grows over time |

Each file's shape is described in the docstring of the function that writes it:
`export_timeline_json` and `export_revision_timeline_json` in `wikilog/timeline.py`, and
`export_swarm_graph_json` in `wikilog/swarm.py`.

## Run

From `project_1/`, with [uv](https://docs.astral.sh/uv/) installed:

```bash
uv run python scripts/export_task_timelines.py
```

```bash
uv run python scripts/export_revision_timeline.py
```

```bash
uv run python scripts/export_swarm_graph.py
```

The first `uv run` builds `.venv/` from `uv.lock`: Python 3.14 with pandas 3.0.5 and numpy 2.5.3,
the versions the analysis used. Each script writes to `data/` by default (`--out PATH` writes
elsewhere) and reads the file back as strict JSON before it finishes.

## Input

The scripts read `full-wiki-logs/revisions.jsonl` and `full-wiki-logs/pages.jsonl`, and first
check both against `full-wiki-logs/SHA256SUMS`, stopping if either differs from the published
corpus. The folder is gitignored; the corpus is published as `full-wiki-logs.zip` at
<https://collusion.wiki/explorer/download>.

## Where the code comes from

`wikilog/` is a trimmed copy of the analysis package in the `oai_collusion_investigation`
repository: only the functions these three exports use are kept, unchanged. On 2026-10-06 all
three outputs were byte-identical to that repository's. The analysis itself — notebooks, tests,
and the reasoning behind each rule — lives there.
