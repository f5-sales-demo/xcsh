# ruff: noqa: INP001, PT009, PT027
"""Deterministic experiment ranking tests independent of model and network."""

import unittest

from hybrid_ranking import fuse_rankings


class HybridRankingTests(unittest.TestCase):
    """Check destination identity, tie order and duplicate rank handling."""

    def test_ties_use_exact_destinations(self) -> None:
        """Input order cannot change equally supported destination ordering."""
        actual = fuse_rankings(["b", "a"], ["a", "b"])
        self.assertEqual([item[0] for item in actual], ["a", "b"])
        self.assertEqual(actual, fuse_rankings(["a", "b"], ["b", "a"]))

    def test_duplicate_aliases_do_not_add_evidence(self) -> None:
        """One destination contributes once from each retrieval source."""
        self.assertEqual(
            fuse_rankings(["a", "a", "b"], ["b", "a"]),
            fuse_rankings(["a", "b"], ["b", "a"]),
        )

    def test_scores_are_normalized_ranking_values(self) -> None:
        """Scores are reproducible at the consumer precision convention."""
        actual = fuse_rankings(["a", "b"], ["a", "c"])
        self.assertEqual(actual[0], ("a", 0.1))
        self.assertTrue(all(score == round(score, 12) for _, score in actual))

    def test_negative_rank_constant_rejected(self) -> None:
        """Invalid rank weights fail rather than divide by zero."""
        with self.assertRaises(ValueError):
            fuse_rankings(["a"], [], rank_constant=0)


if __name__ == "__main__":
    unittest.main()
