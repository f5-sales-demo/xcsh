"""Keep xcsh's active Git hook aligned with CI's TypeScript gate."""

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PreCommitTypeScriptGateContract(unittest.TestCase):
    def test_hook_runs_ci_typescript_command_after_staged_checks(self):
        package = json.loads((ROOT / "package.json").read_text())
        hook = (ROOT / ".githooks/pre-commit").read_text()
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        ci_commands = [
            command.strip()
            for command in package["scripts"]["ci:check:full"].split("&&")
        ]

        assert "bun run check:ts" in ci_commands
        assert "run: bun run ci:check:full" in workflow
        assert "run: python3 -m unittest tests.test_pre_commit_ts_gate" in workflow
        hook_lines = hook.splitlines()
        assert "bun run check:ts" in hook_lines
        assert hook_lines.index(
            "./node_modules/.bin/lint-staged || exit 1"
        ) < hook_lines.index("bun run check:ts")
        assert "if ! bun run check:dependencies; then" in hook_lines
        assert "UNSTAGED_FILES=$(git diff --name-only --) || exit 1" in hook_lines
        assert (
            "UNTRACKED_FILES=$(git ls-files --others --exclude-standard) || exit 1"
            in hook_lines
        )
        assert "ACTUAL_BUN=$(bun --version) || exit 1" in hook_lines
        assert any(line.startswith("EXPECTED_BUN=$(sed -n ") for line in hook_lines)


if __name__ == "__main__":
    unittest.main()
