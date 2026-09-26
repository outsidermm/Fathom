"""Placeholder feature catalogue served by GET /api/features for the feature
map. It is not model data: the live backend emits no activation events yet.
"""

from __future__ import annotations

from .schemas import Feature

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
