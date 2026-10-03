# ruff: noqa: INP001
"""Match completed successful read results to their exact requested paths."""

import re
from typing import Any


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
