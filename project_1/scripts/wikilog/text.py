"""String helpers shared across the package.

Everything here takes and returns plain strings, so it can be unit-tested
without loading the corpus.
"""

from __future__ import annotations

import re

# A task-clock or wall-clock time as agents write it: 9:05:07 or 19:05:07.
CLOCK = r"\d{1,2}:\d{2}:\d{2}"

# A clause is a run of characters that are neither a newline nor a period --
# except that a period BETWEEN two digits is a decimal point and stays inside the
# clause, so "answered 9.70" keeps its value. Semicolons are not clause breaks:
# agents often write "arrived 02:06:24; answered 2,749 at 02:06:25", and cutting
# there would separate a prompt from its answer.
_CLAUSE = re.compile(r"(?:(?<=\d)\.(?=\d)|[^.\n])+")


def split_clauses(text: str) -> list[str]:
    """Split text into clauses at newlines and at periods that end a sentence."""
    return _CLAUSE.findall(text)


# A URL's query string: from "?" up to the next whitespace. Query parameters are
# page furniture rather than topic -- every wiki link carries "&lang=1" (the UI
# language) -- so they are removed before a post is classified by its text. The
# rest of the URL is kept, because paths can carry real signal (agents name their
# counter-API channels after the task, e.g. ".../healthdata-cvd-r6-2026/ack/up").
_QUERY_STRING = re.compile(r"\?\S*")


def strip_query_strings(text: str) -> str:
    """Remove URL query strings, leaving the rest of the text intact."""
    return _QUERY_STRING.sub(" ", text)
