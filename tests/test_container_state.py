"""Container state and credential handling contracts (no cloud mutations)."""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "scripts/container" / (name + ".py")
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StateTests(unittest.TestCase):
    def setUp(self):
        # TestCase owns this context until teardown.
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))  # pylint: disable=consider-using-with
        self.home = self.root / "home"
        self.seed = self.root / "seed"
        (self.seed / "plugins").mkdir(parents=True)
        (self.seed / "plugins/installed_plugins.json").write_text(
            '{"version":2,"plugins":{"test":[]}}'
        )
        self.state = load("state")

    def test_first_launch_and_restart_preserve_uninstall_disable_and_settings(self):
        self.state.seed_state(self.home, self.seed)
        registry = self.home / ".xcsh/plugins/installed_plugins.json"
        registry.write_text('{"version":2,"plugins":{}}')
        config = self.home / ".xcsh/agent/config.yml"
        config.write_text("browser:\n  headless: true\n")
        self.state.seed_state(self.home, self.seed)
        assert json.loads(registry.read_text())["plugins"] == {}
        assert config.read_text() == "browser:\n  headless: true\n"

    def test_existing_state_and_interrupted_staging_are_preserved(self):
        (self.home / ".xcsh").mkdir(parents=True)
        (self.home / ".xcsh/settings").write_text("existing")
        (self.home / ".xcsh-seed-interrupted").mkdir()
        self.state.seed_state(self.home, self.seed)
        assert (self.home / ".xcsh/settings").read_text() == "existing"
        assert not (self.home / ".xcsh/plugins").exists()

    def test_failed_copy_is_retryable_and_portable_sessions_are_preserved(self):
        with patch.object(
            self.state.shutil, "copytree", side_effect=OSError("fixture interruption")
        ):
            rejected = False
            try:
                self.state.seed_state(self.home, self.seed)
            except OSError:
                rejected = True
            assert rejected
        assert not (self.home / ".xcsh").exists()
        self.state.seed_state(self.home, self.seed)
        source = self.root / "credentials"
        source.mkdir()
        (source / "session").write_text("initial")
        (source / "virtenv/bin").mkdir(parents=True)
        (source / "virtenv/bin/python").symlink_to("/missing/mac-python")
        target = self.home / ".aws"
        self.state.import_portable(self.home, source, target)
        (target / "session").write_text("refreshed")
        self.state.import_portable(self.home, source, target)
        assert (target / "session").read_text() == "refreshed"
        assert not (target / "virtenv").exists()
        assert (target / "session").stat().st_mode & 0o777 == 0o600

    def test_empty_precreated_state_is_seeded(self):
        (self.home / ".xcsh").mkdir(parents=True)
        self.state.seed_state(self.home, self.seed)
        assert (self.home / ".xcsh/plugins/installed_plugins.json").exists()

    def test_auth_missing_and_partial_credentials_never_call_cli(self):
        auth = load("auth")
        for env in (
            {},
            {"AZURE_CLIENT_ID": "fixture-client"},
            {"SF_ACCESS_TOKEN": "fixture-secret"},
        ):
            with (
                self.subTest(keys=list(env)),
                patch.dict(os.environ, env, clear=True),
                patch.object(auth, "run") as run,
            ):
                rejected = False
                try:
                    auth.login(
                        "azure" if "SF_ACCESS_TOKEN" not in env else "salesforce",
                        interactive=False,
                    )
                except ValueError:
                    rejected = True
                assert rejected
                run.assert_not_called()

    def test_vendor_failures_are_classified_without_disclosing_secret(self):
        auth = load("auth")
        for error, category in (
            ("expired fixture-secret", "expired_credentials"),
            ("403 insufficient scope fixture-secret", "insufficient_authorization"),
            ("401 invalid fixture-secret", "invalid_credentials"),
            ("SSL certificate fixture-secret", "certificate_trust"),
            ("proxy fixture-secret", "proxy"),
            ("429 rate limit fixture-secret", "rate_limit"),
            ("connection timeout fixture-secret", "endpoint_unavailable"),
        ):
            with patch.object(
                auth.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=1, stderr=error),
            ):
                rejected = ""
                try:
                    auth.run(["az", "account", "show"])
                except ValueError as failure:
                    rejected = str(failure)
                assert category in rejected
                assert "fixture-secret" not in rejected

    def test_explicit_token_login_initializes_private_cli_state_without_token_argv(
        self,
    ):
        auth = load("auth")
        for service, name in (("github", "GH_TOKEN"), ("gitlab", "GITLAB_TOKEN")):
            with (
                patch.dict(os.environ, {name: "fixture-secret"}, clear=True),
                patch.object(auth, "run") as run,
            ):
                auth.login(service, interactive=False)
                assert run.call_count == 2
                assert "fixture-secret" not in run.call_args.args[0]
                assert run.call_args.kwargs["stdin_text"] == "fixture-secret\n"
                assert name not in run.call_args.kwargs["environment"]

    def test_redacted_credentials_stop_before_cli_and_private_errors_are_scrubbed(self):
        auth = load("auth")
        with (
            patch.dict(os.environ, {"SF_AUTH_URL": "[REDACTED]"}, clear=True),
            patch.object(auth, "run") as run,
        ):
            rejected = False
            try:
                auth.login("salesforce", interactive=False)
            except ValueError as failure:
                rejected = "redacted" in str(failure)
            assert rejected
            run.assert_not_called()
        with (
            patch.dict(
                os.environ,
                {
                    "XCSH_CONTAINER": "1",
                    "HOME": str(self.home),
                    "SF_ACCESS_TOKEN": "fixture-secret",
                },
                clear=True,
            ),
            patch.object(
                auth.subprocess,
                "run",
                return_value=SimpleNamespace(
                    returncode=1, stderr="401 invalid fixture-secret"
                ),
            ),
        ):
            rejected = False
            try:
                auth.run(["sf", "org", "display"])
            except ValueError as failure:
                rejected = "invalid_credentials" in str(failure)
            assert rejected
        diagnostic = self.home / ".xcsh/auth-diagnostics/sf.stderr"
        assert "fixture-secret" not in diagnostic.read_text()
        assert diagnostic.stat().st_mode & 0o777 == 0o600

    def test_azure_session_initialization_selects_subscription_after_login(self):
        auth = load("auth")
        env = {
            "AZURE_CLIENT_ID": "fixture-client",
            "AZURE_CLIENT_SECRET": "fixture-secret",
            "AZURE_TENANT_ID": "fixture-tenant",
            "AZURE_SUBSCRIPTION_ID": "fixture-subscription",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(auth, "run") as run:
            auth.login("azure", interactive=False)
        assert run.call_count == 2
        assert "--service-principal" in run.call_args_list[0].args[0]
        assert run.call_args_list[1].args[0] == [
            "az",
            "account",
            "set",
            "--subscription",
            "fixture-subscription",
        ]

    def test_salesforce_auth_url_uses_stdin_without_secret_in_argv(self):
        auth = load("auth")
        with (
            patch.dict(os.environ, {"SF_AUTH_URL": "fixture-secret"}, clear=True),
            patch.object(auth, "run") as run,
        ):
            auth.login("salesforce", interactive=False)
        assert "fixture-secret" not in run.call_args.args[0]
        assert run.call_args.kwargs["stdin_text"] == "fixture-secret\n"
        assert run.call_args.args[0][-2:] == ["--set-default", "--sfdx-url-stdin"]

    def test_vendor_auth_uses_private_home_instead_of_selected_workspace(self):
        auth = load("auth")
        with (
            patch.dict(os.environ, {"XCSH_CONTAINER": "1", "HOME": str(self.home)}),
            patch.object(
                auth.subprocess, "run", return_value=SimpleNamespace(returncode=0)
            ) as run,
        ):
            auth.run(["sf", "config", "list", "--json"])
        assert run.call_args.kwargs["cwd"] == str(self.home)


if __name__ == "__main__":
    unittest.main()
