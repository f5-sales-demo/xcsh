# ruff: noqa: INP001
"""Match completed successful read results to their exact requested paths."""

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
