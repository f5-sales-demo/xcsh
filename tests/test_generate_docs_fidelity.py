"""Documentation authorities must come from durable tracked source files."""

# Standard-library unittest keeps generator verification dependency-free.
# ruff: noqa: PT009
import importlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
GIT_EXECUTABLE = shutil.which("git") or "git"
with patch.object(sys, "path", [str(ROOT / "scripts"), *sys.path]):
    GENERATOR = importlib.import_module("generate_docs_fidelity")


class TrackedAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.source = self.root / "source/helper.ts"
        self.source.parent.mkdir()
        self.source.write_text("// helper.ts\nexport const helper = true;\n")
        (self.root / ".gitignore").write_text("*.generated.ts\n")
        (self.root / "source/a.generated.ts").write_text("// helper.ts\n")
        (self.root / "source/untracked.ts").write_text("// helper.ts\n")
        subprocess.run(  # noqa: S603 - fixed git fixture initialization
            [GIT_EXECUTABLE, "init", "-q", str(self.root)],
            check=True,
            capture_output=True,
        )
        subprocess.run(  # noqa: S603 - fixed git fixture staging
            [
                GIT_EXECUTABLE,
                "-C",
                str(self.root),
                "add",
                ".gitignore",
                "source/helper.ts",
            ],
            check=True,
            capture_output=True,
        )
        GENERATOR.candidate_files.cache_clear()
        self.addCleanup(GENERATOR.candidate_files.cache_clear)
        GENERATOR.source_lines.cache_clear()
        self.addCleanup(GENERATOR.source_lines.cache_clear)

    def test_excludes_ignored_and_untracked_authorities(self):
        with patch.object(GENERATOR, "ROOT", self.root):
            self.assertEqual(GENERATOR.candidate_files("source"), (self.source,))

    def test_locator_uses_tracked_source_instead_of_generated_embedding(self):
        with patch.object(GENERATOR, "ROOT", self.root):
            locator = GENERATOR.authority_locator(
                "source", {"knowledgeSummary": "Uses `helper.ts`."}
            )
        self.assertEqual(locator["path"], "source/helper.ts")

    def test_exact_source_reference_precedes_unrelated_basename_match(self):
        unrelated = self.root / "source/a-unrelated.ts"
        unrelated.write_text("// helper.ts\n")
        subprocess.run(  # noqa: S603 - fixed git fixture staging
            [GIT_EXECUTABLE, "-C", str(self.root), "add", "source/a-unrelated.ts"],
            check=True,
            capture_output=True,
        )
        with patch.object(GENERATOR, "ROOT", self.root):
            locator = GENERATOR.authority_locator(
                "source", {"knowledgeSummary": "Uses `source/helper.ts`."}
            )
        self.assertEqual(locator["path"], "source/helper.ts")
