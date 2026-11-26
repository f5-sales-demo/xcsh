#!/usr/bin/env python3
"""Installed-agent acceptance. Raw evidence is private; receipts are allowlisted.

Only provider and synthetic tenant transport are fixtures. Every tool executes in
the supplied CLI, through the interactive agent. No third-party Python packages.
"""

from __future__ import annotations

import argparse
import base64
import codecs
import contextlib
import fcntl
import hashlib
import http.server
import json
import os
import pathlib
import platform
import pty
import re
import selectors
import shutil
import signal
import sqlite3
import ssl
import struct
import subprocess
import sys
import termios
import threading
import time
import uuid
from http import HTTPStatus
from typing import TYPE_CHECKING, Any, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable


class AcceptanceError(Exception):
    """Observed evidence failed a required acceptance condition."""


Json = dict[str, Any]
MAX_API_ATTEMPTS = 2
MIN_TIMEOUT_MS = 29_000
MAX_TIMEOUT_MS = 35_000
ERASE_WHOLE_LINE = 2
PRINTABLE_CHARACTER = 32


def fail(message: str, *, cause: BaseException | None = None) -> NoReturn:
    """Reject evidence with a stable reason while preserving a private cause."""
    raise AcceptanceError(message) from cause


def validate_evidence(
    metadata: Json,
    messages: list[Json],
    requests: list[Json],
    expected: Json,
    observations: Json,
) -> Json:
    """Compare completed native tool execution and transport against the independent oracle."""

    def require(condition: object, reason: str) -> None:
        """Observe require for the acceptance fixture."""
        if not condition:
            fail(reason)

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
    for result in results:
        if result.get("toolName") == "xcsh_api":
            actual_status = result.get("details", {}).get("status")
            require(
                report.get("apiStatus") is None or type(report.get("apiStatus")) is int,
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
    return {
        "result": "pass",
        "toolCalls": len(calls),
        "resourceRequests": len(resource_requests),
        "agentOutcome": "api-error"
        if expected.get("status") in (None, 0, 401, 403, 404, 429, 503)
        else "completed",
    }


API_PATH = "/api/config/namespaces/{namespace}/http_loadbalancers"
SHELL_COMMAND = (
    "printf 'NS=%s LOGIN=%s REGION=%s STALE=%s TIMEOUT=%s\\n' "
    '"${XCSH_NAMESPACE-unset}" "${XCSH_USERNAME-unset}" "${XCSH_REGION-unset}" '
    '"${XCSH_STALE-unset}" "${XCSH_PLUGIN_GIT_TIMEOUT_MS-unset}"'
)

PROMPT = (
    "Inspect the current context using xcsh_context with action=status. Keep the current selection; do not activate another context. "
    "Run exactly this command with the bash tool, without changing it:\n```bash\n"
    + SHELL_COMMAND
    + "\n```\n"
    "Finish those two tools before the API call. Use xcsh_api to list the fixture's HTTP load balancers through "
    + API_PATH
    + ", leaving namespace substitution to the current context and disabling discovery expansion. "
    "Return only one JSON object with namespace, apiStatus (HTTP status, 0 for transport failure, null for local rejection), "
    "outcome (success, empty or error), and resourceNames (observed names, or an empty array on empty/error). Do not retry tools manually."
)

SCENARIOS = [
    "explicit",
    "automatic-startup",
    "guided",
    "guided-manual",
    "cancelled",
    "repeated",
    "transition",
    "cached-shell",
    "override",
    "environment",
    "environment-name-guard",
    "environment-missing-token",
    "no-context",
    "nonexistent",
    "missing-token",
    "auth-error",
    "offline",
    "http-401",
    "http-403",
    "http-404",
    "http-429",
    "http-503",
    "timeout",
    "refused",
    "empty",
    "admitted-namespace",
    "admitted-context",
    "plugin-success",
    "plugin-failure",
    "search-match",
    "search-no-match",
    "search-invalid",
    "provider-failure",
    "provider-malformed",
    "provider-missing-tool",
]
NEGATIVE_SCENARIOS = set(SCENARIOS[-3:])


def text_content(message: Json) -> str:
    """Extract only textual content from an agent message."""
    content = message.get("content", [])
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content if c.get("type") == "text")


def digest(path: pathlib.Path) -> str:
    """Hash a file incrementally without retaining its bytes in memory."""
    h = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path: pathlib.Path, value: Any) -> None:
    """Write a private or allowlisted receipt with a complete final newline."""
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")


class Screen:
    """Small VT observer for wait conditions; render receipts use the existing xterm renderer."""

    def __init__(self, rows: int = 40, cols: int = 120) -> None:
        """Observe init for the acceptance fixture."""
        self.rows, self.cols = rows, cols
        self.cells = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.saved = (0, 0)
        self.pending = ""

    def feed(self, text: str) -> None:
        """Observe feed for the acceptance fixture."""
        text = self.pending + text
        self.pending = ""
        i = 0
        while i < len(text):
            c = text[i]
            if c == "\x1b":
                match = re.match(r"\x1b\[([?=>0-9;:]*)([ -/]*)([@-~])", text[i:])
                if match:
                    args, _, command = match.groups()
                    private = args.startswith("?")
                    nums = [
                        int(n or 0)
                        for n in args.lstrip("?=>").split(";")
                        if ":" not in n
                    ]
                    n = nums[0] if nums and nums[0] else 1
                    if not private:
                        if command in "Hf":
                            self.row = min(self.rows - 1, max(0, n - 1))
                            self.col = min(
                                self.cols - 1,
                                max(
                                    0, (nums[1] if len(nums) > 1 and nums[1] else 1) - 1
                                ),
                            )
                        elif command == "A":
                            self.row = max(0, self.row - n)
                        elif command == "B":
                            self.row = min(self.rows - 1, self.row + n)
                        elif command == "C":
                            self.col = min(self.cols - 1, self.col + n)
                        elif command == "D":
                            self.col = max(0, self.col - n)
                        elif command == "G":
                            self.col = min(self.cols - 1, n - 1)
                        elif command == "d":
                            self.row = min(self.rows - 1, n - 1)
                        elif command == "J":
                            mode = nums[0] if nums else 0
                            if mode in (2, 3):
                                self.cells = [
                                    [" "] * self.cols for _ in range(self.rows)
                                ]
                            elif mode == 0:
                                self.cells[self.row][self.col :] = [" "] * (
                                    self.cols - self.col
                                )
                                for row in range(self.row + 1, self.rows):
                                    self.cells[row] = [" "] * self.cols
                        elif command == "K":
                            mode = nums[0] if nums else 0
                            start, end = (
                                (0, self.cols)
                                if mode == ERASE_WHOLE_LINE
                                else (0, self.col + 1)
                                if mode == 1
                                else (self.col, self.cols)
                            )
                            self.cells[self.row][start:end] = [" "] * (end - start)
                        elif command == "s":
                            self.saved = (self.row, self.col)
                        elif command == "u":
                            self.row, self.col = self.saved
                    i += len(match.group(0))
                    continue
                if text[i : i + 2] in ("\x1b]", "\x1bP"):
                    match = re.match(
                        r"\x1b[\]P].*?(?:\x07|\x1b\\)", text[i:], re.DOTALL
                    )
                    if match:
                        i += len(match.group(0))
                        continue
                    self.pending = text[i:]
                    break
                if i + 1 >= len(text) or text[i + 1] == "[":
                    self.pending = text[i:]
                    break
                i += 3 if text[i + 1] in "()" else 2
                continue
            if c == "\r":
                self.col = 0
            elif c == "\n":
                self.row += 1
                if self.row >= self.rows:
                    self.cells.pop(0)
                    self.cells.append([" "] * self.cols)
                    self.row = self.rows - 1
            elif c == "\b":
                self.col = max(0, self.col - 1)
            elif c == "\t":
                self.col = min(self.cols - 1, (self.col // 8 + 1) * 8)
            elif ord(c) >= PRINTABLE_CHARACTER:
                if self.col >= self.cols:
                    self.col = 0
                    self.row = min(self.rows - 1, self.row + 1)
                self.cells[self.row][self.col] = c
                self.col += 1
            i += 1

    def text(self) -> str:
        """Observe text for the acceptance fixture."""
        return "\n".join("".join(row).rstrip() for row in self.cells)


class Terminal:
    """Control one task-owned PTY and preserve its exact byte stream."""

    def __init__(
        self,
        args: list[str],
        env: dict[str, str],
        cwd: pathlib.Path,
        private: pathlib.Path,
    ) -> None:
        """Observe init for the acceptance fixture."""
        self.screen = Screen()
        self.master, slave = pty.openpty()
        fcntl.ioctl(
            slave,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", self.screen.rows, self.screen.cols, 0, 0),
        )
        self.process = subprocess.Popen(  # noqa: S603 - validated absolute CLI path and exact argv, no shell
            args,
            env=env,
            cwd=cwd,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave)
        os.set_blocking(self.master, False)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.master, selectors.EVENT_READ)
        self.files = contextlib.ExitStack()
        self.stream = self.files.enter_context((private / "pty.bin").open("wb"))
        self.inputs = self.files.enter_context((private / "input.jsonl").open("w"))
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.raw = ""
        self.private = private
        self.snapshots = 0
        self.bang_obligations: list[tuple[str, str]] = []

    def send(self, text: str) -> None:
        """Observe send for the acceptance fixture."""
        self.inputs.write(json.dumps({"at": time.monotonic(), "text": text}) + "\n")
        self.inputs.flush()
        os.write(self.master, text.encode())

    def pump(self, timeout: float = 0.05) -> None:
        """Observe pump for the acceptance fixture."""
        for _, _ in self.selector.select(timeout):
            try:
                chunk = os.read(self.master, 65536)
            except OSError:
                return
            if not chunk:
                return
            self.stream.write(chunk)
            self.stream.flush()
            text = self.decoder.decode(chunk)
            self.raw += text
            self.screen.feed(text)
            if "\x1b[6n" in text:
                os.write(self.master, b"\x1b[1;1R")
            if "\x1b[c" in text:
                os.write(self.master, b"\x1b[?1;2c")

    def wait(
        self, predicate: Callable[[], bool], label: str, seconds: float = 25
    ) -> None:
        """Observe wait for the acceptance fixture."""
        deadline = time.monotonic() + seconds
        while not predicate():
            self.pump()
            if self.process.poll() is not None or time.monotonic() > deadline:
                self.capture("failed-" + label)
                fail("PTY did not reach " + label)

    def settle(self, seconds: float = 0.4) -> None:
        """Observe settle for the acceptance fixture."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()

    def capture(
        self,
        label: str,
        *,
        required: tuple[str, ...] = (),
        forbidden: tuple[str, ...] = (),
    ) -> None:
        """Observe capture for the acceptance fixture."""
        self.snapshots += 1
        write_json(
            self.private / (f"viewport-{self.snapshots:02d}.json"),
            {
                "label": label,
                "streamBytes": self.stream.tell(),
                "rows": self.screen.rows,
                "columns": self.screen.cols,
                "observerText": self.screen.text(),
                "requiredText": list(required),
                "forbiddenText": list(forbidden),
            },
        )

    def close(self) -> None:
        """Observe close for the acceptance fixture."""
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.pump(0)
        self.stream.close()
        self.inputs.close()
        self.files.close()
        self.selector.close()
        os.close(self.master)


class Fixture:
    """Serve synthetic tenant endpoints and a separate scripted provider endpoint."""

    def __init__(self, private: pathlib.Path, tls: pathlib.Path, scenario: str) -> None:
        """Observe init for the acceptance fixture."""
        self.private, self.scenario = private, scenario
        self.requests, self.provider, self.provider_faults = [], [], []
        self.markers = ["lb-" + uuid.uuid4().hex[:16] for _ in range(2)]
        self.search_marker = "search-" + uuid.uuid4().hex[:16]
        self.cache_marker = "cache-" + uuid.uuid4().hex[:16]
        self.tokens = {
            "context-a": "synthetic-a-" + uuid.uuid4().hex,
            "context-b": "synthetic-b-" + uuid.uuid4().hex,
            "environment": "synthetic-env-" + uuid.uuid4().hex,
            "inherited": "synthetic-inherited-" + uuid.uuid4().hex,
        }
        self.auth_status = 401 if scenario in ("auth-error", "offline") else 200
        self.resource_status = (
            int(scenario.split("-")[1]) if scenario.startswith("http-") else 200
        )
        self.gated = threading.Event()
        self.release = threading.Event()
        self.shutdown = threading.Event()
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            """Record synthetic transport without recording authorization header values."""

            protocol_version = "HTTP/1.1"

            def log_message(self, *_: object) -> None:
                """Observe log message for the acceptance fixture."""

            def do_HEAD(self) -> None:
                """Observe do HEAD for the acceptance fixture."""
                self.do_GET()

            def do_GET(self) -> None:
                """Observe do GET for the acceptance fixture."""
                if self.path in ("/v1/models", "/models"):
                    self.respond(
                        200, {"data": [{"id": "claude-sonnet-4-5", "type": "model"}]}
                    )
                    return
                token = self.headers.get("Authorization", "")
                context = next(
                    (
                        name
                        for name, value in owner.tokens.items()
                        if token == "APIToken " + value
                    ),
                    None,
                )
                endpoint = self.server.endpoint_label
                if endpoint == "inherited" and owner.scenario.startswith("environment"):
                    endpoint = "environment"
                event = {
                    "at": time.monotonic(),
                    "method": self.command,
                    "path": self.path,
                    "credentialMatches": context == endpoint,
                    "context": context,
                    "endpoint": endpoint,
                    "requestId": self.headers.get("X-Request-ID"),
                    "status": None,
                    "url": "https://127.0.0.1:"
                    + str(self.server.server_port)
                    + self.path,
                }
                owner.requests.append(event)
                if self.path == "/api/web/namespaces":
                    status, body = (
                        owner.auth_status,
                        {"items": [{"name": "default"}, {"name": "example-old"}]},
                    )
                elif re.fullmatch(
                    r"/api/config/namespaces/[a-z0-9-]+/http_loadbalancers", self.path
                ):
                    if (
                        owner.scenario.startswith("admitted-")
                        and not owner.release.is_set()
                    ):
                        owner.gated.set()
                        owner.release.wait(90)
                    if owner.scenario == "timeout":
                        owner.shutdown.wait(35)
                        return
                    if (
                        owner.scenario.startswith("admitted-")
                        and sum(
                            "/http_loadbalancers" in r["path"] for r in owner.requests
                        )
                        == 1
                    ):
                        status = 503
                    else:
                        status = owner.resource_status
                    body = {
                        "items": []
                        if owner.scenario == "empty"
                        else [{"name": name} for name in owner.markers]
                    }
                else:
                    status, body = 404, {"error": "Unexpected synthetic route"}
                if not event["credentialMatches"]:
                    status, body = 401, {"error": "Synthetic credential mismatch"}
                if status >= HTTPStatus.BAD_REQUEST:
                    body = {"error": "Synthetic HTTP failure", "status": status}
                event["status"] = status
                self.respond(status, body)

            def respond(self, status: int, body: Json) -> None:
                """Observe respond for the acceptance fixture."""
                data = json.dumps(body).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Connection", "close")
                    self.close_connection = True
                    self.send_header("Retry-After", "1")
                    self.end_headers()
                    if self.command != "HEAD":
                        self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_POST(self) -> None:
                """Observe do POST for the acceptance fixture."""
                body = json.loads(
                    self.rfile.read(int(self.headers.get("Content-Length", 0)))
                )
                if not self.path.endswith("/messages"):
                    owner.provider.append(
                        {"fault": "unexpected-provider-path", "path": self.path}
                    )
                    self.respond(404, {"error": "unexpected provider route"})
                    return
                owner.provider.append(body)
                write_json(owner.private / "provider-requests.json", owner.provider)
                if owner.scenario == "provider-failure":
                    owner.provider_faults.append("failure")
                    self.respond(
                        400,
                        {
                            "error": {
                                "type": "invalid_request_error",
                                "message": "Synthetic provider failure",
                            }
                        },
                    )
                    return
                if owner.scenario == "provider-malformed":
                    owner.provider_faults.append("malformed")
                    events = [
                        (
                            "message_start",
                            {"type": "message_start", "message": {"id": "bad"}},
                        )
                    ]
                else:
                    events = owner.response(body)
                data = "".join(
                    "event: " + kind + "\ndata: " + json.dumps(value) + "\n\n"
                    for kind, value in events
                ).encode()
                try:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Connection", "close")
                    self.close_connection = True
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.endpoint_label = "context-a"
        self.server.daemon_threads = True
        tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls_context.load_cert_chain(str(tls / "certificate.pem"), str(tls / "key.pem"))
        self.server.socket = tls_context.wrap_socket(
            self.server.socket, server_side=True
        )
        self.url = "https://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.urls = {"context-a": self.url}
        self.additional_servers = []
        for label in ("context-b", "inherited"):
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            server.daemon_threads = True
            server.endpoint_label = label
            server.socket = tls_context.wrap_socket(server.socket, server_side=True)
            self.urls[label] = "https://127.0.0.1:" + str(server.server_port)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.additional_servers.append((server, thread))
        # Independent tenant/provider listeners allow real tenant refusal while the agent still runs.
        self.provider_server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), Handler
        )
        self.provider_server.daemon_threads = True
        self.provider_server.endpoint_label = "provider"
        self.provider_server.socket = tls_context.wrap_socket(
            self.provider_server.socket, server_side=True
        )
        self.provider_url = "https://127.0.0.1:" + str(self.provider_server.server_port)
        self.provider_thread = threading.Thread(
            target=self.provider_server.serve_forever, daemon=True
        )
        self.provider_thread.start()
        self.tenant_closed = False
        self.closed = False

    def response(self, body: Json) -> list[tuple[str, Json]]:
        """Script provider tool calls and derive final answers from observed native results."""
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
            "grep" if self.scenario.startswith("search-") else "xcsh_api",
        ]
        if self.scenario == "provider-missing-tool":
            tools = []
        name = next((name for name in tools if name not in used), None)
        if name and name not in available:
            fail("required production tool unavailable: " + name)
        if name:
            if name == "xcsh_context":
                args = {"action": "status"}
            elif name == "bash":
                args = {"command": SHELL_COMMAND}
            elif name == "xcsh_api":
                args = {"method": "GET", "path": API_PATH, "expandDiscovery": False}
                if self.scenario == "environment-name-guard":
                    args["contextName"] = "context-a"
            else:
                args = {
                    "pattern": "needle"
                    if self.scenario == "search-match"
                    else "absent-pattern"
                    if self.scenario == "search-no-match"
                    else "[",
                    "path": "search.txt",
                }
            block = {
                "type": "tool_use",
                "id": "call_" + uuid.uuid4().hex,
                "name": name,
                "input": {},
            }
            delta = {"type": "input_json_delta", "partial_json": json.dumps(args)}
            stop = "tool_use"
        else:
            content = [
                c
                for m in messages
                for c in m.get("content", [])
                if isinstance(c, dict) and c.get("type") == "tool_result"
            ]
            if self.scenario == "provider-missing-tool":
                self.provider_faults.append("missing-tool")
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
                        report["resourceNames"] = [
                            item["name"] for item in data["items"]
                        ]
                        report["outcome"] = (
                            "success" if report["resourceNames"] else "empty"
                        )
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
            block = {"type": "text", "text": ""}
            delta = {"type": "text_delta", "text": answer}
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

    def close(self) -> None:
        """Observe close for the acceptance fixture."""
        if self.closed:
            return
        self.closed = True
        self.release.set()
        self.shutdown.set()
        self.close_tenant()
        self.provider_server.shutdown()
        self.provider_server.server_close()
        self.provider_thread.join(5)
        for server, thread in self.additional_servers:
            server.shutdown()
            server.server_close()
            thread.join(5)
        write_json(self.private / "backend.json", self.requests)

    def close_tenant(self) -> None:
        """Observe close tenant for the acceptance fixture."""
        if not self.tenant_closed:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(5)
            self.tenant_closed = True


PLUGIN_FIXTURE = """import fs from 'node:fs';
export default function fixture(pi) {
  const keys = ['XCSH_API_URL', 'XCSH_API_TOKEN', 'XCSH_NAMESPACE', 'XCSH_USERNAME', 'XCSH_REGION', 'XCSH_STALE'];
  const original = new Map(keys.map(key => [key, process.env[key]]));
  process.on('exit', () => fs.writeFileSync(process.env.INSTALLED_E2E_PLUGIN_LOG + '.restored', JSON.stringify({
    environmentRestored: keys.every(key => process.env[key] === original.get(key))
  })));
  pi.integrations.register({
    id: 'context-fixture', name: 'Synthetic context fixture', plugin: 'context-fixture', kind: 'local',
    probe: async () => {
      fs.writeFileSync(process.env.INSTALLED_E2E_PLUGIN_LOG, JSON.stringify({
        namespace: process.env.XCSH_NAMESPACE,
        tokenMatches: process.env.XCSH_API_TOKEN === process.env.INSTALLED_E2E_PLUGIN_EXPECTED_TOKEN,
        loginAbsent: process.env.XCSH_USERNAME === undefined,
        regionAbsent: process.env.XCSH_REGION === undefined,
        timeout: process.env.XCSH_PLUGIN_GIT_TIMEOUT_MS
      }));
      if (process.env.INSTALLED_E2E_PLUGIN_FAIL === '1') throw new Error('Synthetic plugin failure');
      return {state: 'ready'};
    }
  });
}
"""


def messages_in(profile: pathlib.Path) -> list[Json]:
    """Read complete persisted messages while a session writer may still be active."""
    records = []
    for file in sorted((profile / "sessions").glob("**/*.jsonl")):
        data = file.read_bytes()
        # A partial writer record is not completion evidence. Retry until its newline appears.
        for line in data.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                continue
            record = json.loads(line)
            if record.get("type") == "message":
                records.append(record["message"])
    return records


def persisted_entries(profile: pathlib.Path) -> list[Json]:
    """Read all persisted session entries after a completed message."""
    return [
        json.loads(line)
        for file in sorted((profile / "sessions").glob("**/*.jsonl"))
        for line in file.read_text().splitlines()
    ]


def observe_profile(
    profile: pathlib.Path,
    contexts: pathlib.Path,
    pointer: pathlib.Path,
    saved: dict[str, bytes],
    expected_pointer: bytes | None,
    fixture: Fixture,
) -> Json:
    """Recheck saved bytes, transcript completeness and the recorded fallback sentinel."""
    files = sorted((profile / "sessions").glob("**/*.jsonl"))
    complete = bool(files) and all(file.read_bytes().endswith(b"\n") for file in files)
    thoughts = [
        entry.get("thinkingLevel")
        for entry in persisted_entries(profile)
        if entry.get("type") == "thinking_level_change"
    ]
    actual = {p.name: p.read_bytes() for p in contexts.glob("*.json")}
    return {
        "savedProfilesUnchanged": actual == saved,
        "startupPointerUnchanged": (pointer.read_bytes() if pointer.exists() else None)
        == expected_pointer,
        "externalRgExecutions": len(
            (profile / "external-rg.log").read_text().splitlines()
        )
        if (profile / "external-rg.log").exists()
        else 0,
        "evidenceComplete": complete,
        "inheritedFallbackUnused": not any(
            r.get("endpoint") == "inherited" for r in fixture.requests
        ),
        "thinkingLevel": thoughts[-1] if thoughts else None,
    }


def bang_command(terminal: Terminal, command: str, expected_output: str) -> None:
    """Observe non-echoed output now and retain obligations for lazy session persistence."""
    terminal.send("! " + command + "\r")
    terminal.wait(lambda: expected_output in terminal.screen.text(), "bang-output")
    terminal.settle()
    terminal.capture("bang-command")
    terminal.bang_obligations.append((command, expected_output))


def make_profile(
    private: pathlib.Path,
    fixture: Fixture,
    executable: pathlib.Path,
    backend: str,
    tls: pathlib.Path,
    token: str | None,
) -> tuple[pathlib.Path, pathlib.Path, dict[str, str], list[str]]:
    """Create a disposable profile containing only synthetic F5 configuration."""
    profile = private / "profile"
    agent = profile / "config/agent"
    cwd = profile / "project"
    for directory in (
        agent,
        cwd,
        profile / "sessions",
        profile / "bin",
        profile / "xdg-config/xcsh/contexts",
    ):
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    write_json(
        agent / "config.yml",
        {
            "startup": {"checkUpdate": False},
            "marketplace": {"autoUpdate": "off"},
            "memories": {"enabled": False},
            "theme": {"forceSlot": "dark"},
            "symbolPreset": "ascii",
        },
    )
    contexts = profile / "xdg-config/xcsh/contexts"
    for name in (
        ("context-a",)
        if fixture.scenario == "automatic-startup"
        else ("context-a", "context-b")
    ):
        values = {
            "name": name,
            "apiUrl": fixture.urls[name],
            "apiToken": fixture.tokens[name],
            "defaultNamespace": "example-old" if name == "context-a" else "example-b",
        }
        if name == "context-a":
            values["env"] = {"XCSH_REGION": "region-a"}
        if fixture.scenario == "missing-token" and name == "context-b":
            values.pop("apiToken")
        write_json(contexts / (name + ".json"), values)
    pointer = contexts.parent / "active_context"
    if (
        not fixture.scenario.startswith("environment")
        and fixture.scenario != "no-context"
    ):
        pointer.write_text("context-a")
    env = {
        "PATH": str(profile / "bin") + ":" + os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(profile),
        "TERM": "xterm-256color",
        "LANG": "C.UTF-8",
        "PI_CODING_AGENT_DIR": str(agent),
        "PI_CONFIG_DIR": "config",
        "TMPDIR": str(profile),
        "NODE_EXTRA_CA_CERTS": str(tls / "certificate.pem"),
        "SHELL": "/bin/bash",
        "XCSH_API_URL": fixture.urls["inherited"],
        "XCSH_API_TOKEN": fixture.tokens["inherited"],
        "XCSH_NAMESPACE": "example-inherited",
        "XCSH_USERNAME": "synthetic-login",
        "XCSH_REGION": "inherited-region",
        "XCSH_STALE": "synthetic-stale",
        "XCSH_PLUGIN_GIT_TIMEOUT_MS": "1234",
        "XCSH_LOCALE": "en",
    }
    for kind in ("CONFIG", "CACHE", "DATA", "STATE"):
        env["XDG_" + kind + "_HOME"] = str(profile / ("xdg-" + kind.lower()))
    if fixture.scenario == "cached-shell":
        env.pop("XCSH_PLUGIN_GIT_TIMEOUT_MS")
    if fixture.scenario.startswith("environment"):
        env.update(
            XCSH_API_URL=fixture.urls["inherited"],
            XCSH_API_TOKEN=fixture.tokens["environment"],
            XCSH_NAMESPACE="example-env",
        )
        if fixture.scenario == "environment-missing-token":
            env.pop("XCSH_API_TOKEN")
        if fixture.scenario == "environment-name-guard":
            env["XCSH_CONTEXT_NAME"] = "context-a"
    elif fixture.scenario == "no-context":
        env = {k: v for k, v in env.items() if not k.startswith("XCSH_")}
    sentinel = profile / "bin/rg"
    sentinel.write_text(
        "#!/bin/sh\nprintf 'external rg invoked\\n' >> \"$HOME/external-rg.log\"\nexit 97\n"
    )
    sentinel.chmod(0o700)
    (cwd / "search.txt").write_text("needle " + fixture.search_marker + "\n")
    (cwd / "prime-marker.txt").write_text(fixture.cache_marker + "\n")
    args = [
        str(executable),
        "--no-extensions",
        "--no-skills",
        "--no-rules",
        "--no-lsp",
        "--no-mcp",
        "--no-title",
        "--no-memories",
        "--tools",
        "xcsh_context,xcsh_api,bash,grep",
        "--session-dir",
        str(profile / "sessions"),
    ]
    if pointer.exists() and fixture.scenario != "automatic-startup":
        args += ["--context", "context-a"]
    if backend == "deterministic":
        env["ANTHROPIC_API_KEY"] = "synthetic-provider-key"
        write_json(
            agent / "models.yml",
            {
                "providers": {
                    "anthropic": {
                        "baseUrl": fixture.provider_url,
                        "apiKey": "synthetic-provider-key",
                    }
                }
            },
        )
        args += ["--provider", "anthropic", "--model", "claude-sonnet-4-5"]
    else:
        env["OPENAI_CODEX_OAUTH_TOKEN"] = token
        args += [
            "--provider",
            "openai-codex",
            "--model",
            "gpt-6.1-sol",
            "--thinking",
            "high",
        ]
    return profile, cwd, env, args


def namespace_command(
    terminal: Terminal,
    fixture: Fixture,
    namespace: str = "default",
    guided: bool = False,
    manual: bool = False,
    cancel: bool = False,
) -> bool:
    """Drive a real explicit or guided namespace command and observe its immediate outcome."""
    terminal.settle()
    before = len(fixture.requests)
    provider_before = len(fixture.provider)
    terminal.send("/context namespace" + ("" if guided else " " + namespace) + "\r")
    if guided:
        terminal.wait(
            lambda: "Session namespace" in terminal.screen.text(), "namespace-selector"
        )
        terminal.capture("selector", required=("Session namespace",))
        if cancel:
            terminal.send("\x1b")
            terminal.wait(
                lambda: (
                    "Session namespace" not in terminal.screen.text()
                    and "127:example-old" in terminal.screen.text()
                ),
                "cancelled-selector",
            )
            terminal.capture(
                "cancelled",
                required=("127:example-old",),
                forbidden=("Session namespace",),
            )
            return (
                len(fixture.requests) == before
                and len(fixture.provider) == provider_before
            )
        if manual:
            terminal.send("\x1b[B\x1b[B\r")
            terminal.wait(
                lambda: "Applies to future turns" in terminal.screen.text(),
                "manual-namespace-input",
            )
            terminal.capture(
                "manual-input",
                required=("Session namespace", "Applies to future turns"),
            )
            terminal.send("\x01\x0b" + namespace + "\r")
        else:
            terminal.send("\r")
    terminal.wait(
        lambda: (
            "Namespace " + namespace in terminal.screen.text()
            and "127:" + namespace in terminal.screen.text()
        ),
        "namespace-border-feedback",
    )
    terminal.capture(
        "selected", required=("Namespace " + namespace, "127:" + namespace)
    )
    terminal.settle()
    return len(fixture.requests) == before and len(fixture.provider) == provider_before


def expected_for(scenario: str, fixture: Fixture) -> Json:
    """Create the scenario oracle independently of assistant completion text."""
    namespace, context, status = "default", "context-a", 200
    if scenario in ("cancelled", "nonexistent"):
        namespace = "example-old"
    if scenario in ("transition", "cached-shell"):
        namespace, context = "example-b", "context-b"
    if scenario.startswith("environment"):
        namespace, context = "example-env", None
    if scenario == "no-context":
        namespace, context, status = None, None, None
    if scenario in ("environment-name-guard", "environment-missing-token"):
        status = None
    if scenario in ("offline", "timeout", "refused"):
        status = 0
    if scenario.startswith("http-"):
        status = int(scenario.split("-")[1])
    search = scenario.startswith("search-")
    expected = {
        "tools": ["xcsh_context", "bash", "grep" if search else "xcsh_api"],
        "namespace": namespace,
        "context": context,
        "status": status,
        "markers": []
        if search or status != HTTPStatus.OK or scenario == "empty"
        else fixture.markers,
        "requestCount": 0
        if search or status is None or scenario in ("refused", "offline")
        else 2
        if status in (429, 503)
        else 1,
        "empty": scenario == "empty",
        "endpoint": "environment" if scenario.startswith("environment") else context,
    }
    if search:
        expected.update(
            grep=scenario[7:],
            searchMarker=fixture.search_marker,
            grepPattern="needle"
            if scenario == "search-match"
            else "absent-pattern"
            if scenario == "search-no-match"
            else "[",
            grepPath="search.txt",
        )
    if scenario == "environment-name-guard":
        expected["guard"] = "context-a"
    if scenario.startswith("plugin-"):
        expected["plugin"] = True
    if scenario in ("cached-shell", "override"):
        expected["bang"] = True
    if scenario == "missing-token":
        expected["invalidProfile"] = True
    if scenario in ("auth-error", "offline"):
        expected["authStatus"] = "auth_error"
    if scenario == "timeout":
        expected["backendStatuses"] = [None]
    if context:
        expected["shellValues"] = [
            "NS=" + namespace,
            "LOGIN=unset",
            "STALE=unset",
            "TIMEOUT=1234",
            "REGION=" + ("region-a" if context == "context-a" else "unset"),
        ]
    if not search and status is not None:
        endpoint = (
            fixture.urls["inherited"]
            if scenario.startswith("environment")
            else fixture.urls[context]
        )
        expected["url"] = endpoint + API_PATH.replace("{namespace}", namespace)
    if scenario == "timeout":
        expected["timeout"] = True
    return expected


def run_scenario(
    executable: pathlib.Path,
    output: pathlib.Path,
    backend: str,
    scenario: str,
    repetition: int,
    fingerprint: Json,
    tls: pathlib.Path,
    *,
    token: str | None,
) -> Json:
    """Preserve and judge one fresh profile without retrying a failed candidate."""
    run_name = scenario + "-" + str(repetition)
    private = output / "private" / run_name
    private.mkdir(parents=True, mode=0o700)
    fixture = Fixture(private, tls, scenario)
    terminal = None
    receipt = dict(
        fingerprint,
        backend=backend,
        scenario=scenario,
        repetition=repetition,
        result="fail",
    )
    observations = {
        "savedProfilesUnchanged": False,
        "startupPointerUnchanged": False,
        "selectionFeedback": False,
        "selectionBorder": False,
        "selectionNetworkFree": True,
        "externalRgExecutions": 0,
        "evidenceComplete": False,
    }
    try:
        profile, cwd, env, args = make_profile(
            private, fixture, executable, backend, tls, token
        )
        contexts = profile / "xdg-config/xcsh/contexts"
        pointer = contexts.parent / "active_context"
        saved = {p.name: p.read_bytes() for p in contexts.glob("*.json")}
        original_pointer = pointer.read_bytes() if pointer.exists() else None
        write_json(
            private / "persistence-before.json",
            {
                "profiles": {
                    name: base64.b64encode(value).decode()
                    for name, value in saved.items()
                },
                "pointer": base64.b64encode(original_pointer).decode()
                if original_pointer is not None
                else None,
            },
        )
        terminal = Terminal(args, env, cwd, private)
        terminal.wait(lambda: "\x1b[?2004h" in terminal.raw, "input-handler")
        if original_pointer:
            terminal.wait(
                lambda: "127:example-old" in terminal.screen.text(), "startup-context"
            )
        terminal.settle(1.5)
        startup_text = (
            ("127:example-old",)
            if original_pointer
            else ("127:example-env",)
            if scenario.startswith("environment")
            else ()
        )
        terminal.capture("startup", required=startup_text)
        selection_start = len(fixture.requests)
        if scenario == "offline":
            fixture.close_tenant()
        if scenario in ("transition", "cached-shell"):
            if scenario == "cached-shell":
                bang_command(
                    terminal,
                    "export XCSH_STALE=cached-stale XCSH_REGION=cached-region XCSH_PLUGIN_GIT_TIMEOUT_MS=1234; cat prime-marker.txt",
                    fixture.cache_marker,
                )
            terminal.send("/context activate context-b\r")
            terminal.wait(
                lambda: "127:example-b" in terminal.screen.text(), "context-b-border"
            )
            terminal.capture(
                "context-b-selected", required=("127:example-b", "context-b")
            )
            terminal.settle(1)
            observations.update(
                selectionFeedback="Selected context-b" in terminal.raw,
                selectionBorder="127:example-b" in terminal.screen.text(),
            )
        elif scenario.startswith("environment") or scenario == "no-context":
            if scenario == "no-context":
                terminal.send("/context namespace default\r")
                terminal.wait(
                    lambda: "No active context" in terminal.screen.text(),
                    "no-context-rejection",
                )
                observations.update(
                    selectionFeedback=True,
                    selectionBorder="127:" not in terminal.screen.text(),
                )
                terminal.capture(
                    "no-context-rejection",
                    required=("No active context",),
                    forbidden=("Unhandled Rejection",),
                )
            else:
                observations.update(
                    selectionFeedback=True,
                    selectionBorder="127:example-env" in terminal.screen.text(),
                )
        elif scenario == "nonexistent":
            terminal.send("/context activate nonexistent-fixture\r")
            terminal.wait(
                lambda: "not found" in terminal.screen.text().lower(),
                "nonexistent-rejection",
            )
            observations.update(
                selectionFeedback=True,
                selectionBorder="127:example-old" in terminal.screen.text(),
            )
            terminal.capture(
                "nonexistent-rejection", required=("not found", "127:example-old")
            )
            if pointer.read_bytes() != original_pointer:
                fail("nonexistent activation changed selection")
        elif not scenario.startswith("admitted-"):
            observations["selectionNetworkFree"] = namespace_command(
                terminal,
                fixture,
                guided=scenario in ("guided", "guided-manual", "cancelled"),
                manual=scenario == "guided-manual",
                cancel=scenario == "cancelled",
            )
            observations.update(
                selectionFeedback=True,
                selectionBorder=(
                    "127:example-old" if scenario == "cancelled" else "127:default"
                )
                in terminal.screen.text(),
            )
            if scenario == "repeated":
                observations["selectionNetworkFree"] &= namespace_command(
                    terminal, fixture
                )
        if scenario == "missing-token":
            before_invalid = len(fixture.requests)
            terminal.send("/context activate context-b\r")
            terminal.wait(
                lambda: "not found or invalid" in terminal.screen.text(),
                "invalid-required-profile",
            )
            observations["requiredProfileRejected"] = (
                "127:default" in terminal.screen.text()
                and pointer.read_bytes() == original_pointer
            )
            observations["selectionNetworkFree"] &= (
                len(fixture.requests) == before_invalid
            )
            terminal.capture(
                "invalid-required-profile",
                required=("not found or invalid", "127:default"),
            )
        if scenario in ("nonexistent", "no-context"):
            observations["selectionNetworkFree"] = (
                len(fixture.requests) == selection_start
            )
        if scenario == "refused":
            # A listener is actually removed; a fake HTTP status cannot prove connection refusal.
            fixture.close_tenant()
        if scenario.startswith("plugin-"):
            extension = profile / "config/agent/extensions/context-fixture.js"
            extension.parent.mkdir(mode=0o700)
            extension.write_text(PLUGIN_FIXTURE)
            plugin_log = private / "plugin-context.json"
            child_env = dict(
                env,
                INSTALLED_E2E_PLUGIN_LOG=str(plugin_log),
                INSTALLED_E2E_PLUGIN_EXPECTED_TOKEN=fixture.tokens["context-b"],
                INSTALLED_E2E_PLUGIN_FAIL="1" if scenario == "plugin-failure" else "0",
            )
            child_env.pop("OPENAI_CODEX_OAUTH_TOKEN", None)
            child = subprocess.run(  # noqa: S603 - validated CLI path and task-owned fixture argv, no shell
                [
                    str(executable),
                    "plugin",
                    "status",
                    "context-fixture",
                    "--context",
                    "context-b",
                    "--json",
                ],
                env=child_env,
                cwd=cwd,
                capture_output=True,
                check=False,
                timeout=30,
            )
            (private / "plugin.stdout").write_bytes(child.stdout)
            (private / "plugin.stderr").write_bytes(child.stderr)
            if child.returncode:
                fail("plugin fixture command did not run")
            actual = json.loads(plugin_log.read_text())
            observations["pluginEnvironmentRestored"] = (
                json.loads(
                    plugin_log.with_name(plugin_log.name + ".restored").read_text()
                ).get("environmentRestored")
                is True
            )
            observations["pluginEffectiveContext"] = actual == {
                "namespace": "example-b",
                "tokenMatches": True,
                "loginAbsent": True,
                "regionAbsent": True,
                "timeout": "1234",
            }
            states = json.loads(child.stdout)["integrations"]
            if len(states) != 1 or states[0]["state"] != (
                "error" if scenario == "plugin-failure" else "ready"
            ):
                fail("plugin success/failure was not observed")
            terminal.settle()
            terminal.capture("after-plugin-child")
            observations["parentContextPreserved"] = (
                "127:default" in terminal.screen.text()
            )
        if scenario == "override":
            bang_command(
                terminal,
                "XCSH_NAMESPACE=command-override sh -c 'printf OVERRIDE=%s \"$XCSH_NAMESPACE\"'",
                "OVERRIDE=command-override",
            )
        start = len(messages_in(profile))
        network_start = len(fixture.requests)
        prompt = PROMPT
        if scenario.startswith("search-"):
            pattern = (
                "needle"
                if scenario == "search-match"
                else "absent-pattern"
                if scenario == "search-no-match"
                else "["
            )
            prompt = (
                "Inspect current context with xcsh_context status. Use bash with exactly this command: "
                + SHELL_COMMAND
                + "\n"
                "Use the native grep tool with path exactly search.txt and pattern exactly "
                + json.dumps(pattern)
                + ". Return only one JSON object with namespace, outcome (match, no-match or invalid), "
                "and matchingContent (the exact file line content for match, or an empty string)."
            )
            child = subprocess.run(  # noqa: S603 - validated CLI path and task-owned fixture argv, no shell
                [str(executable), "grep", pattern, "search.txt"],
                env=env,
                cwd=cwd,
                capture_output=True,
                check=False,
                timeout=30,
            )
            (private / "cli-search.stdout").write_bytes(child.stdout)
            (private / "cli-search.stderr").write_bytes(child.stderr)
            if child.returncode != (1 if scenario == "search-invalid" else 0):
                fail("CLI native search exit status differs")
            if (
                scenario == "search-match"
                and fixture.search_marker.encode() not in child.stdout
            ):
                fail("CLI native search missed fixture")
            if (
                scenario == "search-no-match"
                and fixture.search_marker.encode() in child.stdout
            ):
                fail("CLI native search invented match")
            if scenario == "search-invalid" and child.returncode == 0:
                fail("CLI accepted invalid regex")
            if scenario == "search-invalid" and not re.search(
                rb"regex|pattern|parse", child.stderr, re.IGNORECASE
            ):
                fail("CLI did not report a pattern diagnostic")
            if scenario != "search-invalid" and not re.search(
                rb"Total matches:\s*"
                + (b"1" if scenario == "search-match" else b"0")
                + rb"\b",
                child.stdout,
            ):
                fail("CLI native match count differs")
        if scenario == "environment-name-guard":
            prompt += " Guard the API call for saved context context-a."
        if any(
            marker in prompt for marker in [*fixture.markers, fixture.search_marker]
        ):
            fail("oracle marker leaked into prompt")
        terminal.send(prompt + "\r")
        if scenario.startswith("admitted-"):
            terminal.wait(fixture.gated.is_set, "admitted-a-request", seconds=120)
            if scenario == "admitted-context":
                terminal.send("/context activate context-b\r")
                terminal.wait(
                    lambda: "127:example-b" in terminal.screen.text(),
                    "b-border-during-a",
                )
            else:
                observations["selectionNetworkFree"] = namespace_command(
                    terminal, fixture
                )
            terminal.capture(
                "b-selected-a-running",
                required=(
                    "127:example-b"
                    if scenario == "admitted-context"
                    else "127:default",
                ),
            )
            observations.update(selectionFeedback=True, selectionBorder=True)
            fixture.release.set()

        def completed() -> bool:
            """Observe completed for the acceptance fixture."""
            messages = messages_in(profile)[start:]
            return (
                bool(messages)
                and messages[-1].get("role") == "assistant"
                and messages[-1].get("stopReason")
                in ("stop", "error", "aborted", "length")
            )

        terminal.wait(completed, "completed-agent-turn", seconds=180)
        terminal.settle()
        final_namespace = (
            "example-b"
            if scenario in ("transition", "cached-shell", "admitted-context")
            else "example-old"
            if scenario in ("cancelled", "nonexistent")
            else "example-env"
            if scenario.startswith("environment")
            else None
            if scenario == "no-context"
            else "default"
        )
        terminal.capture(
            "completion",
            required=("127:" + final_namespace,) if final_namespace else (),
            forbidden=("Unhandled Rejection",),
        )
        messages = messages_in(profile)[start:]
        observations.update(
            observe_profile(
                profile, contexts, pointer, saved, original_pointer, fixture
            )
        )
        observations["credentialNotRecorded"] = credential_is_absent(private, token)
        observations["bangCommandsCompleted"] = all(
            any(
                m.get("role") == "bashExecution"
                and m.get("command", "").strip() == command.strip()
                and m.get("exitCode") == 0
                and not m.get("cancelled")
                and not m.get("truncated")
                and marker in m.get("output", "")
                for m in messages_in(profile)
            )
            for command, marker in terminal.bang_obligations
        )
        evaluations = []
        expected = expected_for(scenario, fixture)
        requests = fixture.requests[network_start:]
        # Environment authority is deliberately distinct from saved-context identity.
        requests = [
            dict(r, context=None) if r["context"] == "environment" else r
            for r in requests
        ]
        if scenario.startswith("admitted-"):
            expected.update(
                namespace="example-old",
                context="context-a",
                shellValues=["NS=example-old"],
                requestCount=2,
                backendStatuses=[503, 200],
                url=fixture.urls["context-a"]
                + API_PATH.replace("{namespace}", "example-old"),
            )
            requests = [r for r in requests if "/http_loadbalancers" in r["path"]]
        if scenario in NEGATIVE_SCENARIOS:
            rejected = False
            try:
                validate_evidence(receipt, messages, requests, expected, observations)
            except AcceptanceError as error:
                intended = (
                    "required tool did not execute: xcsh_context"
                    if scenario == "provider-missing-tool"
                    else "incomplete assistant turn"
                )
                rejected = str(error) == intended
            if not rejected or not fixture.provider:
                fail("provider fault was not independently rejected")
            fault = scenario.removeprefix("provider-")
            if (
                fault not in fixture.provider_faults
                or any(
                    c.get("type") == "toolCall"
                    for m in messages
                    if m.get("role") == "assistant"
                    for c in m.get("content", [])
                )
                or requests
            ):
                fail("negative provider control executed unintended work")
            if (
                scenario != "provider-missing-tool"
                and messages[-1].get("stopReason") != "error"
            ):
                fail("provider transport fault did not report failure")
            receipt.update(result="pass", agentOutcome="rejected", negativeControl=True)
        else:
            evaluations.append((messages, requests, expected))
            receipt.update(
                validate_evidence(receipt, messages, requests, expected, observations)
            )
        if scenario.startswith("admitted-"):
            start = len(messages_in(profile))
            network_start = len(fixture.requests)
            terminal.send(PROMPT + "\r")
            terminal.wait(completed, "completed-b-turn", seconds=180)
            terminal.settle()
            terminal.capture(
                "b-completion",
                required=(
                    "127:example-b"
                    if scenario == "admitted-context"
                    else "127:default",
                ),
            )
            expected = expected_for(
                "transition" if scenario == "admitted-context" else "explicit", fixture
            )
            observations.update(
                observe_profile(
                    profile, contexts, pointer, saved, original_pointer, fixture
                )
            )
            second_messages = messages_in(profile)[start:]
            second_requests = fixture.requests[network_start:]
            evaluations.append((second_messages, second_requests, expected))
            second = validate_evidence(
                receipt,
                second_messages,
                second_requests,
                expected,
                observations,
            )
            receipt["subsequentAdmission"] = second
        terminal.close()
        terminal = None
        fixture.close()
        observations.update(
            observe_profile(
                profile, contexts, pointer, saved, original_pointer, fixture
            )
        )
        observations["credentialNotRecorded"] = credential_is_absent(private, token)
        for batch, transport, oracle in evaluations:
            validate_evidence(receipt, batch, transport, oracle, observations)
        write_json(
            private / "persistence-after.json",
            {
                "profiles": {
                    p.name: base64.b64encode(p.read_bytes()).decode()
                    for p in contexts.glob("*.json")
                },
                "pointer": base64.b64encode(pointer.read_bytes()).decode()
                if pointer.exists()
                else None,
            },
        )
        write_json(private / "observations.json", observations)
        receipt["observations"] = observations
    except (
        AcceptanceError,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
    ) as error:
        # Exception text may contain private provider/network data. Public output is categorical.
        (private / "failure.txt").write_text(
            type(error).__name__ + ": " + str(error) + "\n"
        )
        receipt.update(
            result="fail", failure="acceptance evidence incomplete or disagreed"
        )
    finally:
        if terminal:
            terminal.close()
        fixture.close()
        observations["credentialNotRecorded"] = credential_is_absent(private, token)
        if not observations["credentialNotRecorded"]:
            receipt.update(result="fail", failure="credential privacy gate failed")
        receipt["observations"] = observations
        receipt["evidence"] = {
            str(p.relative_to(private)): digest(p)
            for p in private.rglob("*")
            if observations["credentialNotRecorded"]
            and p.is_file()
            and (
                "profile" not in p.relative_to(private).parts
                or "sessions" in p.relative_to(private).parts
            )
        }
        write_json(output / "receipts" / (run_name + ".json"), receipt)
    return receipt


def credential_is_absent(root: pathlib.Path, token: str | None) -> bool:
    """Check all private bytes and paths, including WAL and exit-time writes."""
    if not token:
        return True
    needle = token.encode()
    for path in root.rglob("*"):
        if needle in str(path.relative_to(root)).encode():
            return False
        if not path.is_file():
            continue
        tail = b""
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                window = tail + block
                if needle in window:
                    return False
                tail = window[-(len(needle) - 1) :] if len(needle) > 1 else b""
    return True


def load_enabled_credential(database: pathlib.Path) -> str:
    """Read exactly one enabled subscription credential without copying its store."""
    try:
        with contextlib.closing(
            sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
        ) as connection:
            rows = connection.execute(
                "SELECT data FROM auth_credentials WHERE provider = ? AND credential_type = ? AND disabled_cause IS NULL",
                ("openai-codex", "oauth"),
            ).fetchall()
        valid = []
        for row in rows:
            token = json.loads(row[0]).get("access")
            try:
                check_live_token(token)
            except AcceptanceError:
                continue
            valid.append(token)
    except (sqlite3.Error, ValueError, OSError) as error:
        fail("enabled subscription credential store could not be read", cause=error)
    if len(valid) != 1:
        fail("exactly one valid enabled openai-codex credential is required")
    return valid[0]


def check_live_token(token: str | None) -> None:
    """Check the in-memory enabled credential without emitting or persisting it."""
    if not token:
        fail("OPENAI_CODEX_OAUTH_TOKEN is required through the child environment")
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        if payload.get("exp", 0) < time.time() + 600:
            fail("enabled live credential has expired")
        if not payload.get("https://api.openai.com/auth", {}).get("chatgpt_account_id"):
            fail("enabled live credential has no account identity")
    except (
        AcceptanceError,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
    ) as error:
        fail("enabled live credential is invalid or expires too soon", cause=error)


def main() -> int:
    """Run selected scenarios against one fingerprinted executable."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--backend", required=True, choices=("deterministic", "live"))
    parser.add_argument("--scenario", action="append", choices=SCENARIOS)
    parser.add_argument(
        "--credential-store",
        type=pathlib.Path,
        help="read-only store for one enabled live subscription credential",
    )
    parser.add_argument(
        "--artifact-origin",
        choices=("published", "local-build", "unverified"),
        default="unverified",
    )
    args = parser.parse_args()
    if not args.executable.is_absolute() or not os.access(args.executable, os.X_OK):
        parser.error("--executable must be an absolute executable path")
    if args.output.exists():
        parser.error("--output must be a new directory; retain failed runs")
    with args.executable.open("rb") as binary:
        if binary.read(4) not in (
            b"\x7fELF",
            b"\xcf\xfa\xed\xfe",
            b"\xfe\xed\xfa\xcf",
            b"\xca\xfe\xba\xbe",
            b"\xbe\xba\xfe\xca",
        ):
            parser.error("--executable must be the actual ELF or Mach-O executable")
    os.umask(0o077)
    args.output.mkdir(parents=True, mode=0o700)
    (args.output / "receipts").mkdir()
    (args.output / "private").mkdir()
    version = subprocess.run(  # noqa: S603 - validated actual executable path, no shell
        [str(args.executable), "--version"],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    ).stdout.strip()
    fingerprint = {
        "executable": str(args.executable.resolve()),
        "version": version,
        "sha256": digest(args.executable),
        "host": platform.node(),
        "platform": platform.system(),
        "architecture": platform.machine(),
        "artifactOrigin": args.artifact_origin,
    }
    token = (
        os.environ.get("OPENAI_CODEX_OAUTH_TOKEN") if args.backend == "live" else None
    )
    if args.backend == "live":
        if args.credential_store:
            if token:
                fail("choose one in-memory credential source")
            token = load_enabled_credential(args.credential_store)
        check_live_token(token)
    tls = args.output / "private/tls"
    tls.mkdir()
    openssl = shutil.which("openssl")
    if openssl is None:
        fail("openssl is required for loopback TLS fixtures")
    result = subprocess.run(  # noqa: S603 - resolved OpenSSL path and fixed fixture arguments, no shell
        [
            openssl,
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-keyout",
            str(tls / "key.pem"),
            "-out",
            str(tls / "certificate.pem"),
            "-subj",
            "/CN=127.0.0.1",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode:
        fail("loopback TLS fixture certificate generation failed")
    selected = [
        s
        for s in (args.scenario or SCENARIOS)
        if args.backend != "live" or s not in NEGATIVE_SCENARIOS
    ]
    if len(set(selected)) != len(selected) or not selected:
        parser.error("select distinct scenarios supported by this backend")
    receipts = []
    for scenario in selected:
        if args.backend == "live" and scenario in NEGATIVE_SCENARIOS:
            continue
        for repetition in range(1, 3 if args.backend == "live" else 2):
            receipt = run_scenario(
                args.executable,
                args.output,
                args.backend,
                scenario,
                repetition,
                fingerprint,
                tls,
                token=token,
            )
            receipts.append(receipt)
            print(
                scenario + " " + str(repetition) + ": " + receipt["result"], flush=True
            )
            if receipt["result"] != "pass":
                break
    passed = bool(receipts) and all(r["result"] == "pass" for r in receipts)
    write_json(
        args.output / "receipts/summary.json",
        {
            "result": "pass" if passed else "fail",
            "backend": args.backend,
            "scenarios": selected,
            "runs": len(receipts),
            "requiredConsecutivePasses": 2 if args.backend == "live" else 1,
            "fingerprint": fingerprint,
            "completeMatrix": set(selected)
            == set(
                SCENARIOS
                if args.backend == "deterministic"
                else [s for s in SCENARIOS if s not in NEGATIVE_SCENARIOS]
            ),
        },
    )
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
