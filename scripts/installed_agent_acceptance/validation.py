"""Installed executable acceptance: validation."""

from __future__ import annotations

import json
import pathlib
import re
from http import HTTPStatus

from .common import (
    API_PATH,
    MAX_API_ATTEMPTS,
    MAX_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    SHELL_COMMAND,
    Json,
    fail,
    require,
    text_content,
)


def validate_observations(expected: Json, metadata: Json, observations: Json) -> None:
    """Check validate observations independently."""
    for key in (
        "executable",
        "version",
        "sha256",
        "host",
        "platform",
        "architecture",
        "backend",
        "scenario",
    ):
        require(bool(metadata.get(key)), "missing executable receipt field: " + key)
    require(
        pathlib.Path(metadata["executable"]).is_absolute(),
        "executable path must be absolute",
    )
    require(
        re.fullmatch(r"[a-f0-9]{64}", metadata["sha256"]), "invalid executable digest"
    )
    require(metadata["backend"] in ("deterministic", "live"), "invalid backend")
    for key in (
        "savedProfilesUnchanged",
        "startupPointerUnchanged",
        "selectionFeedback",
        "selectionBorder",
        "selectionNetworkFree",
        "evidenceComplete",
    ):
        require(observations.get(key) is True, "unproven observation: " + key)
    if expected.get("plugin"):
        require(
            observations.get("pluginEffectiveContext") is True,
            "plugin effective context not observed",
        )
        require(
            observations.get("parentContextPreserved") is True,
            "plugin changed parent context",
        )
        require(
            observations.get("pluginEnvironmentRestored") is True,
            "plugin process environment was not restored",
        )
    if expected.get("bang"):
        require(
            observations.get("bangCommandsCompleted") is True,
            "bang result was not persisted",
        )
    if expected.get("invalidProfile"):
        require(
            observations.get("requiredProfileRejected") is True,
            "invalid required profile was not rejected",
        )
    if expected.get("context"):
        require(
            observations.get("inheritedFallbackUnused") is True,
            "inherited F5 fallback was used",
        )
    if metadata["backend"] == "live":
        require(
            observations.get("thinkingLevel") == "high",
            "live thinking level not observed",
        )
        require(
            observations.get("credentialNotRecorded") is True,
            "live credential appeared in recorded evidence",
        )
    require(observations.get("externalRgExecutions") == 0, "external rg executed")


def validate_message_integrity(
    expected: Json, messages: list[Json], metadata: Json
) -> tuple[list[Json], list[Json]]:
    """Check validate message integrity independently."""
    calls = [
        c
        for m in messages
        if m.get("role") == "assistant"
        for c in m.get("content", [])
        if c.get("type") == "toolCall"
    ]
    results = [m for m in messages if m.get("role") == "toolResult"]
    require(
        len({c["id"] for c in calls}) == len(calls), "duplicate tool call identifiers"
    )
    by_id = {c["id"]: c for c in calls}
    for result in results:
        require(result.get("toolCallId") in by_id, "orphan tool result")
        require(
            by_id[result["toolCallId"]]["name"] == result.get("toolName"),
            "tool/result name mismatch",
        )
    for call in calls:
        require(
            sum(r.get("toolCallId") == call["id"] for r in results) == 1,
            "missing or duplicate actual tool result",
        )
    require(
        bool(messages)
        and messages[-1].get("role") == "assistant"
        and messages[-1].get("stopReason") == "stop",
        "incomplete assistant turn",
    )
    for name in expected["tools"]:
        require(
            any(c["name"] == name for c in calls),
            "required tool did not execute: " + name,
        )
    for message in messages:
        if message.get("role") == "assistant":
            require(
                message.get("provider")
                == ("openai-codex" if metadata["backend"] == "live" else "anthropic"),
                "assistant provider differs",
            )
            require(
                message.get("model")
                == (
                    "gpt-6.1-sol"
                    if metadata["backend"] == "live"
                    else "claude-sonnet-4-5"
                ),
                "assistant model differs",
            )
    return calls, results


def parse_report(
    calls: list[Json], expected: Json, messages: list[Json]
) -> tuple[Json, list[Json], str]:
    """Check parse report independently."""
    final_text = text_content(messages[-1]).strip()
    if final_text.startswith("```json\n") and final_text.endswith("\n```"):
        final_text = final_text[8:-4]
    try:
        report = json.loads(final_text)
    except (ValueError, TypeError) as error:
        fail("assistant final report is not structured evidence", cause=error)
    require(isinstance(report, dict), "assistant final report is not an object")
    final = final_text.lower()
    api_calls = [c for c in calls if c["name"] == "xcsh_api"]
    require(
        len(api_calls) == (1 if "xcsh_api" in expected["tools"] else 0),
        "API tool call count differs",
    )
    allowed_report_keys = (
        {"namespace", "apiStatus", "outcome", "resourceNames"}
        if api_calls
        else {"namespace", "outcome", "matchingContent"}
    )
    require(
        set(report) == allowed_report_keys, "assistant report has unverified fields"
    )
    return report, api_calls, final


def validate_arguments(
    api_calls: list[Json], calls: list[Json], expected: Json
) -> None:
    """Check validate arguments independently."""
    for call in calls:
        args = call["arguments"]
        if call["name"] == "xcsh_context":
            require(
                args.get("action") == "status", "context status action was not executed"
            )
        if call["name"] == "bash":
            require(
                args.get("command") == SHELL_COMMAND,
                "bash did not execute the genuine environment probe",
            )
        if call["name"] == "grep":
            require(
                args.get("pattern") == expected["grepPattern"]
                and args.get("path") == expected["grepPath"],
                "native search pattern/path differs",
            )
    for call in api_calls:
        args = call["arguments"]
        if expected.get("guard"):
            require(
                args.get("contextName") == expected["guard"],
                "requested context guard differs",
            )
        require(
            args.get("method") == "GET" and args.get("path") == API_PATH,
            "API method/path scope differs",
        )
        require(
            args.get("expandDiscovery") is False and not args.get("paths"),
            "unscoped discovery expansion",
        )
        require(
            "namespace" not in args.get("params", {}),
            "explicit namespace hides context substitution",
        )


def validate_context_results(expected: Json, results: list[Json]) -> None:
    """Check validate context results independently."""
    for result in results:
        if result.get("toolName") == "xcsh_context":
            status = result.get("details") or json.loads(text_content(result))
            require(
                status.get("activeContextName") == expected["context"],
                "context status disagrees",
            )
            require(
                status.get("activeContextNamespace") == expected["namespace"],
                "namespace status disagrees",
            )
        if result.get("toolName") == "bash":
            require(
                not result.get("isError")
                and result.get("details", {}).get("execution", {}).get("exitCode") == 0,
                "bash environment probe did not succeed",
            )
            for value in expected.get("shellValues", []):
                require(
                    value in text_content(result), "shell state disagrees: " + value
                )
        if result.get("toolName") == "xcsh_context":
            authority = (
                "context"
                if expected["context"]
                else "environment"
                if expected["namespace"]
                else "none"
            )
            require(
                status.get("credentialSource") == authority, "context authority differs"
            )
            if expected.get("authStatus"):
                require(
                    status.get("authStatus") == expected["authStatus"],
                    "cached authentication outcome differs",
                )


def validate_transport(
    expected: Json, requests: list[Json], results: list[Json]
) -> list[Json]:
    """Check validate transport independently."""
    resource_requests = [r for r in requests if "/http_loadbalancers" in r["path"]]
    require(
        len(resource_requests) == expected["requestCount"],
        "unexpected backend request/retry count",
    )
    for request in requests:
        require(request["method"] in ("GET", "HEAD"), "unexpected backend mutation")
        require(request.get("credentialMatches") is True, "backend credential mismatch")
        require(
            request.get("endpoint") == expected.get("endpoint", expected["context"]),
            "backend endpoint mismatch",
        )
        require(
            request.get("context") == expected["context"], "backend context mismatch"
        )
        require(
            request["path"]
            == API_PATH.replace("{namespace}", expected["namespace"] or "")
            or request["path"] == "/api/web/namespaces",
            "backend namespace/path mismatch",
        )
    api_results = [r for r in results if r.get("toolName") == "xcsh_api"]
    for result in api_results:
        detail = result.get("details", {})
        if not resource_requests:
            require(
                not detail.get("retried"),
                "local or refused request falsely reports retry",
            )
        if resource_requests:
            group = [
                r
                for r in resource_requests
                if r.get("requestId") == detail.get("requestId")
            ]
            require(
                bool(detail.get("requestId"))
                and len(group) == expected["requestCount"],
                "backend request identifier differs",
            )
            statuses = [r.get("status") for r in group]
            require(
                detail.get("url") == group[0].get("url")
                and detail.get("method") == "GET",
                "API transport destination differs",
            )
            require(
                bool(detail.get("retried")) == (len(group) == MAX_API_ATTEMPTS),
                "API retry flag differs",
            )
            require(
                statuses
                == expected.get("backendStatuses", [expected["status"]] * len(group)),
                "backend status differs",
            )
    return resource_requests


def validate_api_results(
    expected: Json, final: str, report: Json, results: list[Json]
) -> None:
    """Check validate api results independently."""
    for result in results:
        if result.get("toolName") == "xcsh_api":
            actual_status = result.get("details", {}).get("status")
            require(
                report.get("apiStatus") is None
                or (
                    isinstance(report.get("apiStatus"), int)
                    and not isinstance(report.get("apiStatus"), bool)
                ),
                "reported API status must be integer or null",
            )
            if expected["status"] is not None:
                require(
                    result.get("details", {}).get("url") == expected["url"],
                    "effective API endpoint differs",
                )
            if expected.get("timeout"):
                require(
                    MIN_TIMEOUT_MS
                    <= result.get("details", {}).get("durationMs", 0)
                    <= MAX_TIMEOUT_MS,
                    "API timeout was not bounded at 30 seconds",
                )
            require(actual_status == expected["status"], "actual API status differs")
            failure = (
                expected["status"] is None
                or expected["status"] == 0
                or expected["status"] >= HTTPStatus.BAD_REQUEST
            )
            require(
                bool(result.get("isError")) == failure,
                "API success/error outcome differs",
            )
            if failure:
                require(
                    report.get("outcome") == "error"
                    and report.get("resourceNames") == [],
                    "fabricated success or resources",
                )
            elif expected.get("empty"):
                require(
                    result.get("details", {}).get("itemCount") == 0,
                    "empty result not observed",
                )
                require(
                    report.get("outcome") == "empty"
                    and report.get("resourceNames") == [],
                    "empty result not reported",
                )
            else:
                names = report.get("resourceNames")
                require(
                    report.get("outcome") == "success"
                    and isinstance(names, list)
                    and all(isinstance(name, str) for name in names)
                    and sorted(names) == sorted(expected["markers"]),
                    "reported resources differ",
                )
            require(
                report.get("apiStatus") == expected["status"],
                "reported API status differs",
            )
            for marker in expected.get("markers", []):
                require(
                    marker in text_content(result) and marker.lower() in final,
                    "resource not observed in result and completion",
                )


def validate_search_report(
    expected: Json, final: str, report: Json, results: list[Json]
) -> None:
    """Check validate search report independently."""
    require(
        report.get("namespace") == expected.get("namespace"),
        "reported namespace differs",
    )
    if expected.get("grep"):
        grep_results = [r for r in results if r.get("toolName") == "grep"]
        require(len(grep_results) == 1, "search did not execute exactly once")
        outcome = expected["grep"]
        result = grep_results[0]
        if outcome == "match":
            require(
                not result.get("isError")
                and result.get("details", {}).get("matchCount") == 1,
                "native search match was not successful",
            )
            require(
                expected["searchMarker"] in text_content(result)
                and expected["searchMarker"].lower() in final,
                "native search did not observe hidden content",
            )
            require(report.get("outcome") == "match", "search match not reported")
            require(
                report.get("matchingContent") == "needle " + expected["searchMarker"],
                "reported matching content differs",
            )
        elif outcome == "invalid":
            require(
                bool(result.get("isError"))
                and re.search(
                    r"regex|pattern|parse", text_content(result), re.IGNORECASE
                ),
                "invalid search pattern did not fail",
            )
            require(
                report.get("outcome") == "invalid"
                and report.get("matchingContent") == "",
                "invalid pattern outcome not reported",
            )
        else:
            require(
                not result.get("isError") and "No matches" in text_content(result),
                "no-match search outcome differs",
            )
            require(
                report.get("outcome") == "no-match"
                and report.get("matchingContent") == "",
                "no-match outcome not reported",
            )


def validate_evidence(
    metadata: Json,
    messages: list[Json],
    requests: list[Json],
    expected: Json,
    observations: Json,
) -> Json:
    """Compare completed native tool execution and transport against the independent oracle."""
    validate_observations(expected, metadata, observations)
    calls, results = validate_message_integrity(expected, messages, metadata)
    report, api_calls, final = parse_report(calls, expected, messages)
    validate_arguments(api_calls, calls, expected)
    validate_context_results(expected, results)
    resource_requests = validate_transport(expected, requests, results)
    validate_api_results(expected, final, report, results)
    validate_search_report(expected, final, report, results)
    return {
        "result": "pass",
        "toolCalls": len(calls),
        "resourceRequests": len(resource_requests),
        "agentOutcome": "api-error"
        if expected.get("status") in (None, 0, 401, 403, 404, 429, 503)
        else "completed",
    }
