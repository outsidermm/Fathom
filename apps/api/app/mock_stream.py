"""Fake activation stream so the frontend can build against the real
contract before the real SAE/NLA pipeline exists.

Swap this module's internals for the real model hooks later — nothing
outside `run_mock_stream` needs to change, since it already speaks the
contract in schemas.py / docs/api-contract.md.
"""

from __future__ import annotations

import asyncio
import random
from typing import Awaitable, Callable

from .schemas import ActivationEvent, Coords, Feature, FlagEvent, StatusEvent, TokenEvent

# A fixed, hand-picked feature set so the map layout is stable across runs.
# Real version: load from Neuronpedia / your SAE checkpoint and cache a
# precomputed UMAP projection at startup instead of hardcoding this.
FEATURES: list[Feature] = [
    Feature(id="feat_0001", label="hedging language", cluster="hedging", description="softening phrases: 'might', 'could', 'it seems'"),
    Feature(id="feat_0002", label="refusal pattern", cluster="refusal", description="declining or deflecting the request"),
    Feature(id="feat_0003", label="unsupported claim", cluster="unsupported", description="asserting a fact with no grounding in context"),
    Feature(id="feat_0004", label="legal register", cluster="style", description="formal/legal phrasing"),
    Feature(id="feat_0005", label="enthusiastic tone", cluster="sentiment", description="positive, upbeat framing"),
    Feature(id="feat_0006", label="numeric reasoning", cluster="reasoning", description="arithmetic or quantitative steps"),
    Feature(id="feat_0007", label="code syntax", cluster="syntax", description="programming-language tokens"),
    Feature(id="feat_0008", label="first-person voice", cluster="style", description="'I think', 'I believe'"),
    Feature(id="feat_0009", label="uncertainty marker", cluster="hedging", description="explicit confidence hedging"),
    Feature(id="feat_0010", label="named entity", cluster="reasoning", description="person/place/org reference"),
    Feature(id="feat_0011", label="apology pattern", cluster="refusal", description="'I'm sorry, but...'"),
    Feature(id="feat_0012", label="fabricated citation", cluster="unsupported", description="a source-like reference with no backing"),
]

_HEDGE_WORDS = {"might", "may", "could", "perhaps", "possibly", "seems"}
_REFUSAL_WORDS = {"cannot", "can't", "sorry", "unable", "won't"}
_UNSUPPORTED_WORDS = {"clearly", "obviously", "everyone", "studies", "always"}

_FAKE_CONTINUATION = (
    "The model appears to consider several possibilities before it might "
    "commit to an answer, though it cannot always verify the claim and "
    "obviously some of this reasoning could be unsupported by evidence."
).split()


async def run_mock_stream(
    prompt: str,
    clamps: dict[str, float],
    send: Callable[[dict], Awaitable[None]],
) -> None:
    """Emit a fake but contract-shaped stream for `prompt`.

    `clamps` maps feature_id -> value in [-1, 1]; a clamped-up feature
    fires more often and more strongly, a clamped-down one fires less —
    this is what makes "clamp a feature, watch the output change" visible
    even before the real steering path exists.
    """
    await send(StatusEvent(state="streaming").model_dump(exclude_none=True))

    tokens = (prompt.split() or ["..."]) + _FAKE_CONTINUATION
    for i, word in enumerate(tokens):
        await asyncio.sleep(0.12)
        await send(TokenEvent(index=i, text=word, position=i).model_dump())

        # 1-3 features fire per token, biased toward whichever cluster the
        # word looks like it belongs to, and reweighted by active clamps.
        firing = random.sample(FEATURES, k=random.randint(1, 3))
        lowered = word.strip(".,").lower()
        for feature in firing:
            base = random.uniform(0.1, 0.6)
            if lowered in _HEDGE_WORDS and feature.cluster == "hedging":
                base += 0.35
            if lowered in _REFUSAL_WORDS and feature.cluster == "refusal":
                base += 0.35
            if lowered in _UNSUPPORTED_WORDS and feature.cluster == "unsupported":
                base += 0.35

            clamp = clamps.get(feature.id, 0.0)
            value = max(0.0, min(1.0, base + clamp * 0.4))

            await send(
                ActivationEvent(
                    token_index=i,
                    feature_id=feature.id,
                    value=round(value, 3),
                    coords=_coords_for(feature.id),
                ).model_dump(exclude_none=True)
            )

            if value > 0.75 and feature.cluster in ("hedging", "refusal", "unsupported"):
                await send(
                    FlagEvent(
                        token_index=i,
                        signature=feature.cluster,  # type: ignore[arg-type]
                        confidence=round(value, 3),
                    ).model_dump()
                )

    await send(StatusEvent(state="done").model_dump(exclude_none=True))


def _coords_for(feature_id: str) -> Coords:
    """Deterministic fake 3D position per feature, stable across runs.

    Real version: precompute once via UMAP/t-SNE over the SAE/NLA feature
    set at startup and cache it — don't recompute per event.
    """
    seed = int(feature_id.split("_")[-1])
    rng = random.Random(seed)
    return Coords(x=rng.uniform(-20, 20), y=rng.uniform(-20, 20), z=rng.uniform(-5, 5))
