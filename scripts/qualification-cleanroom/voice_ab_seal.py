"""Seal ordered private lifecycle evidence, retaining incomplete captures explicitly."""

from __future__ import annotations

import argparse
import collections
import datetime
import hashlib
import json
import pathlib
import re
import subprocess
from types import SimpleNamespace
from typing import Any

from qualification_exec import command_output


def digest(path: Any) -> Any:
    """Perform digest."""
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def recording(path: Any) -> Any:
    """Perform recording."""
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    complete = bool(
        rows
        and rows[0].get("stage") == "collector_armed"
        and rows[-1].get("stage") == "collector_footer"
        and rows[-1].get("complete") is True
        and [r.get("sequence") for r in rows] == list(range(1, len(rows) + 1))
    )
    return rows, {
        "path": str(path),
        "sha256": digest(path),
        "complete": complete,
        "armedAtUnixNs": rows[0].get("atUnixNs") if rows else None,
    }


def unix_ns(value: Any) -> Any:
    """Perform unix ns."""
    if not isinstance(value, str):
        return None
    try:
        return int(datetime.datetime.fromisoformat(value).timestamp() * 1000000000)
    except ValueError:
        return None


def seal(directory: Any) -> Any:
    """Perform seal."""
    capture_state = SimpleNamespace()
    directory = pathlib.Path(directory)
    capture_state.result = json.loads((directory / "result.private.json").read_text())
    capture_state.timeline = []
    capture_state.captures = {}
    capture_state.limitations = []

    capture_state.life, capture_state.captures["lifecycle"] = recording(
        directory / "lifecycle.private.jsonl"
    )
    capture_state.rpc, capture_state.captures["rpc"] = recording(
        directory / "rpc.private.jsonl"
    )
    capture_state.primary, capture_state.captures["primary"] = recording(
        directory / "primary.private.jsonl"
    )
    capture_state.media, capture_state.captures["media"] = recording(
        directory / "media.private.jsonl"
    )
    capture_state.candidate = capture_state.result.get("candidate")
    if capture_state.candidate is None:
        read_xcsh_trace(capture_state, directory)
    capture_state.candidate_verified = (
        digest(capture_state.candidate["executable"])
        == capture_state.candidate["sha256"]
    )
    capture_state.observed = []
    for _iteration_value in capture_state.rpc:
        capture_state.row = _iteration_value
        if capture_state.row["stage"] == "process_started":
            capture_state.observed.extend(
                p["executable"] for p in capture_state.row.get("processes", [])
            )
            if capture_state.row.get("executable"):
                capture_state.observed.append(capture_state.row["executable"])
    capture_state.candidate_verified = (
        capture_state.candidate_verified
        and capture_state.candidate["executable"] in capture_state.observed
    )
    capture_state.identities = {
        "thread": None,
        "call": None,
        "realtime": None,
        "productVoice": None,
        "serverSession": None,
    }
    normalize_lifecycle_and_rpc(capture_state)
    capture_state.errors = []
    capture_state.captions = []
    capture_state.sideband = []

    for _iteration_value in capture_state.primary:
        capture_state.row = _iteration_value
        if capture_state.row.get("event"):
            wire(
                capture_state,
                capture_state.row["event"],
                capture_state.row["atUnixNs"],
                "primary",
            )
    for _iteration_value in capture_state.media:
        capture_state.row = _iteration_value
        if capture_state.row["stage"] == "output_audio":
            event(
                capture_state,
                "output_audio",
                capture_state.row["atUnixNs"],
                "media",
                signalFrames=capture_state.row["signalFrames"],
            )
    normalize_backend_trace(capture_state, directory)
    capture_state.durable = []
    capture_state.tasks = []
    read_session_history(capture_state, directory)
    inspect_packet_layers(capture_state, directory)
    capture_state.timeline.sort(key=lambda row: (row["atUnixNs"], row["source"]))
    for _iteration_value in enumerate(capture_state.timeline, 1):
        capture_state.index, capture_state.row = _iteration_value
        capture_state.row["sequence"] = capture_state.index
    capture_state.terminal = (
        "local-provider-error"
        if capture_state.errors and capture_state.durable == ["failed"]
        else "local-request"
        if capture_state.durable == ["ended"]
        else "unverified"
    )
    capture_state.receipt = {
        "schemaVersion": 1,
        "directory": str(directory),
        "backend": capture_state.result["backend"],
        "candidate": capture_state.candidate,
        "candidateVerified": capture_state.candidate_verified,
        "identities": capture_state.identities,
        "creationInstructionsSha256": capture_state.result[
            "creationInstructionsSha256"
        ],
        "configuredInstructionsSha256": capture_state.result.get(
            "configuredInstructionsSha256"
        ),
        "startupAudio": capture_state.result["startupAudio"],
        "backendAdmissions": len(capture_state.tasks),
        "terminal": capture_state.terminal,
        "providerErrors": capture_state.errors,
        "captions": capture_state.captions,
        "sidebandEventTypes": dict(collections.Counter(capture_state.sideband)),
        "captures": capture_state.captures,
        "timeline": capture_state.timeline,
        "limitations": sorted(set(capture_state.limitations)),
        "productVoiceIdVisible": False,
        "physicalAcceptance": False,
        "rootCauseEstablishedForPhone": False,
    }
    capture_state.receipt["capturesComplete"] = (
        capture_state.candidate_verified
        and all(c["complete"] for c in capture_state.captures.values())
        and "sideband-packets-missing" not in capture_state.limitations
    )
    capture_state.receipt["normalizerSha256"] = digest(__file__)
    capture_state.receipt["inputReceiptSha256"] = digest(
        directory / "result.private.json"
    )
    capture_state.target = directory / (
        "normalized-lifecycle-"
        + capture_state.receipt["normalizerSha256"][:12]
        + ".private.json"
    )
    with capture_state.target.open("x") as capture_state.stream:
        capture_state.stream.write(json.dumps(capture_state.receipt, indent=2) + "\n")
    return capture_state.receipt


def normalize_lifecycle_and_rpc(capture_state: Any) -> None:
    """Retain lifecycle ownership and RPC admission and closure events."""
    for _iteration_value in capture_state.life:
        capture_state.row = _iteration_value
        capture_state.stage = capture_state.row["stage"]
        if capture_state.stage == "thread_created":
            capture_state.identities["thread"] = capture_state.row["threadId"]
        if capture_state.stage == "call_created":
            capture_state.identities["call"] = capture_state.row["callId"]
        if capture_state.stage in (
            "configuration_read",
            "thread_created",
            "prompt_selected",
            "call_created",
            "media_activated",
            "local_close_requested",
        ):
            event(
                capture_state,
                capture_state.stage,
                capture_state.row["atUnixNs"],
                "lifecycle",
            )
        if (
            capture_state.stage == "media_state"
            and capture_state.row.get("state") == "connected"
        ):
            event(
                capture_state,
                "media_active",
                capture_state.row["atUnixNs"],
                "lifecycle",
            )
    for _iteration_value in capture_state.rpc:
        capture_state.row = _iteration_value
        if capture_state.row.get("stage") == "rpc_sent":
            capture_state.params = capture_state.row.get("params", {})
            capture_state.nested = (
                capture_state.params.get("params", {})
                if capture_state.row.get("method") == "worker/sessionCall"
                else capture_state.params
            )
            if capture_state.nested.get("transport", {}).get("type") == "existingCall":
                capture_state.identities["realtime"] = capture_state.nested.get(
                    "realtimeSessionId"
                )
        capture_state.message = capture_state.row.get("message", {})
        capture_state.message = capture_state.message.get("params", {}).get(
            "event", capture_state.message
        )
        if capture_state.message.get("method") == "turn/started":
            event(
                capture_state, "backend_admitted", capture_state.row["atUnixNs"], "rpc"
            )
        if capture_state.message.get("method") == "thread/realtime/closed":
            event(
                capture_state,
                "local_terminal_notification",
                capture_state.row["atUnixNs"],
                "rpc",
                reason=capture_state.message.get("params", {}).get("reason"),
            )


def normalize_backend_trace(capture_state: Any, directory: Any) -> None:
    """Normalize the correct backend wire log and its limitations."""
    if capture_state.result["backend"] == "xcsh":
        read_xcsh_secondary_trace(capture_state, directory)
    else:
        capture_state.path = directory / "backend.private.log"
        capture_state.captures["stock-wire-log"] = {
            "path": str(capture_state.path),
            "sha256": digest(capture_state.path),
            "complete": capture_state.captures["rpc"]["complete"],
        }
        for _iteration_value in capture_state.path.read_text().splitlines():
            capture_state.raw_line = _iteration_value
            capture_state.line = re.sub(r"\x1b\[[0-9;]*m", "", capture_state.raw_line)
            capture_state.match = re.search(
                r"realtime websocket (event|request): (\{.*\})", capture_state.line
            )
            if not capture_state.match:
                continue
            try:
                capture_state.row = json.loads(capture_state.match[2])
            except ValueError:
                capture_state.limitations.append("stock-wire-json-incomplete")
                continue
            capture_state.at = unix_ns(capture_state.line.split()[0])
            capture_state.sideband.append(capture_state.row.get("type"))
            wire(
                capture_state,
                capture_state.row,
                capture_state.at,
                "sideband",
                "out" if capture_state.match[1] == "request" else "in",
            )
        capture_state.limitations.append("stock-upstream-event-sequence-not-exposed")


def event(capture_state: Any, stage: Any, at: Any, source: Any, **fields: Any) -> Any:
    """Perform event."""
    if at is not None:
        capture_state.timeline.append(
            {"stage": stage, "atUnixNs": at, "source": source, **fields}
        )


def read_xcsh_trace(capture_state: Any, directory: Any) -> None:
    """Normalize one retained evidence layer without changing acceptance rules."""
    if capture_state.result["backend"] == "xcsh":
        capture_state.candidate = json.loads(
            (directory.parent / "baseline.private.json").read_text()
        )["candidate"]
    else:
        capture_state.facts = json.loads(
            (directory.parent / "symbols.private.json").read_text()
        )
        capture_state.candidate = {
            "commit": capture_state.facts["sourceCommit"],
            "sha256": capture_state.facts["executableSha256"],
            "executable": str(
                directory.parent / "release-bin/codex-x86_64-unknown-linux-musl"
            ),
        }


def wire(
    capture_state: Any, row: Any, at: Any, source: Any, direction: Any = "in"
) -> Any:
    """Perform wire."""
    kind = row.get("type")
    if kind in ("session.started", "session.created"):
        event(
            capture_state,
            "sideband_upgraded" if source == "sideband" else "call_session_started",
            at,
            source,
        )
        if source == "primary":
            capture_state.identities["serverSession"] = row.get("session", {}).get("id")
    if kind == "session.context.append":
        event(capture_state, "context_sent", at, source, direction=direction)
    if kind == "session.context.appended":
        event(capture_state, "context_acknowledged", at, source)
    if kind == "session.input_audio.append":
        event(capture_state, "input_audio", at, source)
    if kind == "session.close":
        event(
            capture_state,
            "local_close_requested",
            at,
            source,
            reason="provider-error" if capture_state.errors else "local-request",
        )
    if kind == "session.closed":
        event(capture_state, "remote_session_closed", at, source)
    if kind == "error":
        error = row.get("error", {})
        item = {
            "type": error.get("type"),
            "code": error.get("code"),
            "param": error.get("param"),
            "messageSha256": hashlib.sha256(
                str(error.get("message", "")).encode()
            ).hexdigest(),
        }
        capture_state.errors.append(item)
        event(capture_state, "provider_error", at, source, **item)
    if kind in ("input_transcript.added", "output_transcript.added", "turn.done"):
        text = (
            row.get("item", {}).get("text")
            if kind != "turn.done"
            else row.get("turn", {}).get("transcript")
        )
        role = (
            ("user" if kind == "input_transcript.added" else "assistant")
            if kind != "turn.done"
            else row.get("turn", {}).get("role")
        )
        if isinstance(text, str):
            item = {
                "role": role,
                "textSha256": hashlib.sha256(text.encode()).hexdigest(),
                "textBytes": len(text.encode()),
            }
            capture_state.captions.append(item)
            event(capture_state, "caption", at, source, **item)


def read_xcsh_secondary_trace(capture_state: Any, directory: Any) -> None:
    """Normalize one retained evidence layer without changing acceptance rules."""
    capture_state.traces = list((directory / "traces").glob("voice-*.jsonl"))
    if not capture_state.traces:
        capture_state.limitations.append("sideband-trace-missing")
    for _iteration_value in capture_state.traces:
        capture_state.path = _iteration_value
        capture_state.rows = [
            json.loads(x) for x in capture_state.path.read_text().splitlines()
        ]
        capture_state.complete = (
            capture_state.rows[-1].get("kind") == "footer"
            and capture_state.rows[-1].get("complete") is True
        )
        capture_state.events = [
            x for x in capture_state.rows if x.get("kind") == "event"
        ]
        capture_state.complete = capture_state.complete and [
            x["sequence"] for x in capture_state.events
        ] == list(range(1, len(capture_state.events) + 1))
        capture_state.candidate_verified = (
            capture_state.candidate_verified
            and capture_state.rows[0].get("sourceCommit")
            == capture_state.candidate["commit"]
            and capture_state.rows[0].get("artifactSha256")
            == capture_state.candidate["sha256"]
        )
        capture_state.captures[capture_state.path.name] = {
            "path": str(capture_state.path),
            "sha256": digest(capture_state.path),
            "complete": capture_state.complete,
            "candidateCommit": capture_state.rows[0].get("sourceCommit"),
            "artifactSha256": capture_state.rows[0].get("artifactSha256"),
        }
        for _iteration_value in capture_state.events:
            capture_state.row = _iteration_value
            capture_state.at = int(
                (
                    capture_state.rows[0]["startedAtUnixMs"]
                    + capture_state.row["elapsedMs"]
                )
                * 1000000
            )
            capture_state.sideband.append(
                capture_state.row.get("message", {}).get("type")
            )
            wire(
                capture_state,
                capture_state.row.get("message", {}),
                capture_state.at,
                "sideband",
                capture_state.row.get("direction"),
            )
            if (
                capture_state.row.get("layer") == "connection"
                and capture_state.row.get("message", {}).get("type") == "closed"
            ):
                event(capture_state, "websocket_closed", capture_state.at, "sideband")


def read_session_history(capture_state: Any, directory: Any) -> None:
    """Normalize one retained evidence layer without changing acceptance rules."""
    for _iteration_value in (directory / "codex-home/sessions").rglob("*.jsonl"):
        capture_state.path = _iteration_value
        capture_state.rows = [
            json.loads(x) for x in capture_state.path.read_text().splitlines()
        ]
        capture_state.captures["durable-history-native"] = {
            "path": str(capture_state.path),
            "sha256": digest(capture_state.path),
            "complete": True,
        }
        for _iteration_value in capture_state.rows:
            capture_state.row = _iteration_value
            capture_state.data = capture_state.row.get("payload", {})
            capture_state.at = unix_ns(capture_state.row.get("timestamp"))
            if (
                capture_state.row.get("type") == "realtime_item"
                and capture_state.data.get("type") == "realtime_session_closed"
            ):
                capture_state.durable.append(capture_state.data.get("outcome"))
                event(
                    capture_state,
                    "durable_terminal",
                    capture_state.at,
                    "history",
                    outcome=capture_state.durable[-1],
                )
    for _iteration_value in (directory / "agent/sessions").rglob("*.jsonl"):
        capture_state.path = _iteration_value
        capture_state.rows = [
            json.loads(x) for x in capture_state.path.read_text().splitlines()
        ]
        capture_state.captures["durable-history"] = {
            "path": str(capture_state.path),
            "sha256": digest(capture_state.path),
            "complete": True,
        }
        for _iteration_value in capture_state.rows:
            capture_state.row = _iteration_value
            capture_state.data = capture_state.row.get("data", {})
            capture_state.at = unix_ns(capture_state.row.get("timestamp"))
            if (
                capture_state.data.get("kind") == "voiceTimeline"
                and capture_state.data.get("item", {}).get("type")
                == "realtimeSessionClosed"
            ):
                capture_state.durable.append(capture_state.data["item"].get("outcome"))
                event(
                    capture_state,
                    "durable_terminal",
                    capture_state.at,
                    "history",
                    outcome=capture_state.durable[-1],
                )
            if capture_state.data.get("kind") == "voiceTaskDelegation":
                capture_state.tasks.append(capture_state.data)
            if capture_state.data.get("kind") == "startupPolicyViolation":
                event(
                    capture_state,
                    "guard_decision",
                    capture_state.at,
                    "history",
                    reason=capture_state.data.get("reason"),
                )
    capture_state.path = directory / "history.private.json"
    if capture_state.path.exists():
        capture_state.captures["history-view"] = {
            "path": str(capture_state.path),
            "sha256": digest(capture_state.path),
            "complete": True,
        }
    else:
        capture_state.limitations.append("history-view-missing")


def inspect_packet_layers(capture_state: Any, directory: Any) -> None:
    """Normalize one retained evidence layer without changing acceptance rules."""
    for _iteration_value in (
        ("packets", "tunnels"),
        ("sidebandPackets", "sideband"),
    ):
        capture_state.key, capture_state.name = _iteration_value
        if capture_state.key not in capture_state.result:
            if capture_state.name == "sideband":
                capture_state.limitations.append("sideband-packets-missing")
            continue
        capture_state.capture = dict(capture_state.result[capture_state.key])
        capture_state.path = directory / (capture_state.name + ".private.pcap")
        capture_state.capture["path"] = str(capture_state.path)
        capture_state.capture["complete"] = (
            capture_state.capture["complete"]
            and digest(capture_state.path) == capture_state.capture["sha256"]
            and capture_state.capture["drops"] == 0
        )
        capture_state.lost = command_output(
            [
                "/usr/bin/tshark",
                "-r",
                str(capture_state.path),
                "-Y",
                "tcp.analysis.lost_segment",
                "-T",
                "fields",
                "-e",
                "frame.number",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        capture_state.capture["tcpSequenceGaps"] = len(capture_state.lost.splitlines())
        capture_state.capture["complete"] = (
            capture_state.capture["complete"] and not capture_state.lost.strip()
        )
        capture_state.captures[capture_state.name + "-packets"] = capture_state.capture


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("abba_receipt")
    args = parser.parse_args()
    rows = json.loads(pathlib.Path(args.abba_receipt).read_text())
    for row in rows:
        receipt = seal(row["directory"])
        print(
            json.dumps(
                {
                    k: receipt[k]
                    for k in (
                        "backend",
                        "directory",
                        "terminal",
                        "startupAudio",
                        "capturesComplete",
                        "limitations",
                    )
                }
            )
        )
