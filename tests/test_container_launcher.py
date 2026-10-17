"""Launcher uses exact argument transport and private rootless mounts."""

import importlib.machinery
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader(
    "launcher", str(ROOT / "scripts/xcsh-podman")
)
spec = importlib.util.spec_from_loader(loader.name, loader)
assert spec is not None
launcher = importlib.util.module_from_spec(spec)
loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_model_argument_precedence_and_exact_forwarding(self):
        for arguments, expected in (
            (
                ["--model", "explicit/model", "literal $(do-not-run)"],
                ["--model", "explicit/model", "literal $(do-not-run)"],
            ),
            (["--model=explicit/model"], ["--model=explicit/model"]),
            (["--mode", "json"], ["--model", "default/model", "--mode", "json"]),
        ):
            with (
                patch.dict(os.environ, {"XCSH_MODEL": "default/model"}),
                patch(
                    "sys.argv",
                    ["xcsh-podman", "--image", "candidate", "run", *arguments],
                ),
                patch.object(launcher.shutil, "which", return_value="/usr/bin/podman"),
                patch.object(
                    launcher, "run_options", return_value=["podman", "run", "candidate"]
                ),
                patch.object(launcher.os, "execvp") as execute,
            ):
                launcher.main()
                assert execute.call_args.args[1] == [
                    "podman",
                    "run",
                    "candidate",
                    *expected,
                ]

    def test_rootless_runtime_options_and_explicit_mounts(self):
        with tempfile.TemporaryDirectory() as directory:
            args = SimpleNamespace(
                connection="selected",
                image="candidate",
                workspace=directory,
                state="private-fixture",
                stdin=False,
                env=[],
                env_file=[],
                mount=[],
                credential=[],
                ca_cert=None,
                import_native=None,
            )
            with patch.object(
                launcher, "call", return_value='{"host":{"security":{"rootless":true}}}'
            ):
                argv = launcher.run_options(args)
            args.command = "test"
            with (
                patch.object(
                    launcher,
                    "call",
                    return_value='{"host":{"security":{"rootless":true}}}',
                ),
                patch.object(launcher.sys.stdin, "isatty", return_value=True),
                patch.object(launcher.sys.stdout, "isatty", return_value=True),
            ):
                captured = launcher.run_options(args)
            assert "--tty" not in captured
            assert "--interactive" not in captured
            assert "--read-only" in argv
            assert "--userns=keep-id:uid=1000,gid=1000" in argv
            assert "--cap-drop=all" in argv
            assert "private-fixture:/home/xcsh:z,U" in argv
            assert str(Path.home()) + ":/home/xcsh" not in argv
            with (
                patch.object(
                    launcher,
                    "call",
                    return_value='{"host":{"security":{"rootless":false}}}',
                ),
            ):
                rejected = False
                try:
                    launcher.run_options(args)
                except ValueError as error:
                    rejected = str(error) == "Rootless Podman is required"
                assert rejected


if __name__ == "__main__":
    unittest.main()
