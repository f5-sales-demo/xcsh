"""Keep xcsh's active Git hook aligned with CI's TypeScript gate."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PreCommitTypeScriptGateContract(unittest.TestCase):
    def test_hook_runs_ci_typescript_command_after_staged_checks(self):
        package = json.loads((ROOT / "package.json").read_text())
        hook = (ROOT / ".githooks/pre-commit").read_text()
        ci_commands = [command.strip() for command in package["scripts"]["ci:check:full"].split("&&")]

        self.assertIn("bun run check:ts", ci_commands)
        self.assertIn("python3 -m unittest tests.test_pre_commit_ts_gate", ci_commands)
        self.assertIn("bun run check:ts", hook.splitlines())
        self.assertLess(
            hook.index("./node_modules/.bin/lint-staged"),
            hook.index("\nbun run check:ts\n"),
        )
        self.assertRegex(hook, r"(?m)^if ! bun run check:dependencies; then$")
        self.assertRegex(hook, r"(?m)^UNSTAGED_FILES=\$\(git diff --name-only --\)")
        self.assertRegex(hook, r"(?m)^UNTRACKED_FILES=\$\(git ls-files --others --exclude-standard\)")
        self.assertRegex(hook, r"(?m)^ACTUAL_BUN=\$\(bun --version\)")
        self.assertRegex(hook, r"(?m)^EXPECTED_BUN=\$\(sed -n ")


if __name__ == "__main__":
    unittest.main()
