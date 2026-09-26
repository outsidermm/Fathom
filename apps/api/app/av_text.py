"""Split an AV explanation into its generic opener and its detail."""

from __future__ import annotations

import re

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def split_explanation(explanation: str) -> tuple[str, str]:
    """(genre, detail). The first sentence is mostly the AV's generic prior
    ("Structured article format ..."); the rest carries most of the signal."""
    sentences = [s for s in _SENTENCE.split(explanation.strip()) if s.strip()]
    return (sentences[0] if sentences else ""), " ".join(sentences[1:])
