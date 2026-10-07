"""Page references: pages that name other pages.

(The analysis repository's version of this module also builds the label
networks and their null models; only page references are needed here.)
"""

from __future__ import annotations

import re
from collections import defaultdict

import pandas as pd

from .relay import addressed_spans, signature_spans


# ---------------------------------------------------------------------------
# Page references: pages that name other pages
# ---------------------------------------------------------------------------
# A wiki page name: a CamelCase-style token with at least one capital and one
# lowercase letter, six or more characters long.
_PAGE_NAME_TOKEN = re.compile(r"\b(?=\w*[A-Z])(?=\w*[a-z])[A-Za-z][A-Za-z0-9]{5,}\b")

REFERENCE_COLUMNS = ["rev_id", "src_page", "dst_page", "dst_name", "label", "time"]

# Page names that are also ordinary words: a post naming the DataUSA API or the
# company OpenAI is not pointing at the wiki page that happens to share the name.
WORD_PAGE_NAMES = frozenset({"DataUSA", "OpenAI"})


def build_page_references(revisions_with_deltas: pd.DataFrame, pages: pd.DataFrame,
                          labels: set[str] | None = None) -> pd.DataFrame:
    """Directed page -> page pointers found in the text each revision ADDED.

    Scanning ``body`` instead would recount a pointer once for every later revision
    of the citing page. A token counts only if it names a real page in the SAME
    wiki; that discards prose CamelCase, but also misses pointers to pages outside
    the published cut, so treat the result as a lower bound.

    Two kinds of page name are not pointers and are skipped:

    * names that are also ordinary words (WORD_PAGE_NAMES);
    * names that, everywhere they occur in the post, refer to an agent: a
      signature ("-- CashierCoordApr01OAI") or, for a name that is a label, an
      address ("ResearchHelperJan12: we appear to be ..."). Many agents have a
      page named after them, so these would otherwise look like links. Address
      punctuation alone says nothing for other names: "append to
      Sector61State5FastSignal, then answer" points at a page.

    ``labels`` defaults to every label in ``revisions_with_deltas``.
    """
    if revisions_with_deltas.empty:
        return pd.DataFrame(columns=REFERENCE_COLUMNS)
    known = set(zip(pages["wiki"], pages["name"]))
    df = revisions_with_deltas
    if labels is None:
        labels = set(df["label"].dropna()) - {""}
    rows = []
    for rev_id, page_id, name, wiki, label, time, text in zip(
            df["rev_id"], df["page_id"], df["name"], df["wiki"],
            df["label"], df["time"], df["added_text"]):
        spans = defaultdict(list)                          # page name -> where it occurs
        for match in _PAGE_NAME_TOKEN.finditer(text):
            token = match.group(0)
            if token != name and token not in WORD_PAGE_NAMES and (wiki, token) in known:
                spans[token].append(match.span())
        if not spans:
            continue
        signed, addressed = signature_spans(text), addressed_spans(text)
        for token in sorted(spans):                        # sorted: stable row order
            about_an_agent = (signed | addressed) if token in labels else signed
            if all(span in about_an_agent for span in spans[token]):
                continue
            rows.append({"rev_id": rev_id, "src_page": page_id,
                         "dst_page": f"{wiki}/{token}", "dst_name": token,
                         "label": label, "time": time})
    return pd.DataFrame(rows, columns=REFERENCE_COLUMNS)
