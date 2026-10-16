import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "acceptance",
    Path(__file__).resolve().parents[1] / "scripts/container/acceptance.py",
)
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class AcceptanceTests(unittest.TestCase):
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

    def test_malformed_tool_events_and_unmatched_calls_are_rejected(self):
        events = [{"type": "tool_execution_start"}]
        assert not acceptance.evaluate(events, "litellm/gpt-6.1-sol:medium", "MARKER")[
            "passed"
        ]
        assert not acceptance.evaluate([None], "litellm/gpt-6.1-sol:medium", "MARKER")[
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
