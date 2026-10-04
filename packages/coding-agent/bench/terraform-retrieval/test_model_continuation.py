# ruff: noqa: INP001, PT009, PT027
"""Real subprocess protocol checks for model clarification continuation."""

import copy
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any

from model_continuation import run_json_process, run_rpc_turns, turn_messages
from model_continuation_uat import (
    capture_provenance,
    create_evidence_directory,
    transcript_summary,
    validate_continuation_plans,
    validate_continuation_receipt,
    verify_provenance,
)
from model_trace import successful_read_paths


class ModelContinuationTests(unittest.TestCase):
    """Never send a reply before its predecessor reaches agent_end."""

    def test_stale_completion_without_current_acknowledgement_rejects(self) -> None:
        """Duplicate prior events never complete the next prompt."""
        child = "import sys,json,time; c=json.loads(sys.stdin.readline()); print(json.dumps({'type':'response','id':c['id'],'success':True}),flush=True); print(json.dumps({'type':'agent_end','messages':[]}),flush=True); print(json.dumps({'type':'agent_end','messages':[]}),flush=True); time.sleep(5)"
        with self.assertRaisesRegex(ValueError, "acknowledgement"):
            run_rpc_turns([sys.executable, "-u", "-c", child], ["first", "second"], 1)

    def test_single_turn_timeout_contains_resistant_descendants(self) -> None:
        """JSON and RPC routes use the same process-group boundary."""
        child = "import os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); os.fork(); time.sleep(10)"
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            run_json_process([sys.executable, "-u", "-c", child], 0.1)
        self.assertLess(time.monotonic() - started, 2)

    def test_single_turn_json_returns_complete_output(self) -> None:
        """The contained process preserves its result and stderr."""
        result = run_json_process(
            [
                sys.executable,
                "-u",
                "-c",
                "import sys;print(123);print(456,file=sys.stderr)",
            ],
            1,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "123\n")
        self.assertEqual(result.stderr, "456\n")

    def test_missing_or_duplicate_read_ids_never_match(self) -> None:
        """Both ends must identify exactly one call/result pair."""
        call = {"type": "toolCall", "name": "read", "arguments": {"path": "leaf"}}
        result = {"role": "toolResult", "toolName": "read", "isError": False}
        messages: list[dict[str, Any]] = [
            {"role": "assistant", "content": [call]},
            result,
        ]
        self.assertEqual(successful_read_paths(messages), [])
        call["id"] = "one"
        result["toolCallId"] = "one"
        self.assertEqual(successful_read_paths(messages), ["leaf"])
        self.assertEqual(successful_read_paths([*messages, result]), [])
        messages[0]["content"] = [call, call]
        self.assertEqual(successful_read_paths(messages), [])

    def test_replies_share_process_and_preserve_exact_json_text(self) -> None:
        """The second prompt reaches the same child after first completion."""
        child = (
            "import sys,json; count=0\n"
            "for line in sys.stdin:\n"
            " c=json.loads(line); count+=1\n"
            " print(json.dumps({'type':'response','id':c['id'],'success':True}),flush=True)\n"
            " print(json.dumps({'type':'agent_end','messages':[{'role':'assistant','text':c['message'],'count':count,'content':[]}]}),flush=True)\n"
        )
        prompts = [
            'Terraform query "quoted"\nnext line',
            "Choose the data-source branch.",
        ]
        result = run_rpc_turns([sys.executable, "-u", "-c", child], prompts, 5)
        self.assertEqual(
            [turn_messages(t)[0]["text"] for t in result["turns"]], prompts
        )
        self.assertEqual(
            [turn_messages(t)[0]["count"] for t in result["turns"]], [1, 2]
        )

    def test_rejected_or_incomplete_turn_cannot_pass(self) -> None:
        """Acknowledgement and EOF never stand in for model completion."""
        child = "import sys,json; c=json.loads(sys.stdin.readline()); print(json.dumps({'type':'response','id':c['id'],'success':False}),flush=True)"
        with self.assertRaisesRegex(ValueError, "prompt rejected"):
            run_rpc_turns([sys.executable, "-u", "-c", child], ["Terraform query"], 5)
        with self.assertRaisesRegex(ValueError, "ended before"):
            run_rpc_turns(
                [sys.executable, "-u", "-c", "print('{}',flush=True)"],
                ["Terraform query"],
                5,
            )

    def test_deadline_and_invalid_event_fail(self) -> None:
        """A silent process times out and invalid output rejects."""
        with self.assertRaises(subprocess.TimeoutExpired):
            run_rpc_turns(
                [sys.executable, "-u", "-c", "import time;time.sleep(5)"],
                ["Terraform query"],
                0.05,
            )
        with self.assertRaises(json.JSONDecodeError):
            run_rpc_turns(
                [sys.executable, "-u", "-c", "print('invalid',flush=True)"],
                ["Terraform query"],
                5,
            )

    def test_completed_message_shape_is_required(self) -> None:
        """Missing completion messages cannot count as read evidence."""
        with self.assertRaisesRegex(ValueError, "completed model turn"):
            turn_messages([{"type": "response", "success": True}])

    def test_nonreading_child_cannot_block_large_prompt(self) -> None:
        """The turn deadline covers writing more than pipe capacity."""
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            run_rpc_turns(
                [sys.executable, "-u", "-c", "import time;time.sleep(10)"],
                ["x" * 2_000_000],
                0.1,
            )
        self.assertLess(time.monotonic() - started, 2)

    def test_timeout_kills_resistant_process_group(self) -> None:
        """Inherited stdout pipes cannot keep cleanup blocked after timeout."""
        child = "import os,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); os.fork(); time.sleep(10)"
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            run_rpc_turns([sys.executable, "-u", "-c", child], ["query"], 0.1)
        self.assertLess(time.monotonic() - started, 2)

    def test_malformed_completed_messages_reject(self) -> None:
        """Malformed nested messages cannot escape as positive evidence."""
        for messages in [
            [None],
            [{"role": "assistant"}],
            [{"content": "text"}],
            [{"content": [7]}],
        ]:
            with self.subTest(messages=messages), self.assertRaises(TypeError):
                turn_messages([{"type": "agent_end", "messages": messages}])


class ContinuationPlanTests(unittest.TestCase):
    """A frozen plan covers every permitted exact destination."""

    def test_question_only_or_partial_continuation_receipt_rejects(self) -> None:
        """Only every branch with independent manual content evidence qualifies."""
        plans = [{"id": "one", "branches": [{}, {}]}]
        provenance = {"binary": "binary-hash", "freeze": "freeze-hash"}
        receipt: dict[str, Any] = {
            "installed": True,
            "input_sha256": provenance,
            "model": "model",
            "results": [
                {
                    "id": "one",
                    "branch": i,
                    "automated_evidence_passed": True,
                    "trace_sha256": "a" * 64,
                }
                for i in range(2)
            ],
        }
        review: dict[str, Any] = {
            "receipt_sha256": "receipt-hash",
            "verdict": "approve",
            "findings": [],
            "branches": [
                {
                    "id": "one",
                    "branch": i,
                    **dict.fromkeys(
                        [
                            "clarification_justified",
                            "terminal_destination_correct",
                            "citations_correct",
                            "hcl_supported",
                            "provider_provenance_correct",
                            "no_false_live_claims",
                        ],
                        True,
                    ),
                }
                for i in range(2)
            ],
        }
        self.assertEqual(
            validate_continuation_receipt(
                receipt, review, "receipt-hash", provenance, "model", plans
            ),
            {"one"},
        )
        for branch in [False, 0.0, "0"]:
            invalid = copy.deepcopy(receipt)
            invalid["results"][0]["branch"] = branch
            with self.assertRaises(ValueError):
                validate_continuation_receipt(
                    invalid, review, "receipt-hash", provenance, "model", plans
                )
        for target, key, value in [
            ("receipt", "results", receipt["results"][:1]),
            ("receipt", "input_sha256", {}),
            ("review", "receipt_sha256", "changed"),
            ("review", "branches", []),
            ("review", "findings", ["unsupported field"]),
        ]:
            changed_receipt, changed_review = (
                copy.deepcopy(receipt),
                copy.deepcopy(review),
            )
            (changed_receipt if target == "receipt" else changed_review)[key] = value
            with self.subTest(target=target, key=key), self.assertRaises(ValueError):
                validate_continuation_receipt(
                    changed_receipt,
                    changed_review,
                    "receipt-hash",
                    provenance,
                    "model",
                    plans,
                )

    def test_malformed_arrays_reject_before_model_execution(self) -> None:
        """Strings and mixed arrays never masquerade as reviewed plans."""
        cases = [{"id": "one", "kind": "ambiguous", "expected": ["a"]}]
        plan: dict[str, Any] = {
            "id": "one",
            "branches": [
                {
                    "replies": ["Use a"],
                    "terminal": {
                        "expected": "a",
                        "must_read": ["a"],
                        "required_citation_destinations": ["a"],
                        "supported_fields": ["name"],
                    },
                }
            ],
        }
        for key in [
            "replies",
            "must_read",
            "required_citation_destinations",
            "supported_fields",
        ]:
            values: list[Any] = ["Use a", ["a", 7], [""], None, {}]
            for value in values:
                malformed = copy.deepcopy(plan)
                target = malformed["branches"][0]
                if key != "replies":
                    target = target["terminal"]
                target[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    validate_continuation_plans(cases, [malformed])

    def test_failed_assistant_never_has_positive_read_evidence(self) -> None:
        """Even a completed event and citation cannot mask a failed turn."""
        for reason in ["error", "aborted", "toolUse", None]:
            result = transcript_summary(
                [
                    {
                        "type": "agent_end",
                        "messages": [
                            {
                                "role": "assistant",
                                "stopReason": reason,
                                "content": [
                                    {"type": "text", "text": "Which resource?"}
                                ],
                            }
                        ],
                    }
                ],
                {},
            )
            self.assertFalse(result["completed_successfully"])
        result = transcript_summary(
            [
                {
                    "type": "agent_end",
                    "messages": [
                        {
                            "role": "assistant",
                            "stopReason": "stop",
                            "errorMessage": "failed",
                            "content": [],
                        }
                    ],
                }
            ],
            {},
        )
        self.assertFalse(result["completed_successfully"])
        result = transcript_summary(
            [
                {
                    "type": "agent_end",
                    "messages": [
                        {"role": "assistant", "content": []},
                        {"role": "assistant", "stopReason": "stop", "content": []},
                    ],
                }
            ],
            {},
        )
        self.assertFalse(result["completed_successfully"])

    def test_existing_evidence_directory_rejects(self) -> None:
        """A new failed attempt cannot be confused with an old complete receipt."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            create_evidence_directory(path)
            (path / "receipt.json").write_text("old")
            with self.assertRaisesRegex(ValueError, "empty evidence"):
                create_evidence_directory(path)

    def test_receipt_preserves_original_input_hashes_on_replacement(self) -> None:
        """Replacement input is detected without rewriting captured provenance."""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "binary"
            path.write_bytes(b"original")
            provenance = capture_provenance({"binary": path})
            verify_provenance({"binary": path}, provenance)
            original = provenance.copy()
            path.write_bytes(b"replacement")
            with self.assertRaisesRegex(ValueError, "changed during"):
                verify_provenance({"binary": path}, provenance)
            self.assertEqual(provenance, original)

    def test_missing_or_ungrounded_terminal_plan_rejects(self) -> None:
        """A question alone does not qualify terminal drafting."""
        cases = [{"id": "one", "kind": "ambiguous", "expected": ["a", "b"]}]
        with self.assertRaisesRegex(ValueError, "Missing model continuation"):
            validate_continuation_plans(cases, [])
        branch = {
            "replies": ["Use a"],
            "terminal": {
                "expected": "a",
                "must_read": ["a"],
                "required_citation_destinations": ["a"],
                "supported_fields": ["name"],
            },
        }
        with self.assertRaisesRegex(ValueError, "cover the frozen"):
            validate_continuation_plans(cases, [{"id": "one", "branches": [branch]}])
        branch_b = {
            "replies": ["Use b"],
            "terminal": {
                "expected": "b",
                "must_read": ["b"],
                "required_citation_destinations": ["b"],
                "supported_fields": ["name"],
            },
        }
        validate_continuation_plans(
            cases, [{"id": "one", "branches": [branch, branch_b]}]
        )
        with self.assertRaisesRegex(ValueError, "grounded terminal"):
            validate_continuation_plans(
                cases,
                [
                    {
                        "id": "one",
                        "branches": [
                            {"replies": ["Use a"], "terminal": {"expected": "a"}}
                        ],
                    }
                ],
            )

    def test_terminal_evidence_requires_completed_exact_read_and_citation(self) -> None:
        """Failed or hint-only reads do not count for complete evidence."""
        uri = "xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name"
        messages: list[dict[str, Any]] = [
            {
                "role": "assistant",
                "stopReason": "stop",
                "content": [
                    {
                        "type": "toolCall",
                        "name": "read",
                        "id": "read-1",
                        "arguments": {"path": uri},
                    },
                    {"type": "text", "text": "See " + uri},
                ],
            },
            {
                "role": "toolResult",
                "toolName": "read",
                "toolCallId": "read-1",
                "isError": False,
            },
        ]
        expected = {
            "must_read": [uri],
            "required_citation_destinations": [uri],
            "supported_fields": ["name"],
        }
        result = transcript_summary(
            [{"type": "agent_end", "messages": messages}], expected
        )
        self.assertTrue(result["required_reads_verified"])
        self.assertTrue(result["required_citations_verified"])
        messages[1]["isError"] = True
        result = transcript_summary(
            [{"type": "agent_end", "messages": messages}], expected
        )
        self.assertFalse(result["required_reads_verified"])
