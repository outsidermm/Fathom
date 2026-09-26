"""Split an AV explanation into its generic opener and its detail, and tidy
the short focus phrase derived from it."""

from __future__ import annotations

import re

_SENTENCE = re.compile(r"(?<=[.!?])\s+")
# A capitalized word that does not start a sentence or quote: likely a name.
_NAME = re.compile(r"(?<=[a-z,;] )[A-Z][a-z]+")
_QUOTED = re.compile(r'"[^"]*"|\u201c[^\u201d]*\u201d|\(\s*"[^)]*\)')


def split_explanation(explanation: str) -> tuple[str, str]:
    """(genre, detail). The first sentence is mostly the AV's generic prior
    ("Structured article format ..."); the rest carries most of the signal."""
    sentences = [s for s in _SENTENCE.split(explanation.strip()) if s.strip()]
    return (sentences[0] if sentences else ""), " ".join(sentences[1:])


def clean_focus(text: str, note: str = "") -> str | None:
    """A 2-10 word, lowercase-first phrase from a model's label, or None.

    Words the note capitalizes mid-sentence (names like "Canberra") get their
    capitals back, since the label model tends to lowercase them.
    """
    line = text.strip().splitlines()[0] if text.strip() else ""
    line = line.strip().strip("\"'`*").rstrip(".!").strip()
    words = line.split()
    if not 2 <= len(words) <= 10:
        return None
    # Quoted headings are title-cased ("Plan Your Trip"), so they are not names.
    unquoted = _QUOTED.sub(" ", note)
    names = {w.lower(): w for w in _NAME.findall(unquoted)}

    def restore(word: str) -> str:
        core = re.match(r"[\w-]+", word)
        if not core or core.group().lower() not in names:
            return word
        return names[core.group().lower()] + word[core.end():]

    words = [restore(w) if i else w[0].lower() + w[1:] for i, w in enumerate(words)]
    return " ".join(words)
