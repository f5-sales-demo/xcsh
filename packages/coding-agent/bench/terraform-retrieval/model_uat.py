# ruff: noqa: INP001, T201
"""Installed synthetic model UAT: raw traces stay outside the repository."""

import argparse
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path

from model_continuation import (
    configure_subscription_uat,
    final_assistant_text,
    run_json_process,
    turn_messages,
)
from model_continuation_uat import (
    capture_provenance,
    create_evidence_directory,
    validate_continuation_plans,
    validate_continuation_receipt,
    validate_continuation_review,
    verify_continuation_traces,
    verify_provenance,
)
from model_trace import (
    emitted_hcl,
    has_clarification_question,
    hcl_code_blocks,
    missing_value_response_supported,
    required_read_coverage,
    successful_read_paths,
    terraform_tool_response_budget,
    validate_hcl_drafting_coverage,
    validate_known_suite_exposure,
    validate_model_activation,
    validate_model_subset_identity,
)

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--suite", type=Path, required=True)
parser.add_argument("--freeze", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--provider-version", required=True)
parser.add_argument("--regression", action="store_true")
parser.add_argument("--continuation-receipt", type=Path)
parser.add_argument("--continuation-review", type=Path)
parser.add_argument("--model", default="openai-codex/gpt-6.1-sol")
parser.add_argument("--partition-index", type=int, default=0)
parser.add_argument("--partition-count", type=int, default=1)
args = parser.parse_args()
execution_route = configure_subscription_uat(args.model)
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
        if (args.freeze.parent / name).exists()
    }
)
provenance = capture_provenance(input_paths)
freeze = json.loads(args.freeze.read_text())
suite_bytes = args.suite.read_bytes()
validate_known_suite_exposure(hashlib.sha256(suite_bytes).hexdigest(), args.regression)
if hashlib.sha256(suite_bytes).hexdigest() != freeze["files"]["model-subset.json"]:
    HASH_MISMATCH = "Frozen model subset hash mismatch"
    raise ValueError(HASH_MISMATCH)
if freeze.get("post_analysis_regression") and not args.regression:
    REGRESSION_ERROR = "Exposed or derived model suite requires --regression"
    raise ValueError(REGRESSION_ERROR)
all_cases = json.loads(suite_bytes)
INDEPENDENT_FREEZE_VERSION = 2
if freeze.get("schema_version") == INDEPENDENT_FREEZE_VERSION:
    validate_model_activation(all_cases)
if not args.regression:
    validate_hcl_drafting_coverage(all_cases)
    heldout_bytes = (args.freeze.parent / "heldout.json").read_bytes()
    if hashlib.sha256(heldout_bytes).hexdigest() != freeze["files"]["heldout.json"]:
        message = "Frozen heldout suite hash mismatch"
        raise ValueError(message)
    validate_model_subset_identity(all_cases, json.loads(heldout_bytes))
    if freeze.get("schema_version") != INDEPENDENT_FREEZE_VERSION:
        message = "Nonregression model UAT requires independently reviewed freeze"
        raise ValueError(message)
    for name in ["heldout.json", "model-subset.json", "independent-review.json"]:
        if provenance.get(name) != freeze["files"].get(name):
            message = f"Frozen input hash mismatch: {name}"
            raise ValueError(message)
    independent_review = json.loads(
        (args.freeze.parent / "independent-review.json").read_bytes()
    )
    eligibility_record = json.loads(
        (args.freeze.parent / "eligibility.json").read_bytes()
    )
    validate_continuation_review(
        freeze,
        independent_review,
        json.loads(heldout_bytes),
        eligibility_record,
        provenance["independent-review.json"],
    )
continuation_verified: set[str] = set()
if not args.regression and any(case["kind"] == "ambiguous" for case in all_cases):
    if args.continuation_receipt is None or args.continuation_review is None:
        message = (
            "Ambiguous qualification requires reviewed installed continuation evidence"
        )
        raise ValueError(message)
    plans_bytes = (args.freeze.parent / "model-continuations.json").read_bytes()
    if hashlib.sha256(plans_bytes).hexdigest() != freeze["files"].get(
        "model-continuations.json"
    ):
        message = "Frozen continuation plan hash mismatch"
        raise ValueError(message)
    for name, digest in freeze["files"].items():
        if name in provenance and provenance[name] != digest:
            message = f"Frozen input hash mismatch: {name}"
            raise ValueError(message)
    review = json.loads((args.freeze.parent / "independent-review.json").read_bytes())
    eligibility = json.loads((args.freeze.parent / "eligibility.json").read_bytes())
    validate_continuation_review(
        freeze,
        review,
        json.loads(heldout_bytes),
        eligibility,
        provenance["independent-review.json"],
    )
    if (
        freeze.get("schema_version") != INDEPENDENT_FREEZE_VERSION
        or review.get("model_continuations_sha256")
        != hashlib.sha256(plans_bytes).hexdigest()
    ):
        message = "Eligible independently approved continuation freeze required"
        raise ValueError(message)
    plans = json.loads(plans_bytes)
    validate_continuation_plans(all_cases, plans)
    receipt_bytes = args.continuation_receipt.read_bytes()
    continuation_verified = validate_continuation_receipt(
        json.loads(receipt_bytes),
        json.loads(args.continuation_review.read_bytes()),
        hashlib.sha256(receipt_bytes).hexdigest(),
        provenance,
        args.model,
        plans,
    )
    verify_continuation_traces(
        json.loads(receipt_bytes), args.continuation_receipt.parent
    )
cases = all_cases[args.partition_index :: args.partition_count]
create_evidence_directory(args.output)
results = []
for case in cases:
    verify_provenance(input_paths, provenance)
    start = time.perf_counter()
    command = [
        str(input_paths["binary"]),
        "--mode",
        "json",
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
        case["prompt"],
    ]
    try:
        result = run_json_process(command)
        verify_provenance(input_paths, provenance)
        (args.output / (case["id"] + ".ndjson")).write_text(result.stdout)
        (args.output / (case["id"] + ".stderr.txt")).write_text(result.stderr)
        events = [
            json.loads(line) for line in result.stdout.splitlines() if line.strip()
        ]
        if not all(isinstance(event, dict) for event in events):
            message = "Unexpected non-object event in CLI JSON stream"
            raise ValueError(message)  # noqa: TRY301 - invalid event boundary is recorded as an explicit failed case
        messages = turn_messages(events)
        assistant = [m for m in messages if m.get("role") == "assistant"]
        text = "\n".join(
            c.get("text", "")
            for m in assistant
            for c in m.get("content", [])
            if c.get("type") == "text"
        )
        reads = [
            c.get("arguments", {}).get("path", "")
            for m in assistant
            for c in m.get("content", [])
            if c.get("type") == "toolCall" and c.get("name") == "read"
        ]
        citations = re.findall(r"xcsh://terraform-documentation/[^\s)\]`]+", text)

        def normalized(uri: str) -> str:
            """Remove view parameters while retaining exact property anchors."""
            return re.sub(r"\?[^#]*", "", uri).rstrip(".,;")

        response_budget = terraform_tool_response_budget(messages)
        successful_reads = successful_read_paths(messages)
        expected = case["expected"]
        required_reads = case.get("model_expectations", {}).get("must_read", [])
        required_reads_verified = required_read_coverage(
            successful_reads, required_reads
        )
        exact_read = any(
            any(
                (
                    normalized(read) == normalized(want)
                    and required_read_coverage([read], [want])
                )
                or (
                    case.get("match_document")
                    and required_read_coverage([read], [read])
                    and normalized(read).split("#")[0] == normalized(want).split("#")[0]
                )
                for want in expected
            )
            for read in successful_reads
        )
        cited = any(
            any(
                normalized(citation) == normalized(want)
                or (
                    case.get("match_document")
                    and normalized(citation).split("#")[0]
                    == normalized(want).split("#")[0]
                )
                for want in expected
            )
            for citation in citations
        )
        terraform_reads = [
            r for r in reads if r.startswith("xcsh://terraform-documentation/")
        ]
        clarification = has_clarification_question(text)
        claim_text = re.sub(
            r"not verified by (?:a )?live apply|not (?:live[- ]?)?apply evidence|not successfully applied",
            "",
            text,
            flags=re.IGNORECASE,
        )
        false_live = bool(
            re.search(
                r"(?<!not )successfully applied|confirmed.*(?:your tenant|your account)|verified.*live apply",
                claim_text,
                re.IGNORECASE,
            )
        )
        code_fences = hcl_code_blocks(text)
        if case["kind"] == "answerable":
            passed = (
                result.returncode == 0
                and exact_read
                and required_reads_verified
                and cited
                and args.provider_version in text
                and not false_live
            )
        elif case["kind"] == "ambiguous":
            passed = (
                result.returncode == 0
                and clarification
                and not false_live
                and (args.regression or case["id"] in continuation_verified)
            )
        elif case.get("behavior") == "ordinary-discovery":
            passed = result.returncode == 0 and not terraform_reads and not false_live
        elif case.get("behavior") == "unsupported":
            passed = (
                result.returncode == 0
                and bool(
                    re.search(
                        r"not (?:a )?(?:supported|documented)|unsupported|no (?:such|documented)|does not|cannot",
                        text,
                        re.IGNORECASE,
                    )
                )
                and not code_fences
                and not false_live
            )
        elif case.get("behavior") in ("missing-value", "missing_value"):
            passed = (
                result.returncode == 0
                and required_reads_verified
                and missing_value_response_supported(
                    text,
                    case.get("model_expectations", {}).get("value_clarification") or "",
                )
                and not false_live
            )
        else:
            passed = (
                result.returncode == 0
                and bool(
                    re.search(
                        r"cannot|not.*(?:live|apply|evidence)|no.*(?:live|apply)",
                        text,
                        re.IGNORECASE,
                    )
                )
                and not false_live
            )
        hcl_required = case.get("model_expectations", {}).get("requires_hcl") is True
        final_hcl_emitted = emitted_hcl(final_assistant_text(messages))
        passed = passed and (not hcl_required or final_hcl_emitted)
        completed_successfully = (
            bool(assistant)
            and assistant[-1].get("stopReason") == "stop"
            and all(
                message.get("stopReason") in {"stop", "toolUse"}
                and not message.get("errorMessage")
                for message in assistant
            )
        )
        final_text = final_assistant_text(messages)
        passed = (
            passed
            and completed_successfully
            and bool(final_text.strip())
            and response_budget["passed"]
        )
        results.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "passed": passed,
                "completed_successfully": completed_successfully,
                "tool_response_budget": response_budget,
                "model_ms": (time.perf_counter() - start) * 1000,
                "exit_code": result.returncode,
                "read_uris": reads,
                "successful_read_uris": successful_reads,
                "citation_uris": citations,
                "exact_leaf_read": exact_read,
                "required_read_coverage": required_reads_verified,
                "missing_value_review_required": case.get("behavior")
                in ("missing-value", "missing_value"),
                "clarification_review_required": case["kind"] == "ambiguous",
                "continuation_verified": case["id"] in continuation_verified,
                "expected_citation": cited,
                "provider_version_cited": args.provider_version in text,
                "clarification": clarification,
                "false_live_pattern": false_live,
                "hcl_fences": len(code_fences),
                "hcl_required": hcl_required,
                "mandatory_hcl_emitted": final_hcl_emitted if hcl_required else None,
                "hcl_field_validation": "requires explicit review against pinned sections"
                if code_fences
                else "no HCL emitted",
                "response_sha256": hashlib.sha256(text.encode()).hexdigest(),
                "raw_trace_sha256": hashlib.sha256(result.stdout.encode()).hexdigest(),
            }
        )
    except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as error:
        results.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "passed": False,
                "error": type(error).__name__,
            }
        )
    (args.output / "report.json").write_text(
        json.dumps(
            {
                "model": args.model,
                "execution_route": execution_route,
                "input_sha256": provenance,
                "binary": args.binary,
                "provider_version": args.provider_version,
                "suite_sha256": hashlib.sha256(suite_bytes).hexdigest(),
                "automated_trace_accuracy": sum(r["passed"] for r in results)
                / len(results),
                "manual_review_required": True,
                "post_analysis_regression": args.regression,
                "qualification_passed": False,
                "complete": len(results) == len(cases),
                "partition_index": args.partition_index,
                "partition_count": args.partition_count,
                "hcl_review_required": any(r.get("hcl_fences", 0) for r in results),
                "results": results,
            },
            indent=2,
        )
        + "\n"
    )
    print(case["id"], results[-1]["passed"], flush=True)
