"""Installed executable acceptance: provider."""

from __future__ import annotations

import json
import re
import uuid
from http import HTTPStatus
from typing import TYPE_CHECKING

from .common import API_PATH, SHELL_COMMAND, Json, fail, text_content

if TYPE_CHECKING:
    from .fixtures import Fixture


def final_answer(fixture: Fixture, messages: list[Json]) -> str:
    """Derive the final report only from observed tool results."""
    content = [
        c
        for m in messages
        for c in m.get("content", [])
        if isinstance(c, dict) and c.get("type") == "tool_result"
    ]
    if fixture.scenario == "provider-missing-tool":
        fixture.events.provider_faults.append("missing-tool")
        answer = "Successfully listed fictional resources."
    else:
        call_names = {
            c["id"]: c["name"]
            for m in messages
            for c in m.get("content", [])
            if isinstance(c, dict) and c.get("type") == "tool_use"
        }
        values = {
            call_names.get(c["tool_use_id"]): c["content"]
            if isinstance(c.get("content"), str)
            else text_content(c)
            for c in content
        }
        context = json.loads(values.get("xcsh_context", "{}"))
        report = {"namespace": context.get("activeContextNamespace")}
        if "xcsh_api" in values:
            api = values["xcsh_api"]
            match = re.match(r"(\d{3})\b", api)
            status = (
                int(match[1])
                if match
                else 0
                if re.search(
                    r"network|timed out|request failed|refused",
                    api,
                    re.IGNORECASE,
                )
                else None
            )
            report.update(apiStatus=status, resourceNames=[], outcome="error")
            if status == HTTPStatus.OK:
                data = json.JSONDecoder().raw_decode(api[api.index("{") :])[0]
                report["resourceNames"] = [item["name"] for item in data["items"]]
                report["outcome"] = "success" if report["resourceNames"] else "empty"
        else:
            grep = values.get("grep", "")
            outcome = (
                "no-match"
                if "No matches" in grep
                else "invalid"
                if re.search(r"regex|pattern|parse", grep, re.IGNORECASE)
                else "match"
            )
            line = re.search(r"needle search-[a-f0-9]+", grep)
            report.update(
                outcome=outcome,
                matchingContent=line[0] if line and outcome == "match" else "",
            )
        answer = json.dumps(report)
    return answer


def tool_arguments(fixture: Fixture, name: str) -> Json:
    """Select fixed production tool arguments for the synthetic provider."""
    if name == "xcsh_context":
        args: Json = {"action": "status"}
    elif name == "bash":
        args = {"command": SHELL_COMMAND}
    elif name == "xcsh_api":
        args = {"method": "GET", "path": API_PATH, "expandDiscovery": False}
        if fixture.scenario == "environment-name-guard":
            args["contextName"] = "context-a"
    else:
        args = {
            "pattern": "needle"
            if fixture.scenario == "search-match"
            else "absent-pattern"
            if fixture.scenario == "search-no-match"
            else "[",
            "path": "search.txt",
        }
    return args


def response(fixture: Fixture, body: Json) -> list[tuple[str, Json]]:
    """Emit one provider turn based on already executed tools."""
    latest = max(
        (
            i
            for i, m in enumerate(body["messages"])
            if m["role"] == "user"
            and (
                isinstance(m["content"], str)
                or not any(c.get("type") == "tool_result" for c in m["content"])
            )
        ),
        default=-1,
    )
    messages = body["messages"][latest + 1 :]
    used = [
        c["name"]
        for m in messages
        for c in m.get("content", [])
        if isinstance(c, dict) and c.get("type") == "tool_use"
    ]
    available = {t["name"] for t in body.get("tools", [])}
    tools = [
        "xcsh_context",
        "bash",
        "grep" if fixture.scenario.startswith("search-") else "xcsh_api",
    ]
    if fixture.scenario == "provider-missing-tool":
        tools = []
    name = next((name for name in tools if name not in used), None)
    if name and name not in available:
        fail("required production tool unavailable: " + name)
    if name:
        args = tool_arguments(fixture, name)
        block = {
            "type": "tool_use",
            "id": "call_" + uuid.uuid4().hex,
            "name": name,
            "input": {},
        }
        delta = {"type": "input_json_delta", "partial_json": json.dumps(args)}
        stop = "tool_use"
    else:
        block = {"type": "text", "text": ""}
        delta = {"type": "text_delta", "text": final_answer(fixture, messages)}
        stop = "end_turn"
    msg = {
        "id": "msg_" + uuid.uuid4().hex,
        "type": "message",
        "role": "assistant",
        "model": body["model"],
        "content": [],
        "stop_reason": None,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 1},
    }
    return [
        ("message_start", {"type": "message_start", "message": msg}),
        (
            "content_block_start",
            {"type": "content_block_start", "index": 0, "content_block": block},
        ),
        (
            "content_block_delta",
            {"type": "content_block_delta", "index": 0, "delta": delta},
        ),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop, "stop_sequence": None},
                "usage": {"output_tokens": 20},
            },
        ),
        ("message_stop", {"type": "message_stop"}),
    ]
