# ruff: noqa: INP001, PT009
"""Regression tests for successful installed-model tool evidence."""

import unittest

from model_trace import successful_read_paths


class ModelTraceTests(unittest.TestCase):
    """Reject incomplete and failed read attempts."""

    def test_failed_read_does_not_count_as_leaf_evidence(self) -> None:
        """A failed exact read is not evidence of reading its leaf."""
        messages = [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "toolCall",
                        "name": "read",
                        "id": "a",
                        "arguments": {"path": "leaf"},
                    }
                ],
            },
            {
                "role": "toolResult",
                "toolName": "read",
                "toolCallId": "a",
                "isError": True,
            },
        ]
        self.assertEqual(successful_read_paths(messages), [])
        messages[1]["isError"] = False
        self.assertEqual(successful_read_paths(messages), ["leaf"])

    def test_missing_result_does_not_count(self) -> None:
        """An attempted read needs a completed result."""
        self.assertEqual(
            successful_read_paths(
                [
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "toolCall",
                                "name": "read",
                                "id": "a",
                                "arguments": {"path": "leaf"},
                            }
                        ],
                    }
                ]
            ),
            [],
        )
