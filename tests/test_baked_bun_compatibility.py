"""Exercise exact baked Bun admission for the current approved worker version."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class BakedBunCompatibilityTests(unittest.TestCase):
    def verify(self, version, expected_path=True, uid="1001", diagnostics=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "bin"
            tools.mkdir()
            for name, output in (("id", uid), ("bun", version)):
                executable = tools / name
                executable.write_text("#!/bin/sh\nprintf '%s\\n' '" + output + "'\n")
                executable.chmod(0o755)
            environment = {**os.environ, "PATH": str(tools) + ":" + os.environ["PATH"]}
            if expected_path:
                environment["XCSH_EXPECTED_TOOL_ROOT"] = str(root)
            else:
                environment.pop("XCSH_EXPECTED_TOOL_ROOT", None)
            # The argv contains only the fixed repository verifier and a fixed scope.
            result = subprocess.run(  # noqa: S603
                ["/bin/bash", str(ROOT / "scripts/verify-self-hosted-tools.sh"), "bun"],
                env=environment,
                capture_output=True,
                check=False,
            )
            return result if diagnostics else result.returncode

    def test_qualified_worker_patch_is_admitted(self):
        assert self.verify("1.4.5") == 0

    def test_obsolete_patch_is_rejected(self):
        assert self.verify("1.4.4") != 0

    def test_incorrect_worker_uid_is_rejected(self):
        assert self.verify("1.4.5", uid="1000") != 0

    def test_arbitrary_path_is_rejected(self):
        assert self.verify("1.4.5", expected_path=False) != 0

    def test_wrong_bun_version_reports_expected_and_observed(self):
        result = self.verify("1.4.4", diagnostics=True)
        assert result.returncode != 0
        assert "Bun version" in result.stderr.decode()
        assert "1.4.5" in result.stderr.decode()
        assert "1.4.4" in result.stderr.decode()

    def test_wrong_worker_uid_reports_expected_and_observed(self):
        result = self.verify("1.4.5", uid="1000", diagnostics=True)
        assert result.returncode != 0
        assert "worker UID" in result.stderr.decode()
        assert "1001" in result.stderr.decode()
        assert "1000" in result.stderr.decode()

    def test_wrong_bun_path_reports_expected_and_observed(self):
        result = self.verify("1.4.5", expected_path=False, diagnostics=True)
        assert result.returncode != 0
        assert "Bun executable" in result.stderr.decode()
        assert "/usr/local/bin/bun" in result.stderr.decode()


if __name__ == "__main__":
    unittest.main()
