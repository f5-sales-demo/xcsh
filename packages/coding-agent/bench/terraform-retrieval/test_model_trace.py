# ruff: noqa: INP001, PT009, PT027
"""Regression tests for successful installed-model tool evidence."""

import unittest
from typing import Any

from model_trace import (
    has_clarification_question,
    successful_read_paths,
    validate_model_activation,
)


class ModelTraceTests(unittest.TestCase):
    """Reject incomplete and failed read attempts."""

    def test_failed_read_does_not_count_as_leaf_evidence(self) -> None:
        """A failed exact read is not evidence of reading its leaf."""
        messages: list[dict[str, Any]] = [
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

    def test_model_prompts_require_explicit_activation(self) -> None:
        """Ordinary controls remain outside Terraform activation."""
        with self.assertRaisesRegex(ValueError, "activation"):
            validate_model_activation(
                [{"id": "a", "kind": "answerable", "prompt": "Which port?"}]
            )
        validate_model_activation(
            [
                {"id": "a", "kind": "answerable", "prompt": "Which Terraform port?"},
                {"id": "c", "kind": "control", "prompt": "API docs"},
            ]
        )

    def test_citation_query_is_not_clarification(self) -> None:
        """URL query markers cannot count as a missing-value question."""
        self.assertFalse(
            has_clarification_question(
                "Use [docs](xcsh://terraform-documentation/test.md?view=context#section)."
            )
        )
        self.assertTrue(
            has_clarification_question("Do you use a P12 bundle or separate PEM files?")
        )
        self.assertFalse(has_clarification_question("```hcl\n# which value?\n```"))
