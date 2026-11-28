"""Exercise full prerequisite admission with isolated versioned tool fixtures."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

VERIFIER = (
    Path(__file__).resolve().parent.parent / "scripts/verify-self-hosted-tools.sh"
)


class FullRunnerPrerequisiteTests(unittest.TestCase):
    def invoke(self, zig="0.16.0", missing_component=False, missing_target=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "bin"
            tools.mkdir()
            components = ["rustfmt", "clippy", "rust-analyzer"]
            if missing_component:
                components.remove("clippy")
            targets = [
                "x86_64-unknown-linux-gnu",
                "x86_64-pc-windows-msvc",
                "aarch64-unknown-linux-gnu",
            ]
            if missing_target:
                targets.remove("aarch64-unknown-linux-gnu")
            scripts = {
                "id": "printf '1001\\n'",
                "bun": "printf '1.4.5\\n'",
                "zig": f"printf '%s\\n' '{zig}'",
                "rustc": "printf 'rustc qualification fixture\\n'",
                "cargo": "printf 'cargo-nextest 0.9.143\\n'",
                "rustup": (
                    'case "$1 $2" in\n'
                    "  'show active-toolchain') printf 'nightly-2026-09-03-x86_64-unknown-linux-gnu\\n';;\n"
                    "  'component list') printf '%s\\n' "
                    + " ".join(components)
                    + ";;\n"
                    "  'target list') printf '%s\\n' " + " ".join(targets) + ";;\n"
                    "  *) exit 2;;\nesac"
                ),
            }
            for name in (
                "llvm-nm",
                "fd",
                "rg",
                "magick",
                "aarch64-linux-gnu-gcc",
                "dpkg-query",
            ):
                scripts[name] = "exit 0"
            for name, source in scripts.items():
                executable = tools / name
                executable.write_text("#!/bin/sh\n" + source + "\n")
                executable.chmod(0o755)
            environment = {
                **os.environ,
                "PATH": str(tools) + ":" + os.environ["PATH"],
                "XCSH_EXPECTED_TOOL_ROOT": str(root),
            }
            return subprocess.run(  # noqa: S603
                ["/bin/bash", str(VERIFIER), "full"],
                env=environment,
                capture_output=True,
                check=False,
            )

    def test_complete_qualified_profile_is_admitted(self):
        assert self.invoke().returncode == 0

    def test_incorrect_zig_version_is_identified(self):
        result = self.invoke(zig="0.15.2")
        assert result.returncode != 0
        assert "Zig version" in result.stderr.decode()
        assert "0.16.0" in result.stderr.decode()
        assert "0.15.2" in result.stderr.decode()

    def test_missing_compiler_component_is_identified(self):
        result = self.invoke(missing_component=True)
        assert result.returncode != 0
        assert "Rust component missing: clippy" in result.stderr.decode()

    def test_missing_cross_target_is_identified(self):
        result = self.invoke(missing_target=True)
        assert result.returncode != 0
        assert (
            "Rust target missing: aarch64-unknown-linux-gnu" in result.stderr.decode()
        )


if __name__ == "__main__":
    unittest.main()
