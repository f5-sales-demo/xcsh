# ruff: noqa: INP001, PT009, PT027
"""Regression tests for successful installed-model tool evidence."""

import unittest
from typing import Any

from model_trace import (
    cites_provider_version,
    emitted_hcl,
    has_clarification_question,
    has_false_live_apply_claim,
    hcl_code_blocks,
    missing_user_values_requested,
    missing_value_response_supported,
    required_read_coverage,
    successful_read_paths,
    terraform_tool_response_budget,
    validate_hcl_drafting_coverage,
    validate_known_suite_exposure,
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

    def test_terraform_oversized_notice_and_empty_result_are_not_complete_reads(
        self,
    ) -> None:
        """A navigation notice cannot establish reading an exact leaf section."""
        uri = "xcsh://terraform-documentation/documentation/resources/fixture/index.md?view=context#schema-name"
        call = {
            "role": "assistant",
            "content": [
                {
                    "type": "toolCall",
                    "id": "read-1",
                    "name": "read",
                    "arguments": {"path": uri},
                }
            ],
        }
        result = {
            "role": "toolResult",
            "toolCallId": "read-1",
            "toolName": "read",
            "isError": False,
            "content": [],
        }
        self.assertEqual(successful_read_paths([call, result]), [])
        result["content"] = [
            {
                "type": "text",
                "text": "Provider: v1.0.0\nOversized section: name. Complete section: full-uri",
            }
        ]
        self.assertEqual(successful_read_paths([call, result]), [])
        result["content"] = [
            {
                "type": "text",
                "text": "### name property\nComplete documented name section.",
            }
        ]
        self.assertEqual(successful_read_paths([call, result]), [uri])

    def test_exposed_model_subset_requires_regression_despite_stale_freeze(
        self,
    ) -> None:
        """Known exposed input hashes cannot certify a replacement candidate."""
        digest = "9797fa4f9b2bf52b98466a8775a8e8e2b818ec7ffe7895e7b0ad58dd62ac6cc2"
        with self.assertRaisesRegex(ValueError, "exposed"):
            validate_known_suite_exposure(digest, False)
        validate_known_suite_exposure(digest, True)
        validate_known_suite_exposure("a" * 64, False)

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
        self.assertFalse(
            has_clarification_question(
                "Pattern: `^[a-z]([-a-z0-9]*[a-z0-9])?$`. Draft complete."
            )
        )
        self.assertTrue(
            has_clarification_question("Pattern: `x?`. Which role do you intend?")
        )

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


class HclDraftingCoverageTests(unittest.TestCase):
    """Qualification must exercise positive supported drafting, not only abstention."""

    def case(self) -> dict[str, Any]:
        """Synthetic reviewed fixture with exact schema evidence and supplied values."""
        return {
            "id": "draft",
            "kind": "answerable",
            "prompt": "Draft Terraform HCL with name = acceptance-fixture.",
            "model_expectations": {
                "requires_hcl": True,
                "supported_fields": ["name"],
                "must_read": [
                    "xcsh://terraform-documentation/documentation/fixture/index.md#schema-name"
                ],
                "synthetic_values": {"name": "acceptance-fixture"},
            },
        }

    def test_empty_or_identification_only_suite_rejects(self) -> None:
        """No emitted HCL cannot establish positive field drafting acceptance."""
        for cases in [[], [{"kind": "answerable", "prompt": "Find Terraform name"}]]:
            with self.assertRaisesRegex(ValueError, "positive mandatory"):
                validate_hcl_drafting_coverage(cases)

    def test_explicit_drafting_case_with_values_and_evidence_passes(self) -> None:
        """This checks the contract; independent review still establishes field truth."""
        validate_hcl_drafting_coverage([self.case()])

    def test_missing_values_fields_reads_and_malformed_marker_reject(self) -> None:
        """An incomplete declaration cannot establish drafting coverage."""
        for key, value in [
            ("requires_hcl", "true"),
            ("supported_fields", []),
            ("must_read", []),
            ("synthetic_values", {}),
        ]:
            case = self.case()
            case["model_expectations"][key] = value
            with self.assertRaises((ValueError, TypeError)):
                validate_hcl_drafting_coverage([case])
        case = self.case()
        case["kind"] = "ambiguous"
        with self.assertRaises(ValueError):
            validate_hcl_drafting_coverage([case])

    def test_positive_drafting_requires_nonempty_hcl_fence(self) -> None:
        """Prose, empty fences and text snippets cannot establish emitted HCL."""
        self.assertTrue(emitted_hcl('```hcl\nresource "fixture" "example" {}\n```'))
        for text in ["No HCL needed", "```hcl\n\n```", "```text\nname = value\n```"]:
            self.assertFalse(emitted_hcl(text))

    def test_values_and_read_destinations_must_be_usable_and_prompt_bound(self) -> None:
        """Metadata-only values and empty destinations cannot establish drafting coverage."""
        for key, value in [
            ("synthetic_values", {"unrelated": None}),
            ("synthetic_values", {"name": "not-in-prompt"}),
            ("must_read", ["xcsh://terraform-documentation/#"]),
            (
                "must_read",
                [
                    "xcsh://terraform-documentation/documentation/../other.md#schema-name"
                ],
            ),
            (
                "must_read",
                [
                    "xcsh://terraform-documentation/documentation/%2e%2e/other.md#schema-name"
                ],
            ),
        ]:
            case = self.case()
            case["model_expectations"][key] = value
            with self.assertRaises(ValueError):
                validate_hcl_drafting_coverage([case])

    def test_fence_review_uses_the_same_parser_as_positive_emission(self) -> None:
        """Uppercase labels and trailing spaces still require schema review."""
        for text in [
            '```HCL \nname = "fixture"\n```',
            '```terraform\t\r\nname = "fixture"\n```',
        ]:
            self.assertTrue(emitted_hcl(text))
            self.assertEqual(len(hcl_code_blocks(text)), 1)

    def test_null_expectations_and_markers_reject(self) -> None:
        """An explicit null is not an absent drafting declaration."""
        case = self.case()
        case["model_expectations"] = None
        with self.assertRaises(TypeError):
            validate_hcl_drafting_coverage([case])
        case = self.case()
        case["model_expectations"]["requires_hcl"] = None
        with self.assertRaises(TypeError):
            validate_hcl_drafting_coverage([case])


class TerraformResponseBudgetTests(unittest.TestCase):
    """Measure bounded views at the complete tool-result boundary."""

    def messages(self, uri: str, text: str) -> list[dict[str, Any]]:
        """Create one completed read call and result."""
        return [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "toolCall",
                        "id": "a",
                        "name": "read",
                        "arguments": {"path": uri},
                    }
                ],
            },
            {
                "role": "toolResult",
                "toolName": "read",
                "toolCallId": "a",
                "isError": False,
                "content": [{"type": "text", "text": text}],
            },
        ]

    def test_complete_tool_envelope_discovery_and_context_budgets(self) -> None:
        """Count result metadata as part of the view budget."""
        for uri, limit in [
            ("xcsh://terraform-documentation/?search=port", 4096),
            (
                "xcsh://terraform-documentation/documentation/resources/f/index.md?view=hint#schema-x",
                4096,
            ),
            (
                "xcsh://terraform-documentation/documentation/resources/f/index.md?view=context#schema-x",
                16384,
            ),
        ]:
            self.assertTrue(
                terraform_tool_response_budget(self.messages(uri, "ok"))["passed"]
            )
            result = terraform_tool_response_budget(self.messages(uri, "x" * limit))
            self.assertFalse(result["passed"])
            self.assertEqual(result["violations"][0]["budget_bytes"], limit)

    def test_exact_reads_are_measured_without_imposing_context_budget(self) -> None:
        """Complete exact reads retain unrestricted payload size."""
        result = terraform_tool_response_budget(
            self.messages(
                "xcsh://terraform-documentation/documentation/resources/f/index.md#schema-x",
                "x" * 20000,
            )
        )
        self.assertTrue(result["passed"])
        self.assertGreater(result["total_bytes"], 20000)

    def test_utf8_and_multiple_blocks_count_in_complete_envelope(self) -> None:
        """Count UTF-8 bytes across all returned blocks."""
        messages = self.messages(
            "xcsh://terraform-documentation/?search=port", "é" * 1900
        )
        messages[1]["content"].append({"type": "text", "text": "é" * 1900})
        self.assertFalse(terraform_tool_response_budget(messages)["passed"])

    def test_unmatched_or_duplicate_terraform_tool_results_fail_audit(self) -> None:
        """Missing or repeated results cannot establish measured acceptance."""
        messages = self.messages("xcsh://terraform-documentation/?search=port", "ok")
        self.assertFalse(
            terraform_tool_response_budget([*messages, messages[1]])["passed"]
        )
        self.assertFalse(terraform_tool_response_budget(messages[:-1])["passed"])

    def test_slashless_discovery_is_measured(self) -> None:
        """The router accepts discovery hosts without a trailing slash."""
        result = terraform_tool_response_budget(
            self.messages("xcsh://terraform-documentation?search=port", "x" * 5000)
        )
        self.assertFalse(result["passed"])
        self.assertEqual(result["measured_results"], 1)

    def test_call_ids_are_strings_and_unique_across_all_tools(self) -> None:
        """Other calls cannot reuse a Terraform read identity."""
        for invalid in [7, [], {}, None, ""]:
            messages = self.messages(
                "xcsh://terraform-documentation/?search=port", "ok"
            )
            messages[0]["content"][0]["id"] = invalid
            messages[1]["toolCallId"] = invalid
            self.assertFalse(terraform_tool_response_budget(messages)["passed"])
        messages = self.messages("xcsh://terraform-documentation/?search=port", "ok")
        messages[0]["content"].append(
            {"type": "toolCall", "id": "a", "name": "bash", "arguments": {}}
        )
        self.assertFalse(terraform_tool_response_budget(messages)["passed"])
        self.assertFalse(terraform_tool_response_budget([messages[1]])["passed"])

    def test_lone_surrogate_json_is_escaped_without_crashing(self) -> None:
        """Valid escaped JSON strings must remain measurable."""
        messages = self.messages(
            "xcsh://terraform-documentation/?search=port", "\ud800"
        )
        result = terraform_tool_response_budget(messages)
        self.assertTrue(result["passed"])
        self.assertEqual(result["measured_results"], 1)


class ProviderVersionCitationTest(unittest.TestCase):
    """Require the pinned version without imposing its display prefix."""

    def test_exact_version_allows_display_prefix(self) -> None:
        """Reject other semantic versions and preview qualifiers."""
        for text in [
            "Provider v12.4.0",
            "bundled version **12.4.0**",
            "provider v12.4.0.",
            'version = "= 12.4.0"',
        ]:
            self.assertTrue(cites_provider_version(text, "v12.4.0"))
        for text in [
            "v12.4.01",
            "v112.4.0",
            "v12.4.0-beta",
            "12.4.0+preview",
            "v12.4.0.1",
        ]:
            self.assertFalse(cites_provider_version(text, "v12.4.0"))
        with self.assertRaises(ValueError):
            cites_provider_version("12.4.0", "latest")


class LiveApplyClaimTest(unittest.TestCase):
    """Separate sourced reference verification from live-apply assertions."""

    def test_documentation_verification_does_not_assert_a_later_negated_apply(
        self,
    ) -> None:
        """Separate verified documentation from denied execution in another statement."""
        self.assertFalse(
            has_false_live_apply_claim(
                "This draft was documentation-verified; terraform validate and live apply were not run."
            )
        )
        self.assertTrue(
            has_false_live_apply_claim("Verified the live apply succeeded.")
        )

    def test_sentence_local_claims_and_explicit_denials(self) -> None:
        """Retain affirmative detection and avoid cross-sentence false matches."""
        for text in [
            "Verified field reference. No live apply was performed.",
            "This is not verified by a live apply.",
            "The example is not successfully applied.",
            "Verified reference\nNo live apply was performed.",
        ]:
            self.assertFalse(has_false_live_apply_claim(text))
        for text in [
            "Successfully applied to your tenant.",
            "I confirmed the resource in your account.",
            "Verified through a live apply.",
            "No live apply was performed. Successfully applied to your tenant.",
        ]:
            self.assertTrue(has_false_live_apply_claim(text))


class MissingUserValuesTest(unittest.TestCase):
    """Prevent missing HCL values from being replaced with invented defaults."""

    def test_each_missing_identifier_is_requested_before_hcl(self) -> None:
        """A branch question alone cannot supply required user identifiers."""
        fields = ["name", "namespace"]
        self.assertTrue(
            missing_user_values_requested(
                "Which name and namespace should the lookup use?", fields
            )
        )
        self.assertFalse(
            missing_user_values_requested(
                "Which TLS representation should I use?", fields
            )
        )
        self.assertFalse(
            missing_user_values_requested("Which name should I use?", fields)
        )
        self.assertFalse(
            missing_user_values_requested(
                'Which name and namespace?\n```hcl\ndata "xcsh_fixture" "x" { name = "invented" }\n```',
                fields,
            )
        )
        self.assertFalse(
            missing_user_values_requested(
                "The name and namespace identify the lookup.", fields
            )
        )
        self.assertTrue(
            missing_user_values_requested("Documented field description", [])
        )
