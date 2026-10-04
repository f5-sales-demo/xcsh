# ruff: noqa: INP001
"""Match completed successful read results to their exact requested paths."""

import re
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit


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
            paths.append(call.get("arguments", {}).get("path", ""))
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
