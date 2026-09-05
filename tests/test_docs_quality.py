"""Regression tests for the documentation quality contract checker."""

# ruff: noqa: INP001

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts" / "check_docs_quality.py"


class DocsQualityCheckerTests(unittest.TestCase):
    def fixture(
        self, page: str, *, heading: str = "Do the task", evidence: bool = True
    ) -> Path:
        temp = Path(tempfile.mkdtemp(prefix="docs-quality-test-"))
        docs = temp / "docs" / "en"
        evidence_dir = temp / ".github" / "docs-quality" / "evidence"
        docs.mkdir(parents=True)
        evidence_dir.mkdir(parents=True)
        (docs / "task.mdx").write_text(page, encoding="utf-8")
        receipt = evidence_dir / "offline.txt"
        receipt.write_text(
            "command: xcsh --version\nexit_status: 0\nxcsh/21.11.7\n", encoding="utf-8"
        )
        receipt_sha = hashlib.sha256(receipt.read_bytes()).hexdigest()
        legacy_id = "lc-fixture-concept"
        inventory = {
            "schemaVersion": 2,
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
                            "legacyConceptIds": [legacy_id],
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
        (evidence_dir / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        ledger = {
            "schemaVersion": 1,
            "baseline": {
                "commit": "fixture",
                "treeDigest": "b" * 40,
                "corpusDigestSha256": "c" * 64,
                "conceptDigestSha256": hashlib.sha256(
                    b"docs/en/legacy.md\0Legacy task\0" + b"d" * 40 + b"\n"
                ).hexdigest(),
                "pageCount": 1,
                "conceptCount": 1,
                "headingLevel": 2,
            },
            "concepts": [
                {
                    "id": legacy_id,
                    "legacyPath": "docs/en/legacy.md",
                    "legacyHeading": "Legacy task",
                    "legacyBlob": "d" * 40,
                    "category": "configuration",
                    "readerQuestion": "How did the legacy task work?",
                    "knowledgeSummary": "The task resolves one configuration value.",
                    "disposition": "retained",
                    "destinationPage": "docs/en/task.mdx",
                    "destinationHeading": heading,
                    "currentSourceAuthorities": ["packages/coding-agent/src/cli.ts"],
                    "evidenceIdentifiers": ["offline-version"],
                }
            ],
        }
        (temp / ".github" / "docs-quality" / "legacy-concepts.json").write_text(
            json.dumps(ledger), encoding="utf-8"
        )
        return temp

    def run_checker(self, root: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603 - fixed interpreter and checker paths
            [sys.executable, str(CHECKER), "--root", str(root)],
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_rejected(self, root: Path, needle: str) -> None:
        result = self.run_checker(root)
        assert result.returncode != 0, result.stdout + result.stderr
        assert needle in result.stdout + result.stderr

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
            f"---\ntitle: Other\n---\n## Decide another task\n\n{paragraph}\n",
            encoding="utf-8",
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
                        "legacyConceptIds": [],
                    }
                ],
            }
        )
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "duplicate substantive prose")

    def test_rejects_missing_section_purpose(self) -> None:
        root = self.fixture(
            "---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n",
            heading="Wrong heading",
        )
        self.assert_rejected(root, "heading missing from inventory")

    def test_rejects_stale_transcript(self) -> None:
        root = self.fixture(
            "---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n"
        )
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
        root = self.fixture(
            "---\ntitle: Task\n---\n## Do the task\n\nRun the command.\n"
        )
        inventory_path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(inventory_path.read_text())
        inventory["pages"] = []
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "page missing from inventory")


    def test_rejects_unmapped_legacy_concept(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(path.read_text())
        inventory["pages"][0]["headings"][0]["legacyConceptIds"] = []
        path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "unmapped legacy concept")

    def test_rejects_unknown_legacy_concept_id(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(path.read_text())
        inventory["pages"][0]["headings"][0]["legacyConceptIds"].append("lc-unknown")
        path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "unknown legacy concept id")

    def test_rejects_duplicate_legacy_concept_id(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "legacy-concepts.json"
        ledger = json.loads(path.read_text())
        ledger["concepts"].append(dict(ledger["concepts"][0]))
        ledger["baseline"]["conceptCount"] = 2
        path.write_text(json.dumps(ledger), encoding="utf-8")
        self.assert_rejected(root, "duplicate legacy concept id")

    def test_rejects_duplicate_legacy_concept_mapping(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "inventory.json"
        inventory = json.loads(path.read_text())
        inventory["pages"][0]["headings"][0]["legacyConceptIds"].append(
            "lc-fixture-concept"
        )
        path.write_text(json.dumps(inventory), encoding="utf-8")
        self.assert_rejected(root, "duplicate legacy concept mapping")

    def test_rejects_stale_legacy_destination(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "legacy-concepts.json"
        ledger = json.loads(path.read_text())
        ledger["concepts"][0]["destinationHeading"] = "Removed heading"
        path.write_text(json.dumps(ledger), encoding="utf-8")
        self.assert_rejected(root, "stale legacy destination")

    def test_rejects_missing_current_authority(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "legacy-concepts.json"
        ledger = json.loads(path.read_text())
        ledger["concepts"][0]["currentSourceAuthorities"] = []
        path.write_text(json.dumps(ledger), encoding="utf-8")
        self.assert_rejected(root, "legacy concept field missing")

    def test_rejects_generic_legacy_summary(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "legacy-concepts.json"
        ledger = json.loads(path.read_text())
        ledger["concepts"][0]["knowledgeSummary"] = "Covers task behavior for fixture."
        path.write_text(json.dumps(ledger), encoding="utf-8")
        self.assert_rejected(root, "generic legacy knowledge summary")

    def test_rejects_unexplained_superseded_concept(self) -> None:
        root = self.fixture("---\ntitle: Task\n---\n## Do the task\n\nRun it.\n")
        path = root / ".github" / "docs-quality" / "legacy-concepts.json"
        ledger = json.loads(path.read_text())
        ledger["concepts"][0]["disposition"] = "superseded"
        path.write_text(json.dumps(ledger), encoding="utf-8")
        self.assert_rejected(root, "unexplained superseded or corrected concept")


if __name__ == "__main__":
    unittest.main()
