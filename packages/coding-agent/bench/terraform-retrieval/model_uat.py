# ruff: noqa: INP001, T201
"""Installed synthetic model UAT: raw traces stay outside the repository."""

import argparse
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path

from model_trace import (
    has_clarification_question,
    missing_value_response_supported,
    required_read_coverage,
    successful_read_paths,
    validate_model_activation,
)

parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
parser.add_argument("--suite", type=Path, required=True)
parser.add_argument("--freeze", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--provider-version", required=True)
parser.add_argument("--regression", action="store_true")
parser.add_argument("--model", default="openai-codex/gpt-6.1-sol")
parser.add_argument("--partition-index", type=int, default=0)
parser.add_argument("--partition-count", type=int, default=1)
args = parser.parse_args()
freeze = json.loads(args.freeze.read_text())
suite_bytes = args.suite.read_bytes()
if hashlib.sha256(suite_bytes).hexdigest() != freeze["files"]["model-subset.json"]:
    HASH_MISMATCH = "Frozen model subset hash mismatch"
    raise ValueError(HASH_MISMATCH)
if freeze.get("post_analysis_regression") and not args.regression:
    regression_error = "Exposed or derived model suite requires --regression"
    raise ValueError(regression_error)
all_cases = json.loads(suite_bytes)
INDEPENDENT_FREEZE_VERSION = 2
if freeze.get("schema_version") == INDEPENDENT_FREEZE_VERSION:
    validate_model_activation(all_cases)
cases = all_cases[args.partition_index :: args.partition_count]
args.output.mkdir(parents=True, exist_ok=True)
results = []
for case in cases:
    start = time.perf_counter()
    command = [
        args.binary,
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
        result = subprocess.run(  # noqa: S603 - caller selects an installed binary; argv is never evaluated by a shell
            command, capture_output=True, text=True, timeout=180, check=False
        )
        (args.output / (case["id"] + ".ndjson")).write_text(result.stdout)
        (args.output / (case["id"] + ".stderr.txt")).write_text(result.stderr)
        events = [
            json.loads(line) for line in result.stdout.splitlines() if line.strip()
        ]
        if not all(isinstance(event, dict) for event in events):
            message = "Unexpected non-object event in CLI JSON stream"
            raise ValueError(message)  # noqa: TRY301 - invalid event boundary is recorded as an explicit failed case
        messages = [
            message
            for event in events
            if event.get("type") == "agent_end"
            for message in event.get("messages", [])
        ]
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

        successful_reads = successful_read_paths(messages)
        expected = case["expected"]
        required_reads = case.get("model_expectations", {}).get("must_read", [])
        required_reads_verified = required_read_coverage(
            successful_reads, required_reads
        )
        exact_read = any(
            any(
                normalized(read) == normalized(want)
                or (
                    case.get("match_document")
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
        code_fences = re.findall(r"```(?:hcl|terraform)\n([\s\S]*?)```", text)
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
            passed = result.returncode == 0 and clarification and not false_live
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
        results.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "passed": passed,
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
                "expected_citation": cited,
                "provider_version_cited": args.provider_version in text,
                "clarification": clarification,
                "false_live_pattern": false_live,
                "hcl_fences": len(code_fences),
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
