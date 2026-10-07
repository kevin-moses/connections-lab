"""The relay as a growing network -- labels swarming pages -- for an animated graph.

build_swarm_graph() turns the relay posts into one JSON-ready bundle:

    families   one circular area per benchmark
    questions  one per (benchmark, round) that relay posts mention
    pages      the relay pages
    labels     the labels that posted on them
    edges      one per label-page pair: when the label arrived, how often it posted
    posts      every relay post, sorted by time -- the animation's clock
    links      pointers written in relay posts from one relay page to another
    addresses  relay posts that address another label by name

Three rules make the file easy to animate:

1. Positions are final. They are computed once, from the finished graph, so
   nothing moves while it grows. Each label is drawn beside one page, its
   ``anchor``, in order of arrival, so a swarm fills in around its page; each
   benchmark's pages share one circular area.
2. A node's ``t`` is the first moment ANY event refers to it: its first post, or
   earlier if a link announces the page or a post addresses the label. So no
   event ever refers to a node that is not on screen yet. ``t_post`` is the
   node's first post.
3. Every list of events is sorted by ``t`` (epoch seconds, UTC).

"Relay" means both tiers of relay_status(): posts using relay vocabulary and the
other posts on relay pages. Links follow the same rules as every page reference
(graphs.build_page_references). Benchmarks and rounds are inferred from page
names and keywords, and a label is a name, not an agent.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .claims import mentioned_rounds
from .graphs import build_page_references
from .relay import PHASES, classify_task_family, find_peer_addresses, relay_status

# The canvas positions are laid out on. A sketch should scale both axes by the
# same factor, so that areas stay circular.
CANVAS_WIDTH, CANVAS_HEIGHT = 1600, 1000

# The bundle's lists, in the order they are written.
_LISTS = ["families", "questions", "pages", "labels", "edges", "posts", "links", "addresses"]

# Layout spacing, in layout units (scaled to the canvas at the end).
_PETAL = 4.2          # distance between neighbouring labels around a page
_FLOWER_GAP = 3.0     # between two pages' flowers
_AREA_GAP = 14.0      # between two benchmarks' areas
_GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5))


def _epochs(times: pd.Series) -> pd.Series:
    """Epoch seconds, as integers even when ``times`` is empty."""
    return times.map(lambda time: int(time.timestamp())).astype("int64")


def _majority(values: pd.Series) -> str:
    """The most common value; ties go to the alphabetically first, so runs agree."""
    counts = values.value_counts()
    return min(counts.index[counts == counts.max()])


def _ring_pack(radii: list[float], gap: float, stretch: float = 1.0) -> list[tuple[float, float]]:
    """Place circles, in the given order, at the first free spot on rings of growing radius.

    Earlier circles end up nearer the centre. ``stretch`` > 1 widens the rings,
    for a canvas wider than it is tall.
    """
    placed: list[tuple[tuple[float, float], float]] = []
    for radius in radii:
        spot, ring = None, 0.0
        while spot is None:
            steps = max(1, int(2 * math.pi * ring / gap))
            for k in range(steps):
                angle = 2 * math.pi * k / steps
                x, y = ring * math.cos(angle) * stretch, ring * math.sin(angle)
                if all(math.hypot(x - px, y - py) >= radius + pr + gap for (px, py), pr in placed):
                    spot = (x, y)
                    break
            ring += gap
        placed.append((spot, radius))
    return [spot for spot, _ in placed]


def _layout(page_nodes: pd.DataFrame, label_nodes: pd.DataFrame, arrival: pd.Series,
            area_first: pd.Series):
    """Final positions: flowers (a page and its anchored labels) inside benchmark areas.

    Returns ``(page_xy, label_xy, areas)``: canvas (x, y) per page and per label --
    kept apart because labels are free text and one may be spelled like a page
    id -- and (x, y, radius) per benchmark, in order of first appearance
    (earliest nearest the centre).
    """
    petals = {page: sorted(group.index, key=lambda label: (arrival[(label, page)], label))
              for page, group in label_nodes.groupby("anchor")}
    # a flower's radius grows with the square root of its petals, as a sunflower's does
    flower_radius = {page: _PETAL * math.sqrt(len(petals.get(page, [])) + 1.5) + 2
                     for page in page_nodes.index}

    page_local, label_local, area_radius = {}, {}, {}      # relative to each area's centre
    for family, members in page_nodes.groupby("family"):
        order = (members.assign(id=members.index)
                        .sort_values(["t", "n_labels", "id"], ascending=[True, False, True])
                        .index.tolist())                     # earliest pages nearest the centre
        spots = _ring_pack([flower_radius[page] for page in order], _FLOWER_GAP)
        for page, (x, y) in zip(order, spots):
            page_local[page] = (x, y)
            for i, label in enumerate(petals.get(page, [])):       # a sunflower spiral
                distance = _PETAL * math.sqrt(i + 1.5)
                label_local[label] = (x + distance * math.cos(i * _GOLDEN_ANGLE),
                                      y + distance * math.sin(i * _GOLDEN_ANGLE))
        area_radius[family] = max(math.hypot(*spot) + flower_radius[page]      # + a little room
                                  for page, spot in zip(order, spots)) + 6

    families = sorted(area_radius, key=lambda f: (area_first[f], f))
    centres = dict(zip(families, _ring_pack([area_radius[f] for f in families], _AREA_GAP, stretch=1.45)))

    # one scale for x and y, so circles stay round; centred, at least 30 px from each edge
    xs = [centres[f][0] + side * area_radius[f] for f in families for side in (-1, 1)]
    ys = [centres[f][1] + side * area_radius[f] for f in families for side in (-1, 1)]
    scale = min((CANVAS_WIDTH - 60) / (max(xs) - min(xs)), (CANVAS_HEIGHT - 60) / (max(ys) - min(ys)))
    x0 = min(xs) - (CANVAS_WIDTH / scale - (max(xs) - min(xs))) / 2
    y0 = min(ys) - (CANVAS_HEIGHT / scale - (max(ys) - min(ys))) / 2

    def to_canvas(family, x, y):
        cx, cy = centres[family]
        return round((cx + x - x0) * scale, 1), round((cy + y - y0) * scale, 1)

    page_xy = {page: to_canvas(page_nodes.at[page, "family"], *page_local[page])
               for page in page_nodes.index}
    label_xy = {label: to_canvas(label_nodes.at[label, "home"], *label_local[label])
                for label in label_nodes.index}
    areas = {f: (*to_canvas(f, 0, 0), round(area_radius[f] * scale, 1)) for f in families}
    return page_xy, label_xy, areas


def _meta(posts: pd.DataFrame, counts: dict, excluded: dict) -> dict:
    """The bundle's meta block. Its time fields are None when there are no posts."""
    meta = {"generated_from": "full-wiki-logs via analysis/wikilog",
            "clock": "wiki UTC; every t is epoch seconds",
            "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
            "window": None, "t_start": None, "t_end": None, "play_start": None,
            "hourly": {"t0": None, "counts": []},
            "counts": counts, "excluded": excluded}
    if posts.empty:
        return meta
    # Playback starts with the relay's first post -- or with the first post of all,
    # for a frame that ends before the relay began. The few earlier posts on pages
    # that later hosted the relay are simply already on screen at that point.
    relay_start = pd.Timestamp(next(start for name, start, _, _ in PHASES if name == "relay"), tz="UTC")
    in_relay = posts.loc[posts["time"] >= relay_start, "t"]
    play_start = int(in_relay.min() if len(in_relay) else posts["t"].min())
    # posts per hour from the start of play_start's hour, for a scrubber or to skip quiet hours
    hour0 = play_start - play_start % 3600
    hourly = np.bincount((posts.loc[posts["t"] >= hour0, "t"] - hour0) // 3600)
    meta.update({"window": [posts["time"].min().isoformat(), posts["time"].max().isoformat()],
                 "t_start": int(posts["t"].min()), "t_end": int(posts["t"].max()),
                 "play_start": play_start,
                 "hourly": {"t0": int(hour0), "counts": [int(n) for n in hourly]}})
    return meta


def build_swarm_graph(revisions_with_deltas: pd.DataFrame, pages: pd.DataFrame) -> dict:
    """The relay as time-stamped nodes, edges and events (see the module docstring).

    Pass the FULL delta frame -- relay pages are found from the rows -- and the
    pages table, which page references are resolved against.
    """
    df = revisions_with_deltas
    status = relay_status(df)
    has_label = df["label"].fillna("") != ""
    in_relay = (status != "none") & has_label
    # assign the FILTERED status: an empty frame given a longer Series adopts its rows
    posts = df[in_relay].assign(relay=status[in_relay])
    posts = posts.sort_values(["time", "rev_id"], kind="stable")
    posts["t"] = _epochs(posts["time"])
    unlabelled = int(((status != "none") & ~has_label).sum())
    if posts.empty:
        excluded = {"relay_posts_without_label": unlabelled, "addresses_to_labels_without_relay_posts": 0}
        return {"meta": _meta(posts, dict.fromkeys(_LISTS, 0), excluded), **{key: [] for key in _LISTS}}

    # Benchmark: every post is classified; a page takes its posts' majority, and
    # its posts are then filed under the page's benchmark.
    post_family = pd.Series([classify_task_family(name, text)
                             for name, text in zip(posts["name"], posts["added_text"])], index=posts.index)
    classified = post_family != "unclassified"
    page_family = post_family[classified].groupby(posts.loc[classified, "page_id"]).agg(_majority)
    posts["family"] = posts["page_id"].map(page_family).fillna("unclassified")
    # A question is a benchmark plus a round; posts on unclassified pages name none.
    posts["q"] = [[f"{family}:{n}" for n in mentioned_rounds(text)] if family != "unclassified" else []
                  for family, text in zip(posts["family"], posts["added_text"])]

    edges = (posts.groupby(["label", "page_id"])
                  .agg(t=("t", "min"), n_posts=("rev_id", "size"),
                       vocabulary=("relay", lambda s: bool((s == "vocabulary").any())))
                  .reset_index()
                  .sort_values(["t", "label", "page_id"], kind="stable", ignore_index=True))
    label_ids, page_ids = set(edges["label"]), set(edges["page_id"])

    # Links: page references written in relay posts that point at another relay
    # page. The references are found in the full frame, so that every label counts
    # when telling an address to an agent from a pointer to a page.
    refs = build_page_references(df, pages)
    links = refs[refs["rev_id"].isin(set(posts["rev_id"])) & refs["dst_page"].isin(page_ids)]
    links = (links.assign(t=lambda d: _epochs(d["time"]))
                  .sort_values(["t", "rev_id", "dst_page"], kind="stable"))

    everyone = set(df["label"].dropna()) - {""}
    addressed = find_peer_addresses(posts, everyone)
    addresses = addressed[addressed["dst"].isin(label_ids)].assign(t=lambda d: _epochs(d["time"]))
    addresses = addresses.sort_values(["t", "rev_id", "dst"], kind="stable")

    # ---- pages: appear at their first post, or earlier if a link announces them
    page_nodes = edges.groupby("page_id").agg(t_post=("t", "min"), n_labels=("label", "nunique"))
    page_nodes["family"] = page_family.reindex(page_nodes.index).fillna("unclassified")
    announced = links.groupby("dst_page")["t"].min().reindex(page_nodes.index)
    page_nodes["t"] = np.fmin(page_nodes["t_post"], announced).astype(int)

    # ---- labels: home benchmark, benchmarks worked on, anchor page, appearance
    per_family = posts.groupby(["label", "family"]).agg(n=("rev_id", "size"), first=("t", "min")).reset_index()
    per_family["unclassified"] = per_family["family"] == "unclassified"
    by_preference = per_family.sort_values(["label", "unclassified", "n", "first", "family"],
                                           ascending=[True, True, False, True, True])
    label_nodes = edges.groupby("label").agg(t_post=("t", "min"))
    # home: the classified benchmark it posted in most (ties: the earliest)
    label_nodes["home"] = by_preference.drop_duplicates("label").set_index("label")["family"]
    worked_on = (per_family[~per_family["unclassified"]].sort_values(["label", "first", "family"])
                 .groupby("label")["family"].agg(list))
    label_nodes["families"] = [worked_on.get(label, []) for label in label_nodes.index]
    # anchor: the page in its home benchmark where it posted most (ties: the earliest)
    per_page = posts.groupby(["label", "page_id"]).agg(n=("rev_id", "size"), first=("t", "min")).reset_index()
    per_page = per_page[per_page["page_id"].map(page_nodes["family"]) == per_page["label"].map(label_nodes["home"])]
    label_nodes["anchor"] = (per_page.sort_values(["label", "n", "first", "page_id"],
                                                  ascending=[True, False, True, True])
                             .drop_duplicates("label").set_index("label")["page_id"])
    first_addressed = addresses.groupby("dst")["t"].min().reindex(label_nodes.index)
    label_nodes["t"] = np.fmin(label_nodes["t_post"], first_addressed).astype(int)

    # an area appears with its first page or label
    area_first = pd.concat([page_nodes.groupby("family")["t"].min(),
                            label_nodes.groupby("home")["t"].min()]).groupby(level=0).min()
    page_xy, label_xy, areas = _layout(page_nodes, label_nodes,
                                       edges.set_index(["label", "page_id"])["t"], area_first)

    questions = (posts[posts["q"].map(bool)].explode("q")
                 .groupby("q").agg(n_posts=("rev_id", "size"), n_pages=("page_id", "nunique"),
                                   n_labels=("label", "nunique"), t_first=("t", "min"), t_last=("t", "max"))
                 .reset_index())
    questions["family"] = questions["q"].str.split(":").str[0]
    questions["round"] = questions["q"].str.split(":").str[1].astype(int)
    questions = questions.sort_values(["family", "round"], ignore_index=True)

    family_of_page = page_nodes["family"]
    pages_per_family = family_of_page.value_counts()
    labels_per_family = (edges.assign(family=edges["page_id"].map(family_of_page))
                              .groupby("family")["label"].nunique())
    excluded = {"relay_posts_without_label": unlabelled,
                "addresses_to_labels_without_relay_posts": len(addressed) - len(addresses)}
    counts = {"families": len(areas), "questions": len(questions), "pages": len(page_nodes),
              "labels": len(label_nodes), "edges": len(edges), "posts": len(posts),
              "links": len(links), "addresses": len(addresses)}

    return {
        "meta": _meta(posts, counts, excluded),
        "families": [{"id": f, "x": x, "y": y, "r": r, "t": int(area_first[f]),
                      "n_pages": int(pages_per_family[f]), "n_labels": int(labels_per_family[f])}
                     for f, (x, y, r) in areas.items()],
        "questions": [{"id": q.q, "family": q.family, "round": int(q.round), "n_posts": int(q.n_posts),
                       "n_pages": int(q.n_pages), "n_labels": int(q.n_labels),
                       "t_first": int(q.t_first), "t_last": int(q.t_last)}
                      for q in questions.itertuples()],
        "pages": [{"id": p.page_id, "family": p.family, "x": page_xy[p.page_id][0],
                   "y": page_xy[p.page_id][1], "t": int(p.t), "t_post": int(p.t_post),
                   "n_labels": int(p.n_labels)}
                  for p in page_nodes.reset_index().sort_values(["t", "page_id"]).itertuples()],
        "labels": [{"id": n.label, "home": n.home, "anchor": n.anchor, "families": n.families,
                    "x": label_xy[n.label][0], "y": label_xy[n.label][1],
                    "t": int(n.t), "t_post": int(n.t_post)}
                   for n in label_nodes.reset_index().sort_values(["t", "label"]).itertuples()],
        "edges": [{"label": e.label, "page": e.page_id, "t": int(e.t), "n_posts": int(e.n_posts),
                   "relay": "vocabulary" if e.vocabulary else "relay_page",
                   "cross": bool(family_of_page[e.page_id] != label_nodes.at[e.label, "home"])}
                  for e in edges.itertuples()],
        "posts": [{"t": int(p.t), "rev": p.rev_id, "label": p.label, "page": p.page_id, "relay": p.relay,
                   "q": p.q, "text": " ".join(p.added_text.split())[:160]}
                  for p in posts.itertuples()],
        "links": [{"t": int(k.t), "rev": k.rev_id, "src": k.src_page, "dst": k.dst_page, "label": k.label}
                  for k in links.itertuples()],
        "addresses": [{"t": int(a.t), "rev": a.rev_id, "src": a.src, "dst": a.dst, "page": a.page_id}
                      for a in addresses.itertuples()],
    }


def export_swarm_graph_json(bundle: dict, path: str | Path) -> dict:
    """Write build_swarm_graph() output as one compact JSON file.

    Shape
    -----
    meta        canvas size, time window, play_start, posts per hour, counts, exclusions
    families    {id, x, y, r, t, n_pages, n_labels}
    questions   {id, family, round, n_posts, n_pages, n_labels, t_first, t_last}
    pages       {id, family, x, y, t, t_post, n_labels}
    labels      {id, home, anchor, families, x, y, t, t_post}
    edges       {label, page, t, n_posts, relay, cross}
    posts       {t, rev, label, page, relay, q, text}
    links       {t, rev, src, dst, label}
    addresses   {t, rev, src, dst, page}

    Written with ``allow_nan=False`` so JavaScript's JSON.parse can always read it.
    """
    Path(path).write_text(json.dumps(bundle, separators=(",", ":"), allow_nan=False))
    return bundle
