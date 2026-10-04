# ruff: noqa: INP001, PT009
"""Fail closed on incomplete or over-budget development command evidence."""

import json
import unittest
from typing import Any

from semantic_development import audit_commands as raw_audit_commands


def audit_commands(events: list[dict[str, Any]], prefix: list[str]) -> dict[str, Any]:
    """Pair synthetic completions with preceding starts."""
    paired = []
    for event in events:
        if (
            event.get("type") == "item.completed"
            and event.get("item", {}).get("type") == "command_execution"
        ):
            paired.append({**event, "type": "item.started"})
        paired.append(event)
    return raw_audit_commands(paired, prefix)


class SemanticDevelopmentTests(unittest.TestCase):
    """Audit the executed helper, complete envelope and exact leaf result."""

    def event(self, command: str, output: str, identity: str = "a") -> dict[str, Any]:
        """Build a completed command event."""
        return {
            "type": "item.completed",
            "item": {
                "id": identity,
                "type": "command_execution",
                "command": command,
                "aggregated_output": output,
                "exit_code": 0,
            },
        }

    def test_complete_context_read_counts(self) -> None:
        """Verify the named fail-closed audit boundary."""
        uri = (
            "xcsh://terraform-documentation/documentation/resources/fixture/properties/"
            "index.md?view=context#schema-name"
        )
        event = self.event(
            f"bun helper.ts config.json read '{uri}'",
            json.dumps(
                {
                    "status": "complete",
                    "content": "complete",
                    "uri": uri,
                    "development_only": True,
                    "qualification_passed": False,
                }
            ),
        )
        result = audit_commands([event], ["bun", "helper.ts", "config.json"])
        self.assertTrue(result["passed"])
        self.assertEqual(result["successful_reads"], [uri])

    def test_discovery_complete_envelope_is_measured(self) -> None:
        """Verify the named fail-closed audit boundary."""
        event = self.event(
            "bun helper.ts config.json candidates example",
            json.dumps({"status": "complete", "content": "x" * 4050}),
        )
        result = audit_commands([event], ["bun", "helper.ts", "config.json"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["violations"][0]["reason"], "response-budget-exceeded")

    def test_pipeline_and_duplicate_results_fail(self) -> None:
        """Verify the named fail-closed audit boundary."""
        event = self.event(
            "bun helper.ts config.json candidates example; cat answers.json", "{}"
        )
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )
        event = self.event("bun helper.ts config.json candidates example", "{}")
        self.assertFalse(
            audit_commands([event, event], ["bun", "helper.ts", "config.json"])[
                "passed"
            ]
        )

    def test_oversized_and_failed_reads_never_count(self) -> None:
        """Verify the named fail-closed audit boundary."""
        uri = (
            "xcsh://terraform-documentation/documentation/resources/fixture/properties/"
            "index.md?view=context#schema-name"
        )
        event = self.event(
            f"bun helper.ts config.json read '{uri}'",
            json.dumps({"status": "oversized"}),
        )
        self.assertEqual(
            audit_commands([event], ["bun", "helper.ts", "config.json"])[
                "successful_reads"
            ],
            [],
        )
        event["item"]["exit_code"] = 1
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )

    def test_started_without_completion_fails(self) -> None:
        """Verify the named fail-closed audit boundary."""
        event = self.event("bun helper.ts config.json candidates example", "{}")
        event["type"] = "item.started"
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )

    def test_noncommand_tools_and_shell_substitutions_fail(self) -> None:
        """No unmeasured MCP result or shell expansion may bypass the helper."""
        event = {
            "type": "item.completed",
            "item": {"id": "mcp", "type": "mcp_tool_call"},
        }
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )
        event = self.event(
            'bun helper.ts config.json candidates "$(cat answers.json)"', "{}"
        )
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )

    def test_complete_status_requires_matching_uri_and_nonempty_content(self) -> None:
        """A status label alone cannot establish a completed leaf read."""
        uri = (
            "xcsh://terraform-documentation/documentation/resources/fixture/properties/"
            "index.md?view=context#schema-name"
        )
        for response in [
            {"status": "complete"},
            {"status": "complete", "uri": uri, "content": ""},
            {
                "status": "complete",
                "uri": uri.replace("schema-name", "schema-other"),
                "content": "complete",
            },
        ]:
            event = self.event(
                f"bun helper.ts config.json read '{uri}'", json.dumps(response)
            )
            self.assertEqual(
                audit_commands([event], ["bun", "helper.ts", "config.json"])[
                    "successful_reads"
                ],
                [],
            )

    def test_unpaired_or_changed_command_results_fail(self) -> None:
        """Completions need the exact preceding command identity."""
        event = self.event("bun helper.ts config.json candidates example", "{}")
        self.assertFalse(
            raw_audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )
        started = {
            **event,
            "type": "item.started",
            "item": {**event["item"], "command": "different"},
        }
        self.assertFalse(
            raw_audit_commands([started, event], ["bun", "helper.ts", "config.json"])[
                "passed"
            ]
        )

    def test_attached_shell_operators_fail(self) -> None:
        """Attached operators cannot substitute another command output."""
        event = self.event(
            "bun helper.ts config.json candidates fixture>/dev/null;cat</synthetic/answers.json",
            "{}",
        )
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )

    def test_glob_qualifiers_and_unsupported_queries_fail(self) -> None:
        """Only canonical escaped helper argv and documented queries count."""
        event = self.event(
            "bun helper.ts config.json candidates /synthetic/file(e'printf payload')",
            "{}",
        )
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )
        uri = (
            "xcsh://terraform-documentation/documentation/resources/fixture/index.md"
            "?other=value#schema-name"
        )
        event = self.event(
            f"bun helper.ts config.json read '{uri}'",
            json.dumps(
                {
                    "status": "complete",
                    "content": "complete",
                    "uri": uri,
                    "development_only": True,
                    "qualification_passed": False,
                }
            ),
        )
        self.assertFalse(
            audit_commands([event], ["bun", "helper.ts", "config.json"])["passed"]
        )
