# ruff: noqa: INP001
"""Match completed successful read results to their exact requested paths."""

import json
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit

SURROGATE_START = 0xD800
SURROGATE_END = 0xDFFF


def missing_user_values_requested(text: str, fields: list[str]) -> bool:
    """Require every absent value to be requested before emitting any HCL."""
    if not fields:
        return True
    if emitted_hcl(text) or not has_clarification_question(text):
        return False
    questions = [
        sentence
        for sentence in re.split(r"(?<=[.!?])\s+|\n", text)
        if "?" in sentence
        or re.search(r"\b(?:provide|supply|need|missing)\b", sentence, re.IGNORECASE)
    ]
    return all(
        any(
            re.search(r"\b" + re.escape(field) + r"\b", question, re.IGNORECASE)
            for question in questions
        )
        for field in fields
    )


def has_false_live_apply_claim(text: str) -> bool:
    """Screen affirmative live claims without joining separate sentences."""
    clauses = re.split(r"(?<=[.!?;])\s+|\n", text)
    for clause in clauses:
        claim = re.sub(
            r"not verified by (?:a )?live apply|not (?:live[- ]?)?apply evidence|"
            r"not successfully applied|no live apply (?:was |has been )?performed",
            "",
            clause,
            flags=re.IGNORECASE,
        )
        if re.search(
            r"(?<!not )successfully applied|confirmed.*(?:your tenant|your account)|verified.*live apply",
            claim,
            re.IGNORECASE,
        ):
            return True
    return False


def cites_provider_version(text: str, provider_version: str) -> bool:
    """Match the pinned semantic version with an optional display v prefix."""
    version = provider_version.removeprefix("v")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        message = "Expected an exact stable provider version"
        raise ValueError(message)
    return bool(
        re.search(
            r"(?<![A-Za-z0-9_.])v?"
            + re.escape(version)
            + r"(?![A-Za-z0-9_+-]|\.[A-Za-z0-9])",
            text,
        )
    )


def successful_read_paths(messages: list[dict[str, Any]]) -> list[str]:
    """Require a successful result for each counted read call."""
    calls: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    results: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for index, message in enumerate(messages):
        if message.get("role") == "assistant":
            for part in message.get("content", []):
                if (
                    part.get("type") == "toolCall"
                    and isinstance(part.get("id"), str)
                    and part["id"]
                ):
                    calls.setdefault(part["id"], []).append((index, part))
        if (
            message.get("role") == "toolResult"
            and isinstance(message.get("toolCallId"), str)
            and message["toolCallId"]
        ):
            results.setdefault(message["toolCallId"], []).append((index, message))
    paths = []
    for identity, matching_calls in calls.items():
        matching_results = results.get(identity, [])
        if len(matching_calls) != 1 or len(matching_results) != 1:
            continue
        call_index, call = matching_calls[0]
        result_index, result = matching_results[0]
        if (
            call.get("name") == "read"
            and result.get("toolName") == "read"
            and result.get("isError") is False
            and result_index > call_index
        ):
            path = call.get("arguments", {}).get("path", "")
            if isinstance(path, str) and re.match(
                r"^xcsh://terraform-documentation(?:[/?#]|$)", path, re.IGNORECASE
            ):
                text = "\n".join(
                    part.get("text", "")
                    for part in result.get("content", [])
                    if part.get("type") == "text"
                )
                if not text.strip() or re.search(
                    r"^Oversized section:", text, re.MULTILINE
                ):
                    continue
            paths.append(path)
    return paths


def validate_model_activation(cases: list[dict[str, Any]]) -> None:
    """Reject model acceptance prompts that never activate Terraform."""
    invalid = [
        item["id"]
        for item in cases
        if item["kind"] in ["answerable", "ambiguous"]
        and not re.search(r"\bterraform\b|\bhcl\b", item["prompt"], re.IGNORECASE)
    ]
    if invalid:
        raise ValueError(
            "Model cases lack explicit Terraform activation: " + ", ".join(invalid)
        )


def has_clarification_question(text: str) -> bool:
    """Ignore code and link queries when detecting a user-facing question."""
    prose = re.sub(r"```[\s\S]*?```", "", text)
    prose = re.sub(r"(`+)[^`]*?\1", "", prose)
    prose = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", prose)
    prose = re.sub(r"(?:xcsh|https?)://[^\s]+", "", prose)
    return bool(
        re.search(
            r"\?|\b(?:please clarify|could you clarify|need to know|which (?:method|type|mode|location|role) do you)\b",
            prose,
            re.IGNORECASE,
        )
    )


def required_read_coverage(successful_reads: list[str], required: list[str]) -> bool:
    """Every required anchored section needs a completed successful read."""

    def normalize(uri: str) -> str:
        parsed = urlsplit(uri)
        return urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment)
        )

    actual = {
        normalize(uri)
        for uri in successful_reads
        if parse_qs(urlsplit(uri).query).get("view", ["full"])[0] in ("context", "full")
    }
    return all(normalize(uri) in actual for uri in required)


def missing_value_response_supported(text: str, expectation: str) -> bool:
    """Require evidence about the named missing schema value, not an apply disclaimer."""
    prose = re.sub(r"```[\s\S]*?```", "", text)
    fields = re.findall(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b", expectation)
    grounded = (
        any(field.lower() in prose.lower() for field in fields) if fields else False
    )
    return grounded and bool(
        re.search(
            r"\brequired\b|\bmissing\b|\b(?:supply|provide|specify|choose)\b|\b(?:cannot|can't)\b",
            prose,
            re.IGNORECASE,
        )
    )


def validate_model_subset_identity(
    subset: list[dict[str, object]], suite: list[dict[str, object]]
) -> None:
    """Require selected model cases to equal their frozen source objects."""
    by_id = {case["id"]: case for case in suite}
    for case in subset:
        if case.get("id") not in by_id or case != by_id[case["id"]]:
            message = f"Model subset changed frozen case {case.get('id')}"
            raise ValueError(message)


def valid_drafting_read(uri: str) -> bool:
    """Require a document destination and exact, nonempty property anchor."""
    if not re.fullmatch(
        r"xcsh://terraform-documentation/documentation/[A-Za-z0-9_./-]+\.md#[A-Za-z0-9_.-]+",
        uri,
    ):
        return False
    parsed = urlsplit(uri)
    return (
        parsed.scheme == "xcsh"
        and parsed.netloc == "terraform-documentation"
        and parsed.path.startswith("/documentation/")
        and parsed.path.endswith(".md")
        and ".." not in parsed.path.split("/")
        and bool(parsed.fragment.strip())
        and not parsed.query
    )


def supplied_drafting_values(values: Any, fields: Any, prompt: str) -> bool:
    """Field-associated synthetic scalar values must be visible to the tested model."""
    if not isinstance(values, dict) or not values or not isinstance(fields, list):
        return False
    for key, value in values.items():
        if not isinstance(key, str) or key not in fields or key not in prompt:
            return False
        if not isinstance(value, (str, int, float, bool)) or value is None:
            return False
        rendered = str(value).lower() if isinstance(value, bool) else str(value)
        if not rendered.strip() or rendered not in prompt:
            return False
    return True


def validate_hcl_drafting_coverage(cases: list[dict[str, Any]]) -> None:
    """Require positive drafting cases so supported-HCL acceptance cannot be vacuous."""
    drafting = []
    for case in cases:
        expectation = case.get("model_expectations", {})
        if not isinstance(expectation, dict):
            message = "Model expectations must be an object"
            raise TypeError(message)
        required = expectation.get("requires_hcl", False)
        if not isinstance(required, bool):
            message = "HCL drafting expectation must be boolean"
            raise TypeError(message)
        if not required:
            continue
        fields = expectation.get("supported_fields")
        reads = expectation.get("must_read")
        values = expectation.get("synthetic_values")
        invalid = [
            case.get("kind") != "answerable",
            not re.search(
                r"\b(?:draft|write|generate|create)\b.*\b(?:hcl|terraform)\b",
                case.get("prompt", ""),
                re.IGNORECASE,
            ),
            not isinstance(fields, list),
            not fields,
            isinstance(fields, list)
            and any(
                not isinstance(field, str) or not field.strip() for field in fields
            ),
            not isinstance(reads, list),
            not reads,
            isinstance(reads, list)
            and any(
                not isinstance(uri, str) or not valid_drafting_read(uri)
                for uri in reads
            ),
            not isinstance(values, dict),
            not values,
            not supplied_drafting_values(values, fields, case.get("prompt", "")),
        ]
        if any(invalid):
            message = "Mandatory HCL cases require answerable drafting intent, fields, exact reads and synthetic values"
            raise ValueError(message)
        drafting.append(case)
    if not drafting:
        message = (
            "Model qualification requires positive mandatory HCL drafting coverage"
        )
        raise ValueError(message)


def hcl_code_blocks(text: str) -> list[str]:
    """Use one fence parser for mandatory emission and schema-review detection."""
    return re.findall(
        r"```(?:hcl|terraform)[ \t]*\r?\n([\s\S]*?)```", text, re.IGNORECASE
    )


def emitted_hcl(text: str) -> bool:
    """Only a nonempty HCL/terraform fence establishes a drafting attempt."""
    return any(code.strip() for code in hcl_code_blocks(text))


def terraform_tool_response_budget(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Audit complete UTF-8 tool envelopes, pairing every Terraform read result."""
    calls: dict[str, list[tuple[int, str | None]]] = {}
    results: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    violations: list[dict[str, Any]] = []
    for index, message in enumerate(messages):
        if message.get("role") == "assistant":
            for part in message.get("content", []):
                if part.get("type") != "toolCall":
                    continue
                identity = part.get("id")
                if not isinstance(identity, str) or not identity:
                    violations.append({"reason": "invalid-tool-call-id"})
                    continue
                uri = part.get("arguments", {}).get("path", "")
                terraform = (
                    part.get("name") == "read"
                    and isinstance(uri, str)
                    and re.match(
                        r"^xcsh://terraform-documentation(?:[/?#]|$)",
                        uri,
                        re.IGNORECASE,
                    )
                )
                calls.setdefault(identity, []).append(
                    (index, uri if terraform else None)
                )
        elif message.get("role") == "toolResult":
            identity = message.get("toolCallId")
            if not isinstance(identity, str) or not identity:
                violations.append({"reason": "invalid-tool-result-id"})
                continue
            results.setdefault(identity, []).append((index, message))
    violations.extend(
        {"tool_call_id": identity, "reason": "orphan-tool-result"}
        for identity in results
        if identity not in calls
    )
    total_bytes = maximum = measured = 0
    for identity, matching in calls.items():
        completed = results.get(identity, [])
        if (
            not identity
            or len(matching) != 1
            or len(completed) != 1
            or completed[0][0] <= matching[0][0]
        ):
            violations.append(
                {"tool_call_id": identity, "reason": "unpaired-or-duplicate-result"}
            )
            continue
        uri = matching[0][1]
        if uri is None:
            continue
        result = completed[0][1]
        if result.get("toolName") != "read":
            violations.append(
                {"tool_call_id": identity, "reason": "mismatched-tool-result"}
            )
            continue
        serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        serialized = "".join(
            f"\\u{ord(character):04x}"
            if SURROGATE_START <= ord(character) <= SURROGATE_END
            else character
            for character in serialized
        )
        size = len(serialized.encode("utf-8"))
        total_bytes += size
        maximum = max(maximum, size)
        measured += 1
        view = parse_qs(urlsplit(uri).query).get("view", ["full"])[0]
        budget = (
            4096
            if urlsplit(uri).path in ("", "/") or view == "hint"
            else 16384
            if view == "context"
            else None
        )
        if budget is not None and size > budget:
            violations.append(
                {
                    "tool_call_id": identity,
                    "uri": uri,
                    "response_bytes": size,
                    "budget_bytes": budget,
                    "reason": "response-budget-exceeded",
                }
            )
    return {
        "passed": not violations,
        "total_bytes": total_bytes,
        "max_bytes": maximum,
        "measured_results": measured,
        "violations": violations,
    }


def validate_known_suite_exposure(digest: str, regression: bool) -> None:
    """Historical exposure overrides stale eligibility metadata."""
    ledger = json.loads(
        Path(__file__).with_name("exposed-inputs.json").read_text(encoding="utf-8")
    )
    if not regression and any(
        record["sha256"] == digest for record in ledger["records"]
    ):
        message = "Known exposed input is regression only"
        raise ValueError(message)


def audit_public_citations(
    messages: list[dict[str, Any]], required: list[str]
) -> dict[str, Any]:
    """Use the production citation registry and reference extraction for qualification."""
    script = Path(__file__).with_name("public-citation-audit.ts")
    result = subprocess.run(  # noqa: S603 - repository-owned script; all transcript data travels through stdin
        ["bun", str(script)],  # noqa: S607 - use the repository-verified Bun on PATH
        input=json.dumps({"messages": messages, "required": required}),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)
