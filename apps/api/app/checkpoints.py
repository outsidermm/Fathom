"""Choose where to read Qwen's state so a reading can be shown before the text
it precedes: at the end of the prompt, and at the start of each section."""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass


_STEP = re.compile(r"(?m)^[ \t]*(?:#{1,6}[ \t]*)?(\d{1,2})[.)][ \t]+(?=(?:\*\*)?[A-Z])")
_HEADING = re.compile(r"(?m)^#{1,6}[ \t]+(?!\d{1,2}[.)])\S.*$")
_SENTENCE_START = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(*])")
# Where a plain lead ends: a colon, a clause break, a sentence end, or a line end.
_LEAD_END = re.compile(r"[:,;\n]|[.!?](?=\s|$)")
_MAX_LEAD = 100  # Characters of a section read before its state is sampled.
LOOKAHEAD = 140  # Paced display stays this far behind Qwen, so leads are known in time.


@dataclass(frozen=True)
class Checkpoint:
    # Character offset where the section starts. The reading is shown before
    # any text from here on when ready within the hold; late readings keep
    # this offset. 0 with sample_end 0 means "before the answer".
    position: int
    # The replay covers answer[:sample_end]; 0 reads the end of the prompt.
    sample_end: int
    label: str


PLAN = Checkpoint(0, 0, "Plan")


def _lead_end(answer: str, start: int) -> int | None:
    """End of a section's opening phrase, or None if it has not streamed yet."""
    if answer.startswith("**", start):  # "**Determine Your Budget**:"
        close = answer.find("**", start + 2, start + _MAX_LEAD)
        if close < 0:
            return None
        end = close + 2
        return end + 1 if answer.startswith(":", end) else end
    match = _LEAD_END.search(answer, start, start + _MAX_LEAD)
    if match and match.start() > start:
        return match.start()
    window = answer[start : start + _MAX_LEAD]
    words = list(re.finditer(r"\S+", window))
    if len(words) > 8:
        return start + words[8].start()
    return None


def _candidates(answer: str) -> Iterator[tuple[int, int, str]]:
    """(section start, lead end, label) for each section whose lead has streamed."""
    headings = {m.start(): m.end() for m in _HEADING.finditer(answer)}
    structured = [
        (m.start(), m.end(), f"Step {m.group(1)}") for m in _STEP.finditer(answer)
    ] + [(start, start, "Section") for start in headings]
    if structured:
        previous_heading_end = None
        for start, lead_from, label in sorted(structured):
            # "### Step 1: …" followed directly by "1. **…**" is one section.
            nested = (
                label.startswith("Step") and previous_heading_end is not None
                and not answer[previous_heading_end:start].strip()
            )
            previous_heading_end = headings.get(start)
            # A heading's lead is its whole line, once the line has ended.
            if label == "Section":
                end = previous_heading_end if answer.startswith("\n", previous_heading_end) else None
            else:
                end = _lead_end(answer, lead_from)
            if end is not None and not nested:
                yield start, end, label
        return
    for match in _SENTENCE_START.finditer(answer):
        end = _lead_end(answer, match.end())
        if end is not None:
            yield match.end(), end, "Next"


def next_checkpoint(
    answer: str, taken: set[int], last_position: int, min_gap: int = 0
) -> Checkpoint | None:
    """The earliest untaken section start whose lead has fully streamed.

    Sections closer than ``min_gap`` characters to the previous checkpoint are
    skipped, spreading a limited number of readings over long answers. In
    unstructured prose, sections are sentences at least 100 characters apart.
    """
    for start, end, label in _candidates(answer):
        gap = min_gap if label != "Next" else max(100, min_gap)
        if start in taken or start <= last_position or start - last_position < gap:
            continue
        return Checkpoint(start, end, label)
    return None
