#!/usr/bin/env python3
"""Regression tests for the documentation quality contract checker."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts" / "check-docs-quality.py"


class DocsQualityCheckerTests(unittest.TestCase):
    def fixture(self, page: str, *, heading: str = "Do the task", evidence: bool = True) -> Path:
        temp = Path(tempfile.mkdtemp(prefix="docs-quality-test-"))
        docs = temp / "docs" / "en"
        evidence_dir = temp / ".github" / "docs-quality" / "evidence"
        docs.mkdir(parents=True)
        evidence_dir.mkdir(parents=True)
        (docs / "task.mdx").write_text(page, encoding="utf-8")
        receipt = evidence_dir / "offline.txt"
        receipt.write_text("command: xcsh --version\nexit_status: 0\nxcsh/21.11.7\n", encoding="utf-8")
        receipt_sha = hashlib.sha256(receipt.read_bytes()).hexdigest()
        inventory = {
            "schemaVersion": 1,
            "pages": [
                {
                    "path": "docs/en/task.mdx",
                    "classification": "how-to",
                    "audience": "operators",
                    "readerNeed": "Run one bounded task.",
                    "purpose": "Give the exact command and observed result.",
                    "sourceAuthority": ["packages/coding-agent/src/cli.ts"],
                    "evidence": ["offline-version"] if evidence else [],
                    "headings": [
                        {
                            "text": heading,
                            "readerQuestion": "How do I do the bounded task?",
                            "purpose": "Provide the command.",
                            "evidence": ["offline-version"] if evidence else [],
                        }
                    ],
                }
            ],
        }
        (temp / ".github" / "docs-quality" / "inventory.json").write_text(
            json.dumps(inventory), encoding="utf-8"
        )
        manifest = {
            "schemaVersion": 1,
            "evidence": [
                {
                    "id": "offline-version",
                    "receipt": ".github/docs-quality/evidence/offline.txt",
                    "receiptSha256": receipt_sha,
                    "sourceDigest": "a" * 40,
                    "xcshVersion": "21.11.7",
                    "command": "xcsh --version",
                    "exitStatus": 0,
                    "verificationLevel": "executed",
                    "cleanupResult": "not-required",
                    "sections": ["docs/en/task.mdx#Do the task"],
                }
            ],
        }
        (evidence_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return temp

    def run_checker(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(CHECKER), "--root", str(root)],
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_rejected(self, root: Path, needle: str) -> None:
        result = self.run_checker(root)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(needle, result.stdout + result.stderr)

    def test_rejects_known_boilerplate(self) -> None:
        root = self.fixture(
            "---\ntitle: Task\n---\n## Do the task\n\n"
            "The command or interface reports completion in the selected scope.\n"
        )
        self.assert_rejected(root, "known boilerplate")

    def test_rejects_duplicate_substantive_prose(self) -> None:
        paragraph = (
            "This deliberately long paragraph represents substantive guidance that should exist "
            "in one canonical location and must not be copied between two separate reader pages."
        )
        root = self.fixture(f"---\ntitle: Task\n---\n## Do the task\n\n{paragraph}\n")
        (root / "docs" / "en" / "other.mdx").write_text(
            f"---\ntitle: Other\n---\n## Decide another task\n\n{paragraph}\n", encoding="utf-8"
        )
        inventory_path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(inventory_path.read_text())
        inventory["pages"].append(
            {
                "path": "docs/en/other.mdx",
                "classification": "concept",
                "audience": "operators",
                "readerNeed": "Understand another task.",
                "purpose": "Explain another task.",
                "sourceAuthority": ["packages/coding-agent/src/cli.ts"],
                "evidence": [],
                "headings": [
                    {
                        "text": "Decide another task",
                        "readerQuestion": "When is the other task useful?",
                        "purpose": "Explain the choice.",
                        "evidence": [],
                    }
                ],
            }
        )
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "duplicate substantive prose")

    def test_rejects_missing_section_purpose(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n", heading="Wrong heading")
        self.assert_rejected(root, "heading missing from inventory")

    def test_rejects_stale_transcript(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n")
        receipt = root / ".github" / "docs-quality" / "evidence" / "offline.txt"
        receipt.write_text("changed\n", encoding="utf-8")
        self.assert_rejected(root, "receipt digest mismatch")

    def test_rejects_output_without_evidence(self) -> None:
        root = self.fixture(
            "---\ntitle: Task\n---\n## Do the task\n\n```console\nxcsh/21.11.7\n```\n",
            evidence=False,
        )
        self.assert_rejected(root, "output block has no evidence")

    def test_rejects_orphan_page(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n")
        inventory_path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(inventory_path.read_text())
        inventory["pages"] = []
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "page missing from inventory")


if __name__ == "__main__":
    unittest.main()
