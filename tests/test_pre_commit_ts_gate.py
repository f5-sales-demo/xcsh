"""Keep xcsh's active Git hook aligned with CI's TypeScript gate."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
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
        assert "python3 scripts/check_docs_quality.py || exit 1" in hook_lines
        assert "XCSH_DOCS_QUALITY_CHECK" not in hook
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


# Fixture commands use fixed executables and a test-owned Git repository.
# ruff: noqa: S603


class PreCommitShellGateTests(unittest.TestCase):
    def test_gate_rejects_shellcheck_errors_before_typescript(self):
        hook = (ROOT / ".githooks/pre-commit").read_text()
        assert hook.index("python3 scripts/check_shell.py --staged") < hook.index(
            "bun run check:ts"
        )
        git = shutil.which("git")
        assert git is not None
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "tools"
            tools.mkdir()
            shellcheck = tools / "shellcheck"
            shellcheck.write_text(
                f"#!{sys.executable}\n"
                "import pathlib,sys\n"
                "bad=any('export FIXTURE=' in pathlib.Path(p).read_text() for p in sys.argv[3:])\n"
                "if bad: print('SC2155')\n"
                "raise SystemExit(int(bad))\n"
            )
            shfmt = tools / "shfmt"
            shfmt.write_text(
                f"#!{sys.executable}\nimport sys\n"
                "if '--version' in sys.argv: print('v3.13.1')\n"
            )
            shellcheck.chmod(0o755)
            shfmt.chmod(0o755)
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"])
            subprocess.run([git, "init", "-q", directory], check=True)
            script = root / "fixture.sh"
            script.write_text('#!/bin/sh\nexport FIXTURE="$(mktemp -d)"\n')
            subprocess.run([git, "-C", directory, "add", "fixture.sh"], check=True)
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/check_shell.py"), "--staged"],
                cwd=directory,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode != 0
            assert "SC2155" in result.stdout + result.stderr
            script.write_text('#!/bin/sh\nFIXTURE="$(mktemp -d)"\nexport FIXTURE\n')
            subprocess.run([git, "-C", directory, "add", "fixture.sh"], check=True)
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/check_shell.py"), "--staged"],
                cwd=directory,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr


if __name__ == "__main__":
    unittest.main()
