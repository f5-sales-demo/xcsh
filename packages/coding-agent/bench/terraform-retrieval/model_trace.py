# ruff: noqa: INP001
"""Match completed successful read results to their exact requested paths."""

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit


def successful_read_paths(messages: list[dict[str, Any]]) -> list[str]:
    """Require a successful result for each counted read call."""
    successful = {
        m.get("toolCallId")
        for m in messages
        if m.get("role") == "toolResult"
        and m.get("toolName") == "read"
        and m.get("isError") is False
    }
    return [
        c.get("arguments", {}).get("path", "")
        for m in messages
        if m.get("role") == "assistant"
        for c in m.get("content", [])
        if c.get("type") == "toolCall"
        and c.get("name") == "read"
        and c.get("id") in successful
    ]


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

    actual = {normalize(uri) for uri in successful_reads}
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
