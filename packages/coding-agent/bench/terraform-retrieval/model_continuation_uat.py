# ruff: noqa: INP001
"""Installed same-session clarification UAT; receipts always require source review."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from model_continuation import (
    configure_subscription_uat,
    final_assistant_text,
    run_rpc_turns,
    turn_messages,
)
from model_trace import (
    has_clarification_question,
    required_read_coverage,
    successful_read_paths,
    validate_model_activation,
    validate_model_subset_identity,
)


def capture_provenance(paths: dict[str, Path]) -> dict[str, str]:
    """Capture exact execution inputs before any model request."""
    return {
        name: hashlib.sha256(path.read_bytes()).hexdigest()
        for name, path in paths.items()
    }


def verify_provenance(paths: dict[str, Path], expected: dict[str, str]) -> None:
    """Reject changed inputs while preserving their original receipt digests."""
    if capture_provenance(paths) != expected:
        message = "Installed continuation inputs changed during execution"
        raise ValueError(message)


def create_evidence_directory(path: Path) -> None:
    """Never reuse a directory containing evidence from an earlier execution."""
    path.mkdir(parents=True, exist_ok=True)
    if any(path.iterdir()):
        message = "Installed UAT requires an empty evidence directory"
        raise ValueError(message)


def nonempty_strings(value: Any) -> bool:
    """Reject scalar strings and malformed arrays at the input boundary."""
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(item, str) and bool(item.strip()) for item in value)
    )


def validate_continuation_receipt(
    receipt: dict[str, Any],
    manual_review: dict[str, Any],
    receipt_hash: str,
    provenance: dict[str, str],
    model: str,
    plans: list[dict[str, Any]],
) -> set[str]:
    """Require every frozen branch, verified input bytes, and explicit source review."""
    expected = {
        (plan["id"], index)
        for plan in plans
        for index, _ in enumerate(plan["branches"])
    }
    results = receipt.get("results", [])
    if not isinstance(results, list) or any(
        not isinstance(result, dict)
        or (
            not isinstance(result.get("branch"), int)
            or isinstance(result.get("branch"), bool)
        )
        or not isinstance(result.get("id"), str)
        or not isinstance(result.get("trace_sha256"), str)
        or not re.fullmatch(r"[a-f0-9]{64}", result["trace_sha256"])
        for result in results
    ):
        message = (
            "Continuation evidence requires typed branches and exact trace digests"
        )
        raise ValueError(message)
    identities = [(result.get("id"), result.get("branch")) for result in results]
    reviews = manual_review.get("branches", [])
    if not isinstance(reviews, list) or any(
        not isinstance(result, dict)
        or (
            not isinstance(result.get("branch"), int)
            or isinstance(result.get("branch"), bool)
        )
        or not isinstance(result.get("id"), str)
        for result in reviews
    ):
        message = "Continuation review requires typed branch identities"
        raise ValueError(message)
    reviewed = [(result.get("id"), result.get("branch")) for result in reviews]
    failures = [
        receipt.get("installed") is not True,
        receipt.get("post_analysis_regression") is True,
        (
            "post_analysis_regression" in receipt
            and not isinstance(receipt["post_analysis_regression"], bool)
        ),
        receipt.get("input_sha256") != provenance,
        receipt.get("model") != model,
        len(identities) != len(set(identities)),
        set(identities) != expected,
        any(result.get("automated_evidence_passed") is not True for result in results),
        manual_review.get("receipt_sha256") != receipt_hash,
        manual_review.get("verdict") != "approve",
        manual_review.get("findings"),
        len(reviewed) != len(set(reviewed)),
        set(reviewed) != expected,
        any(
            not all(
                result.get(key) is True
                for key in [
                    "clarification_justified",
                    "terminal_destination_correct",
                    "citations_correct",
                    "hcl_supported",
                    "provider_provenance_correct",
                    "no_false_live_claims",
                ]
            )
            for result in reviews
        ),
    ]
    if any(failures):
        message = "Complete provenance-bound continuation evidence and manual source review required"
        raise ValueError(message)
    return {plan["id"] for plan in plans}


def verify_continuation_traces(receipt: dict[str, Any], directory: Path) -> None:
    """Verify every recorded branch digest against its actual transcript bytes."""
    for result in receipt["results"]:
        identity = result["id"]
        if not re.fullmatch(r"[A-Za-z0-9_-]+", identity):
            message = "Unsafe continuation trace identity"
            raise ValueError(message)
        trace = directory / f"{identity}-branch-{result['branch']}.json"
        if (
            not trace.is_file()
            or hashlib.sha256(trace.read_bytes()).hexdigest() != result["trace_sha256"]
        ):
            message = "Continuation trace bytes do not match receipt digest"
            raise ValueError(message)


def transcript_summary(
    events: list[dict[str, Any]], expected: dict[str, Any]
) -> dict[str, Any]:
    """Record complete reads and citations independently for each model turn."""
    messages = turn_messages(events)
    assistants = [message for message in messages if message.get("role") == "assistant"]
    successful = (
        bool(assistants)
        and bool(final_assistant_text(messages).strip())
        and assistants[-1].get("stopReason") == "stop"
        and all(
            message.get("stopReason") in {"stop", "toolUse"}
            and not message.get("errorMessage")
            for message in assistants
        )
    )
    text = "\n".join(
        part.get("text", "")
        for message in messages
        if message.get("role") == "assistant"
        for part in message.get("content", [])
        if part.get("type") == "text"
    )
    reads = successful_read_paths(messages)
    citations = re.findall(r"xcsh://terraform-documentation/[^\s)\]`]+", text)

    def normalize(uri: str) -> str:
        return re.sub(r"\?[^#]*", "", uri).rstrip(".,;")

    required = expected.get("must_read", [])
    cited = expected.get("required_citation_destinations", [])
    return {
        "completed": True,
        "completed_successfully": successful,
        "successful_reads": reads,
        "citations": citations,
        "required_reads_verified": successful
        and bool(required)
        and required_read_coverage(reads, required),
        "required_citations_verified": successful
        and bool(cited)
        and all(
            normalize(uri) in {normalize(value) for value in citations} for uri in cited
        ),
        "clarification_question": has_clarification_question(text),
        "response_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "hcl_fences": len(re.findall(r"```(?:hcl|terraform)\n", text)),
        "supported_fields": expected.get("supported_fields", []),
        "content_review_required": True,
    }


def validate_continuation_plans(
    cases: list[dict[str, Any]], plans: list[dict[str, Any]]
) -> None:
    """Require every ambiguous model case and every permitted terminal branch."""
    by_id = {case["id"]: case for case in cases if case["kind"] == "ambiguous"}
    if not isinstance(plans, list):
        message = "Model continuation plans must be an array"
        raise TypeError(message)
    seen: set[str] = set()
    for plan in plans:
        if not isinstance(plan, dict) or not isinstance(plan.get("id"), str):
            message = "Model continuation plan must be an identified object"
            raise TypeError(message)
        case = by_id.get(plan.get("id"))
        if case is None or plan["id"] in seen:
            message = "Unknown or duplicate model continuation case"
            raise ValueError(message)
        seen.add(plan["id"])
        terminals: list[str] = []
        branches = plan.get("branches")
        if not isinstance(branches, list) or not branches:
            message = "Model continuation branches must be a nonempty array"
            raise ValueError(message)
        for branch in branches:
            if not isinstance(branch, dict) or not isinstance(
                branch.get("terminal"), dict
            ):
                message = "Model continuation branch requires a terminal object"
                raise TypeError(message)
            prompts = branch.get("replies", [])
            expectation = branch.get("terminal", {})
            if not nonempty_strings(prompts):
                message = "Model continuation requires reviewed reply text"
                raise ValueError(message)
            if (
                not all(
                    nonempty_strings(expectation.get(key))
                    for key in [
                        "must_read",
                        "required_citation_destinations",
                        "supported_fields",
                    ]
                )
                or not isinstance(expectation.get("expected"), str)
                or not expectation["expected"].strip()
            ):
                message = "Model continuation lacks grounded terminal expectations"
                raise ValueError(message)
            terminals.append(expectation.get("expected", ""))
        if len(terminals) != len(set(terminals)) or set(terminals) != set(
            case["expected"]
        ):
            message = "Model continuation branches do not cover the frozen expected set"
            raise ValueError(message)
    if seen != set(by_id):
        message = "Missing model continuation case"
        raise ValueError(message)


def validate_continuation_review(
    freeze: dict[str, Any],
    review: dict[str, Any],
    cases: list[dict[str, Any]],
    eligibility: dict[str, Any],
    review_hash: str,
    *,
    regression: bool = False,
) -> None:
    """Bind independent approval, full case coverage, and untouched-suite eligibility."""
    expected_ids = {case["id"] for case in cases}
    reviewed_ids = review.get("reviewed_case_ids", [])
    if (
        review_hash != freeze.get("independent_review_sha256")
        or review.get("verdict") != "approve"
        or review.get("findings")
        or freeze.get("implementation_and_retrieval_outputs_withheld") is not True
        or not (
            len(reviewed_ids) == len(set(reviewed_ids))
            and set(reviewed_ids) == expected_ids
        )
    ):
        message = "Complete digest-bound independent continuation review required"
        raise ValueError(message)
    if (
        not isinstance(eligibility.get("qualification_eligible"), bool)
        or (eligibility.get("qualification_eligible") is not True and not regression)
        or eligibility.get("suite_sha256") != freeze["files"]["heldout.json"]
    ):
        message = "Continuation suite is not independently eligible"
        raise ValueError(message)


def main() -> None:
    """Execute frozen clarification branches only after all digest checks pass."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--regression", action="store_true")
    parser.add_argument("--binary", required=True)
    parser.add_argument("--freeze", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="openai-codex/gpt-6.1-sol")
    args = parser.parse_args()
    configure_subscription_uat(args.model)
    input_paths = {"binary": Path(args.binary).resolve(), "freeze": args.freeze}
    input_paths.update(
        {
            name: args.freeze.parent / name
            for name in [
                "heldout.json",
                "model-subset.json",
                "model-continuations.json",
                "independent-review.json",
                "eligibility.json",
            ]
        }
    )
    provenance = capture_provenance(input_paths)
    freeze = json.loads(args.freeze.read_text())
    independent_freeze_version = 2
    if freeze.get("schema_version") != independent_freeze_version or (
        freeze.get("post_analysis_regression") and not args.regression
    ):
        message = "Installed continuation qualification requires eligible independently reviewed freeze"
        raise ValueError(message)
    loaded: dict[str, Any] = {}
    for name in [
        "heldout.json",
        "model-subset.json",
        "model-continuations.json",
        "independent-review.json",
    ]:
        data = (args.freeze.parent / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != freeze["files"].get(name):
            message = f"Frozen continuation input hash mismatch: {name}"
            raise ValueError(message)
        loaded[name] = json.loads(data)
    review = loaded["independent-review.json"]
    eligibility = json.loads((args.freeze.parent / "eligibility.json").read_text())
    validate_continuation_review(
        freeze,
        review,
        loaded["heldout.json"],
        eligibility,
        freeze["files"]["independent-review.json"],
        regression=args.regression,
    )

    if (
        review.get("verdict") != "approve"
        or review.get("findings")
        or review.get("model_continuations_sha256")
        != freeze["files"]["model-continuations.json"]
    ):
        message = "Independent reviewer did not approve the exact continuation plan"
        raise ValueError(message)

    cases = loaded["model-subset.json"]
    validate_model_activation(cases)
    validate_model_subset_identity(cases, loaded["heldout.json"])
    plans = loaded["model-continuations.json"]
    validate_continuation_plans(cases, plans)
    by_id = {case["id"]: case for case in cases}
    create_evidence_directory(args.output)
    command = [
        str(input_paths["binary"]),
        "--mode",
        "rpc",
        "--no-session",
        "--no-memories",
        "--no-lsp",
        "--no-rules",
        "--no-title",
        "--no-extensions",
        "--no-skills",
        "--model",
        args.model,
        "--no-tools",
        "--tools",
        "read",
    ]
    run_branches(
        command,
        plans,
        by_id,
        input_paths,
        provenance,
        args.output,
        args.model,
        regression=args.regression,
    )


# Provenance, frozen plans, model identity, output and regression status are distinct evidence inputs.
# pylint: disable-next=too-many-arguments
def run_branches(
    command: list[str],
    plans: list[dict[str, Any]],
    by_id: dict[str, Any],
    input_paths: dict[str, Path],
    provenance: dict[str, str],
    output: Path,
    model: str,
    *,
    regression: bool = False,
) -> None:
    """Execute all reviewed branches and checkpoint digest-bound receipts."""
    results = []
    verify_provenance(input_paths, provenance)
    for plan in plans:
        case = by_id[plan["id"]]
        for index, branch in enumerate(plan["branches"]):
            verify_provenance(input_paths, provenance)
            run = run_rpc_turns(command, [case["prompt"], *branch["replies"]])
            verify_provenance(input_paths, provenance)
            trace = json.dumps(run, ensure_ascii=False).encode()
            name = f"{case['id']}-branch-{index}.json"
            (output / name).write_bytes(trace)
            initial = transcript_summary(run["turns"][0], {})
            terminal = transcript_summary(run["turns"][-1], branch["terminal"])
            results.append(
                {
                    "id": case["id"],
                    "branch": index,
                    "trace_sha256": hashlib.sha256(trace).hexdigest(),
                    "initial": initial,
                    "terminal": terminal,
                    "automated_evidence_passed": all(
                        transcript_summary(turn, {})["completed_successfully"]
                        for turn in run["turns"]
                    )
                    and initial["clarification_question"]
                    and terminal["required_reads_verified"]
                    and terminal["required_citations_verified"],
                    "qualification_passed": False,
                }
            )
            (output / "receipt.json").write_text(
                json.dumps(
                    {
                        "installed": True,
                        "post_analysis_regression": regression,
                        "binary_sha256": provenance["binary"],
                        "freeze_sha256": provenance["freeze"],
                        "input_sha256": provenance,
                        "model": model,
                        "qualification_passed": False,
                        "manual_review_required": True,
                        "results": results,
                    },
                    indent=2,
                )
                + "\n"
            )


if __name__ == "__main__":
    main()
