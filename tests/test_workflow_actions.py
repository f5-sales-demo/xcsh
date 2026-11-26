from __future__ import annotations

# ruff: noqa: PT009
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.lint_workflow_actions import actionlint_source

ROOT = Path(__file__).resolve().parent.parent
ADAPTER = ROOT / "scripts/lint_workflow_actions.py"
VALID = """name: Fixture
on: push
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: $/.github/actions/setup
"""


class WorkflowActionsTests(unittest.TestCase):
    def test_linter_retains_original_source_coordinates(self):
        adapted = actionlint_source(VALID)
        changes = [
            index
            for index, (a, b) in enumerate(zip(VALID, adapted, strict=True))
            if a != b
        ]
        self.assertEqual(changes, [VALID.index("$/")])
        self.assertEqual(adapted.count("\n"), VALID.count("\n"))

    def test_quoted_references_anchors_aliases_and_duplicate_fields(self):
        source = VALID.replace(
            "      - uses: $/.github/actions/setup\n",
            "      - uses: &setup '$/.github/actions/setup'\n"
            "      - uses: *setup\n"
            '      - uses: "$/.github/actions/second"\n'
            "        uses: $/.github/actions/third\n",
        )
        adapted = actionlint_source(source)
        self.assertNotIn("$/", adapted)
        self.assertIn("uses: *setup", adapted)
        self.assertEqual(len(source), len(adapted))

    def test_reusable_workflow_reference_is_adapted(self):
        source = "name: Reuse\non: push\njobs:\n  check:\n    uses: $/.github/workflows/local.yml\n"
        self.assertIn("uses: ./.github/workflows/local.yml", actionlint_source(source))

    def test_unrelated_strings_and_remote_actions_are_unchanged(self):
        source = VALID.replace("$/.github/actions/setup", "actions/checkout@v6") + (
            "      - run: echo '$/private'\n        env:\n          uses: $/unrelated\n"
        )
        self.assertEqual(actionlint_source(source), source)

    def test_malformed_yaml_is_passed_to_real_validator(self):
        source = VALID + "      - uses: [unterminated\n"
        self.assertEqual(actionlint_source(source), source)
        result = self.lint({"broken.yml": source})
        self.assertEqual(result.returncode, 1)
        self.assertIn("broken.yml", result.stdout + result.stderr)

    def test_current_real_linter_accepts_valid_self_reference(self):
        result = self.lint({"valid.yml": VALID})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_invalid_action_reference_still_fails(self):
        result = self.lint(
            {"invalid.yml": VALID.replace("$/.github/actions/setup", "owner/action")}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("ref is missing", result.stdout + result.stderr)

    def test_unknown_runner_still_fails(self):
        result = self.lint(
            {"runner.yml": VALID.replace("ubuntu-latest", "unknown-hosted-runner")}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn(
            'label "unknown-hosted-runner" is unknown.', result.stdout + result.stderr
        )
        self.assertIn("[runner-label]", result.stdout + result.stderr)

    def test_invalid_workflow_structure_still_fails(self):
        result = self.lint(
            {"structure.yml": VALID.replace("runs-on:", "invalid-property:")}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("invalid-property", result.stdout + result.stderr)

    def test_all_workflows_are_checked_after_first_failure(self):
        result = self.lint(
            {
                "a.yml": VALID.replace("$/.github/actions/setup", "owner/action"),
                "b.yaml": VALID.replace("runs-on:", "invalid-property:"),
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("a.yml", result.stdout + result.stderr)
        self.assertIn("b.yaml", result.stdout + result.stderr)

    def test_empty_directory_is_an_error(self):
        result = self.lint({})
        self.assertEqual(result.returncode, 2)
        self.assertIn("no workflow files found", result.stderr)

    def lint(self, workflows):
        actionlint = shutil.which("actionlint")
        self.assertIsNotNone(actionlint, "The normal actionlint executable is required")
        with tempfile.TemporaryDirectory(prefix="workflow lint ") as temporary:
            root = Path(temporary)
            directory = root / ".github/workflows"
            directory.mkdir(parents=True)
            (root / ".github/actionlint.yaml").write_text(
                "self-hosted-runner:\n  labels: []\n"
            )
            for name, source in workflows.items():
                (directory / name).write_text(source, encoding="utf-8")
            return subprocess.run(  # noqa: S603 -- fixed CLI argv and test-owned paths.
                [
                    sys.executable,
                    str(ADAPTER),
                    "--root",
                    str(root),
                    "--actionlint",
                    actionlint,
                ],
                cwd=root,
                text=True,
                capture_output=True,
                timeout=60,
                check=False,
            )


if __name__ == "__main__":
    unittest.main()
