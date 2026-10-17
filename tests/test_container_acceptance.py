import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "acceptance",
    Path(__file__).resolve().parents[1] / "scripts/container/acceptance.py",
)
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class AcceptanceTests(unittest.TestCase):
    def test_deferred_service_is_reported_and_never_claims_full_suite_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / "workspace"
            workspace.mkdir()
            report = root / "report.json"
            subprocess_calls = []

            def run(command, **kwargs):
                subprocess_calls.append(command)
                if "inspect" in command:
                    return SimpleNamespace(
                        stdout=json.dumps(
                            [
                                {
                                    "Id": "sha256:fixture",
                                    "Architecture": "arm64",
                                }
                            ]
                        )
                    )
                if command[-1] == "container-test":
                    return SimpleNamespace(
                        returncode=0, stdout="xcsh/23.5.2\n", stderr=""
                    )
                if command[-1] == acceptance.LOCAL_PROMPT:
                    (workspace / "status.txt").write_text("complete\n")
                    (workspace / "acceptance-result.json").write_text(
                        json.dumps(
                            {
                                "rg": 2,
                                "jq": 42,
                                "python": 42,
                                "browser": "XCSH_BROWSER_42",
                                "edited": True,
                            }
                        )
                    )
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with (
                patch.object(acceptance.platform, "machine", return_value="arm64"),
                patch.object(acceptance.subprocess, "run", side_effect=run),
                patch.object(
                    acceptance,
                    "evaluate",
                    side_effect=lambda *_args, **_kwargs: {"passed": True},
                ),
            ):
                assert acceptance.acceptance(
                    ["podman", "run", "candidate"],
                    str(workspace),
                    [
                        "--candidate",
                        "--live",
                        "--defer-service",
                        "firecrawl",
                        "--expected-version",
                        "23.5.2",
                        "--report",
                        str(report),
                    ],
                )
            outcomes = json.loads(report.read_text())
            assert outcomes["passed"]
            assert not outcomes["fullSuitePassed"]
            assert outcomes["deferredServices"] == ["firecrawl"]
            services = {sample["service"] for sample in outcomes["samples"]}
            assert services == {"local", *acceptance.LIVE} - {"firecrawl"}
            assert all(
                command[-1] != acceptance.LIVE["firecrawl"][0]
                for command in subprocess_calls
            )

    def test_text_only_success_is_rejected(self):
        events = [
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "provider": "litellm",
                    "model": "gpt-6.1-sol",
                    "api": "openai-responses",
                    "content": [{"type": "text", "text": "LOCAL_ACCEPTANCE_OK"}],
                },
            }
        ]
        assert not acceptance.evaluate(
            events, "litellm/gpt-6.1-sol:medium", "LOCAL_ACCEPTANCE_OK"
        )["passed"]

    def test_f5_curl_inventory_requires_operation_and_returned_fields(self):
        calls = {
            "inventory": {
                "toolName": "bash",
                "args": {
                    "command": 'curl -fsS -H "Authorization: APIToken $XCSH_API_TOKEN" "${XCSH_API_URL%/}/api/web/namespaces"'
                },
            }
        }
        results = [
            {
                "toolCallId": "inventory",
                "result": {
                    "content": [{"type": "text", "text": '{"items":[],"errors":[]}'}],
                },
            }
        ]
        assert acceptance.live_evidence(calls, results, "f5")
        calls["inventory"]["args"]["command"] = "printf LIVE_F5_OK"
        assert not acceptance.live_evidence(calls, results, "f5")
        calls["inventory"] = {"toolName": "xcsh_context", "args": {"action": "show"}}
        assert not acceptance.live_evidence(calls, results, "f5")
        calls["inventory"] = {
            "toolName": "xcsh_api",
            "args": {"method": "GET", "path": "/api/web/namespaces"},
        }
        assert acceptance.live_evidence(calls, results, "f5")

    def test_malformed_tool_events_and_unmatched_calls_are_rejected(self):
        events = [{"type": "tool_execution_start"}]
        assert not acceptance.evaluate(events, "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]
        assert not acceptance.evaluate([None], "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]

    def test_invalid_selector_and_flat_content_are_rejected(self):
        assert not acceptance.evaluate([], "unqualified", "MARKER")["passed"]
        events = [
            {
                "type": "message_end",
                "message": {"role": "assistant", "content": "MARKER"},
            }
        ]
        assert not acceptance.evaluate(events, "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]

    def test_live_marker_from_a_shell_echo_is_rejected(self):
        events = [
            {
                "type": "tool_execution_start",
                "toolCallId": "fixture",
                "toolName": "bash",
                "args": {"command": "printf LIVE_GITHUB_OK"},
            },
            {
                "type": "tool_execution_end",
                "toolCallId": "fixture",
                "toolName": "bash",
                "isError": False,
                "result": {"content": [{"text": "LIVE_GITHUB_OK"}]},
            },
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "provider": "litellm",
                    "model": "gpt-6.1-sol",
                    "api": "openai-responses",
                    "content": [{"type": "text", "text": "LIVE_GITHUB_OK"}],
                },
            },
        ]
        assert not acceptance.evaluate(
            events, "litellm/gpt-6.1-sol:medium", "LIVE_GITHUB_OK", service="github"
        )["passed"]

    def test_live_summary_requires_successful_service_results_and_final_marker(self):
        events = [
            {
                "type": "tool_execution_start",
                "toolCallId": "github",
                "toolName": "bash",
                "args": {"command": "gh api user && gh api repos/f5-sales-demo/xcsh"},
            },
            {
                "type": "tool_execution_end",
                "toolCallId": "github",
                "isError": False,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": '{"login":"fixture","full_name":"f5-sales-demo/xcsh","default_branch":"main"}',
                        }
                    ]
                },
            },
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "provider": "anthropic",
                    "model": "claude-sonnet-5",
                    "api": "anthropic-messages",
                    "content": [
                        {
                            "type": "text",
                            "text": "Both authorized retrievals succeeded.\n\nLIVE_GITHUB_OK",
                        }
                    ],
                },
            },
        ]
        assert acceptance.evaluate(
            events, "anthropic/claude-sonnet-5", "LIVE_GITHUB_OK", service="github"
        )["passed"]
        events[1]["isError"] = True
        assert not acceptance.evaluate(
            events, "anthropic/claude-sonnet-5", "LIVE_GITHUB_OK", service="github"
        )["passed"]

    def test_matching_tool_result_and_resolved_route_are_required(self):
        events = [
            {
                "type": "tool_execution_start",
                "toolCallId": "fixture",
                "toolName": "bash",
            },
            {
                "type": "tool_execution_end",
                "toolCallId": "fixture",
                "toolName": "bash",
                "isError": False,
            },
            {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "provider": "litellm",
                    "model": "gpt-6.1-sol",
                    "api": "openai-responses",
                    "content": [{"type": "text", "text": "MARKER"}],
                },
            },
        ]
        assert acceptance.evaluate(events, "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]
        events[1]["isError"] = True
        assert not acceptance.evaluate(events, "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]


if __name__ == "__main__":
    unittest.main()
