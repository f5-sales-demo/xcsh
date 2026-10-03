# ruff: noqa: INP001
"""Deterministic reciprocal rank fusion for development retrieval experiments."""

from collections.abc import Sequence


def fuse_rankings(
    lexical: Sequence[str],
    semantic: Sequence[str],
    rank_constant: int = 20,
    limit: int = 5,
) -> list[tuple[str, float]]:
    """Fuse unique exact destinations; expose ranking values, never probabilities."""
    if rank_constant < 1 or limit < 1:
        message = "Rank constant and result limit must be positive"
        raise ValueError(message)
    scores: dict[str, float] = {}
    for ranking in (lexical, semantic):
        unique = list(dict.fromkeys(ranking))
        for rank, destination in enumerate(unique):
            scores[destination] = scores.get(destination, 0.0) + 1 / (
                rank_constant + rank
            )
    return [
        (destination, round(scores[destination], 12))
        for destination in sorted(scores, key=lambda value: (-scores[value], value))[
            :limit
        ]
    ]
