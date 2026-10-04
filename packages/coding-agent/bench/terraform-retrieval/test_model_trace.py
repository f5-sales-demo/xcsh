# ruff: noqa: INP001, PT009, PT027
"""Regression tests for successful installed-model tool evidence."""

import unittest
from typing import Any

from model_trace import (
    has_clarification_question,
    missing_value_response_supported,
    required_read_coverage,
    successful_read_paths,
    validate_model_activation,
    validate_model_subset_identity,
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

    def test_missing_configuration_control_needs_the_actual_missing_field(self) -> None:
        """An unrelated disclaimer cannot prove missing-value handling."""
        self.assertTrue(
            missing_value_response_supported(
                "private_key is required. Supply its secret reference before drafting.",
                "Missing private_key configuration block",
            )
        )
        self.assertFalse(
            missing_value_response_supported(
                "No live apply evidence is available.",
                "Missing private_key configuration block",
            )
        )
        self.assertFalse(
            missing_value_response_supported(
                "Which region should I use?", "Missing private_key configuration block"
            )
        )

    def test_every_expected_read_requires_a_successful_exact_destination(self) -> None:
        """Every listed section requires successful anchored evidence."""
        required = [
            "xcsh://terraform-documentation/a.md#one",
            "xcsh://terraform-documentation/a.md#two",
        ]
        self.assertFalse(required_read_coverage([required[0]], required))
        self.assertTrue(
            required_read_coverage(
                ["xcsh://terraform-documentation/a.md?view=context#one", required[1]],
                required,
            )
        )
        self.assertFalse(
            required_read_coverage(["xcsh://terraform-documentation/a.md"], required)
        )

    def test_hint_does_not_count_as_complete_property_read(self) -> None:
        """Hints identify a leaf but do not contain its complete section."""
        self.assertFalse(
            required_read_coverage(
                ["xcsh://terraform-documentation/a.md?view=hint#one"],
                ["xcsh://terraform-documentation/a.md#one"],
            )
        )


class ModelSubsetIdentityTests(unittest.TestCase):
    """Keep model prompts and expected reads identical to frozen cases."""

    def test_unchanged_subset_passes(self) -> None:
        """Object key order does not change a case."""
        case: dict[str, object] = {
            "id": "one",
            "prompt": "Terraform name",
            "expected": ["leaf"],
        }
        validate_model_subset_identity([dict(case)], [case])

    def test_edited_prompt_or_expected_destination_rejects(self) -> None:
        """Selecting a case does not authorize editing its labels."""
        case: dict[str, object] = {
            "id": "one",
            "prompt": "Terraform name",
            "expected": ["leaf"],
        }
        for edited in [
            dict(case, prompt="Terraform other"),
            dict(case, expected=["other"]),
        ]:
            with self.assertRaisesRegex(ValueError, "changed frozen case"):
                validate_model_subset_identity([edited], [case])

    def test_read_expectations_cannot_change(self) -> None:
        """A model case includes the same required reads as its frozen source."""
        case: dict[str, object] = {
            "id": "one",
            "model_expectations": {"must_read": ["leaf"]},
        }
        with self.assertRaisesRegex(ValueError, "changed frozen case"):
            validate_model_subset_identity(
                [{"id": "one", "model_expectations": {"must_read": []}}], [case]
            )

    def test_reordered_keys_preserve_case_identity(self) -> None:
        """Key ordering is serialization detail, not a case change."""
        validate_model_subset_identity(
            [{"expected": ["leaf"], "prompt": "Terraform name", "id": "one"}],
            [{"id": "one", "prompt": "Terraform name", "expected": ["leaf"]}],
        )
