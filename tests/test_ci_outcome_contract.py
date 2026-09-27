from __future__ import annotations

# ruff: noqa: PT009
import json
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

    def test_parallel_jobs_and_aggregate_dependencies_are_contracted(self) -> None:
        contract = json.loads(
            (ROOT / ".github" / "ci-outcome-contract.json").read_text(encoding="utf-8")
        )
        outcomes = {
            (entry["workflow"], entry["job"]): entry for entry in contract["outcomes"]
        }
        self.assertEqual(
            outcomes[("ci.yml", "test")]["needs"],
            ["test-typescript-independent", "test-typescript-native", "test-rust"],
        )
        self.assertEqual(
            outcomes[("container.yml", "publish-ghcr")]["needs"],
            ["publish-ghcr-amd64", "publish-ghcr-arm64"],
        )


if __name__ == "__main__":
    unittest.main()
