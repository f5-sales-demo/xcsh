from __future__ import annotations

# ruff: noqa: PT009
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class CiOutcomeContractTests(unittest.TestCase):
    def test_current_delivery_graph_satisfies_the_contract(self) -> None:
        result = subprocess.run(
            [sys.executable, "scripts/validate_ci_outcome_contract.py"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("validated", result.stdout)


if __name__ == "__main__":
    unittest.main()
