"""Mutation tests for acceptance evidence, independent of the provider fixture."""

import base64
import copy
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import time
import unittest
from contextlib import contextmanager

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "scripts/installed_agent_e2e.py"
SPEC = importlib.util.spec_from_file_location("installed_e2e", SOURCE)
E2E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E2E)


@contextmanager
def expected_rejection():
    try:
        yield
    except E2E.AcceptanceError:
        return
    reason = "invalid evidence was accepted"
    raise AssertionError(reason)


def evidence():
    metadata = {
        "executable": "/opt/fixture/xcsh",
        "version": "xcsh/25.0.3",
        "sha256": "a" * 64,
        "host": "fixture-host",
        "platform": "Linux",
        "architecture": "x86_64",
        "backend": "deterministic",
        "scenario": "explicit",
    }
    messages = [
        {
            "role": "assistant",
            "stopReason": "toolUse",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5",
            "content": [
                {
                    "type": "toolCall",
                    "id": "context-1",
                    "name": "xcsh_context",
                    "arguments": {"action": "status"},
                },
                {
                    "type": "toolCall",
                    "id": "api-1",
                    "name": "xcsh_api",
                    "arguments": {
                        "method": "GET",
                        "path": "/api/config/namespaces/{namespace}/http_loadbalancers",
                        "expandDiscovery": False,
                    },
                },
            ],
        },
        {
            "role": "toolResult",
            "toolCallId": "context-1",
            "toolName": "xcsh_context",
            "isError": False,
            "details": {
                "activeContextName": "context-a",
                "activeContextNamespace": "default",
                "credentialSource": "context",
            },
            "content": [],
        },
        {
            "role": "toolResult",
            "toolCallId": "api-1",
            "toolName": "xcsh_api",
            "isError": False,
            "details": {
                "status": 200,
                "itemCount": 1,
                "requestId": "logical-1",
                "method": "GET",
                "url": "https://fixture.invalid/api/config/namespaces/default/http_loadbalancers",
            },
            "content": [{"type": "text", "text": "resource-opaque-marker"}],
        },
        {
            "role": "assistant",
            "stopReason": "stop",
            "provider": "anthropic",
            "model": "claude-sonnet-4-5",
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "namespace": "default",
                            "apiStatus": 200,
                            "outcome": "success",
                            "resourceNames": ["resource-opaque-marker"],
                        }
                    ),
                }
            ],
        },
    ]
    requests = [
        {
            "method": "GET",
            "path": "/api/config/namespaces/default/http_loadbalancers",
            "status": 200,
            "credentialMatches": True,
            "context": "context-a",
            "endpoint": "context-a",
            "requestId": "logical-1",
            "url": "https://fixture.invalid/api/config/namespaces/default/http_loadbalancers",
        }
    ]
    expected = {
        "tools": ["xcsh_context", "xcsh_api"],
        "namespace": "default",
        "context": "context-a",
        "status": 200,
        "markers": ["resource-opaque-marker"],
        "requestCount": 1,
        "url": "https://fixture.invalid/api/config/namespaces/default/http_loadbalancers",
    }
    observations = {
        "savedProfilesUnchanged": True,
        "startupPointerUnchanged": True,
        "selectionFeedback": True,
        "selectionBorder": True,
        "selectionNetworkFree": True,
        "externalRgExecutions": 0,
        "evidenceComplete": True,
        "inheritedFallbackUnused": True,
    }
    return [metadata, messages, requests, expected, observations]


class EvidenceValidationTests(unittest.TestCase):
    def test_valid_observed_result(self):
        assert E2E.validate_evidence(*evidence())["result"] == "pass"

    def reject(self, mutate):
        value = copy.deepcopy(evidence())
        mutate(value)
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_missing_tool_call(self):
        self.reject(lambda v: v[1][0]["content"].pop())

    def test_missing_tool_result(self):
        self.reject(lambda v: v[1].pop(2))

    def test_wrong_tool_result_id(self):
        self.reject(lambda v: v[1][2].update(toolCallId="fabricated"))

    def test_wrong_namespace(self):
        self.reject(
            lambda v: v[2][0].update(
                path="/api/config/namespaces/old/http_loadbalancers"
            )
        )

    def test_wrong_credentials(self):
        self.reject(lambda v: v[2][0].update(credentialMatches=False))

    def test_backend_status_mismatch(self):
        self.reject(lambda v: v[2][0].update(status=403))

    def test_backend_unrelated_request(self):
        self.reject(lambda v: v[2][0].update(requestId="unrelated"))

    def test_wrong_backend_endpoint(self):
        self.reject(lambda v: v[2][0].update(endpoint="context-b"))

    def test_inherited_fallback_activity(self):
        self.reject(lambda v: v[4].update(inheritedFallbackUnused=False))

    def test_wrong_assistant_model(self):
        self.reject(lambda v: v[1][-1].update(model="other-model"))

    def test_context_activation_cannot_substitute_for_status(self):
        self.reject(
            lambda v: v[1][0]["content"][0]["arguments"].update(
                action="activate", name="context-a"
            )
        )

    def test_hardcoded_bash_result_is_not_environment_evidence(self):
        value = evidence()
        value[1][0]["content"].append(
            {
                "type": "toolCall",
                "id": "bash-1",
                "name": "bash",
                "arguments": {"command": "printf NS=default"},
            }
        )
        value[1].insert(
            -1,
            {
                "role": "toolResult",
                "toolCallId": "bash-1",
                "toolName": "bash",
                "isError": False,
                "details": {"execution": {"exitCode": 0}},
                "content": [{"type": "text", "text": "NS=default"}],
            },
        )
        value[3].update(
            tools=["xcsh_context", "bash", "xcsh_api"], shellValues=["NS=default"]
        )
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_failed_bash_result_is_not_environment_evidence(self):
        value = evidence()
        value[1][0]["content"].append(
            {
                "type": "toolCall",
                "id": "bash-1",
                "name": "bash",
                "arguments": {"command": E2E.SHELL_COMMAND},
            }
        )
        value[1].insert(
            -1,
            {
                "role": "toolResult",
                "toolCallId": "bash-1",
                "toolName": "bash",
                "isError": True,
                "details": {"execution": {"exitCode": 1}},
                "content": [{"type": "text", "text": "NS=default"}],
            },
        )
        value[3].update(
            tools=["xcsh_context", "bash", "xcsh_api"], shellValues=["NS=default"]
        )
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_wrong_context_guard_is_not_the_requested_guard(self):
        value = evidence()
        value[3]["guard"] = "context-a"
        value[1][0]["content"][1]["arguments"]["contextName"] = "other-context"
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_extra_report_fields_cannot_claim_unobserved_resources(self):
        value = evidence()
        report = json.loads(value[1][-1]["content"][0]["text"])
        report["otherResources"] = ["invented-lb"]
        value[1][-1]["content"][0]["text"] = json.dumps(report)
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_repeated_local_rejections_are_not_bounded_api_execution(self):
        value = evidence()
        value[2] = []
        value[3].update(status=None, requestCount=0, markers=[])
        value[1][2].update(isError=True, details={})
        value[1][0]["content"].append(
            {
                "type": "toolCall",
                "id": "api-2",
                "name": "xcsh_api",
                "arguments": copy.deepcopy(value[1][0]["content"][1]["arguments"]),
            }
        )
        value[1].insert(
            -1,
            {
                "role": "toolResult",
                "toolCallId": "api-2",
                "toolName": "xcsh_api",
                "isError": True,
                "details": {},
                "content": [],
            },
        )
        value[1][-1]["content"][0]["text"] = json.dumps(
            {
                "namespace": "default",
                "apiStatus": None,
                "outcome": "error",
                "resourceNames": [],
            }
        )
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_error_turn_rejects_for_incompletion_before_missing_tools(self):
        value = evidence()
        value[1] = [{"role": "assistant", "stopReason": "error", "content": []}]
        reason = None
        try:
            E2E.validate_evidence(*value)
        except E2E.AcceptanceError as error:
            reason = str(error)
        assert reason == "incomplete assistant turn"

    def test_no_match_cannot_claim_invented_content(self):
        value = evidence()
        value[1][0]["content"][1].update(
            name="grep", arguments={"pattern": "absent", "path": "search.txt"}
        )
        value[1][2].update(
            toolName="grep",
            details={"matchCount": 0, "fileCount": 0},
            content=[{"type": "text", "text": "No matches found"}],
        )
        value[2] = []
        value[3].update(
            tools=["xcsh_context", "grep"],
            requestCount=0,
            markers=[],
            grep="no-match",
            grepPattern="absent",
            grepPath="search.txt",
        )
        value[1][-1]["content"][0]["text"] = json.dumps(
            {"namespace": "default", "outcome": "match", "matchingContent": "invented"}
        )
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_invalid_regex_requires_actual_pattern_diagnostic(self):
        value = evidence()
        value[1][0]["content"][1].update(
            name="grep", arguments={"pattern": "[", "path": "search.txt"}
        )
        value[1][2].update(
            toolName="grep",
            isError=True,
            content=[{"type": "text", "text": "Permission denied"}],
        )
        value[2] = []
        value[3].update(
            tools=["xcsh_context", "grep"],
            requestCount=0,
            markers=[],
            grep="invalid",
            grepPattern="[",
            grepPath="search.txt",
        )
        value[1][-1]["content"][0]["text"] = json.dumps(
            {"namespace": "default", "outcome": "invalid", "matchingContent": ""}
        )
        with expected_rejection():
            E2E.validate_evidence(*value)

    def test_explicit_namespace_hides_resolution(self):
        self.reject(
            lambda v: v[1][0]["content"][1]["arguments"].update(
                params={"namespace": "default"}
            )
        )

    def test_discovery_expansion(self):
        self.reject(
            lambda v: v[1][0]["content"][1]["arguments"].update(expandDiscovery=True)
        )

    def test_missing_backend_request(self):
        self.reject(lambda v: v[2].clear())

    def test_false_resource_claim(self):
        self.reject(lambda v: v[1][2]["content"][0].update(text="empty response"))

    def test_missing_final_observed_names(self):
        self.reject(lambda v: v[1][-1]["content"][0].update(text="Success!"))

    def test_incomplete_assistant_turn(self):
        self.reject(lambda v: v[1][-1].update(stopReason="length"))

    def test_truncated_transcript(self):
        self.reject(lambda v: v[4].update(evidenceComplete=False))

    def test_missing_fingerprint(self):
        self.reject(lambda v: v[0].pop("sha256"))

    def test_persistence_changed(self):
        self.reject(lambda v: v[4].update(savedProfilesUnchanged=False))

    def test_no_immediate_border(self):
        self.reject(lambda v: v[4].update(selectionBorder=False))

    def test_namespace_selection_network_request(self):
        self.reject(lambda v: v[4].update(selectionNetworkFree=False))

    def test_external_rg_called(self):
        self.reject(lambda v: v[4].update(externalRgExecutions=1))

    def test_unbounded_retry(self):
        self.reject(lambda v: v[2].extend(copy.deepcopy(v[2]) * 3))

    def test_context_status_disagrees(self):
        self.reject(lambda v: v[1][1]["details"].update(activeContextNamespace="old"))

    def test_http_failure_is_distinct_from_empty_success(self):
        self.reject(lambda v: v[1][2].update(isError=True))

    def test_failure_with_fabricated_success(self):
        value = evidence()
        value[3].update(status=403, markers=[])
        value[2][0].update(status=403)
        value[1][2]["isError"] = True
        value[1][2]["details"]["status"] = 403
        value[1][-1]["content"][0]["text"] = json.dumps(
            {
                "namespace": "default",
                "apiStatus": 403,
                "outcome": "success",
                "resourceNames": ["invented-lb"],
            }
        )
        with expected_rejection():
            E2E.validate_evidence(*value)


class CredentialHandoffTests(unittest.TestCase):
    def fixture(self, directory, disabled=None, expiry=3600):
        payload = {
            "exp": time.time() + expiry,
            "https://api.openai.com/auth": {"chatgpt_account_id": "synthetic-account"},
        }
        encoded = (
            base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        )
        token = "synthetic-header." + encoded + ".synthetic-signature"
        path = pathlib.Path(directory) / "auth.db"
        with sqlite3.connect(path) as database:
            database.execute(
                "CREATE TABLE auth_credentials(provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)"
            )
            database.execute(
                "INSERT INTO auth_credentials VALUES (?,?,?,?)",
                ("openai-codex", "oauth", json.dumps({"access": token}), disabled),
            )
        return path, token

    def test_enabled_credential_handoff_keeps_store_bytes_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path, token = self.fixture(directory)
            before = path.read_bytes()
            assert E2E.load_enabled_credential(path) == token
            assert path.read_bytes() == before

    def test_disabled_credential_is_not_reenabled_or_used(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.fixture(directory, disabled="synthetic-disabled")
            before = path.read_bytes()
            with expected_rejection():
                E2E.load_enabled_credential(path)
            assert path.read_bytes() == before

    def test_expired_enabled_credential_is_not_used(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.fixture(directory, expiry=-100)
            with expected_rejection():
                E2E.load_enabled_credential(path)

    def test_final_scan_finds_late_wal_and_extensionless_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            marker = "synthetic credential marker"
            assert E2E.credential_is_absent(root, marker)
            (root / "auth.db-wal").write_bytes(
                b"x" * (1024 * 1024 - 5) + marker.encode()
            )
            assert not E2E.credential_is_absent(root, marker)
            (root / "auth.db-wal").unlink()
            (root / "exit-write").write_text(marker)
            assert not E2E.credential_is_absent(root, marker)

    def test_final_scan_checks_private_filenames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            marker = "synthetic-credential-name"
            (root / marker).write_text("unrelated content")
            assert not E2E.credential_is_absent(root, marker)


if __name__ == "__main__":
    unittest.main()
