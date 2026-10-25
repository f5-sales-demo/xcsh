"""Read-only, session-aware voice evidence observer. Never submits or replays work."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time
from types import SimpleNamespace
from typing import Any

from qualification_exec import run_command

HEARTBEAT_SECONDS = 30


def sha(value: Any) -> Any:
    """Compute a SHA256 digest."""
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def visible(text: Any) -> Any:
    """Perform visible."""
    # Terminal display is concise and excludes personal address/token patterns.
    text = re.sub(r"[\w.+-]+@[\w.-]+", "[email]", text)
    text = re.sub(
        r"(?i)(bearer\s+|(?:token|password|secret)\s*[:=]\s*)\S+", r"\1[private]", text
    )
    return text[:1500]


def derive(history: Any) -> Any:
    """Keep call IDs, task owners, and transcript-only replies distinct."""
    sessions: dict[str, Any] = {}
    tasks: dict[str, Any] = {}
    delegation_sessions: dict[str, Any] = {}
    delegation_texts: dict[str, Any] = {}
    current_task: Any = None

    def session(ident: Any) -> Any:
        """Perform session."""
        return sessions.setdefault(
            ident,
            {"id": ident, "lifecycle": "observed", "transcripts": [], "taskIds": []},
        )

    def task(ident: Any) -> Any:
        """Perform task."""
        return tasks.setdefault(
            ident,
            {
                "id": ident,
                "status": "unknown",
                "admissions": [],
                "tools": [],
                "results": {},
                "final": [],
                "sessionId": None,
            },
        )

    for index, row in enumerate(history):
        data = row.get("data", {})
        current_task = apply_data(
            index,
            data,
            current_task,
            session,
            task,
            delegation_sessions,
            delegation_texts,
        )
        apply_message(row, current_task, task)
    # Failed startup speech can be retained only as a timeline segment.
    # Merge missing segments without duplicating canonical transcript records.
    for index, row in enumerate(history):
        data = row.get("data", {})
        value = data.get("item", {})
        if (
            data.get("kind") != "voiceTimeline"
            or value.get("type") != "transcriptSegment"
        ):
            continue
        ident, role, text = (
            value.get("realtimeSessionId"),
            value.get("role"),
            value.get("text"),
        )
        if not ident or role not in ("user", "assistant") or not isinstance(text, str):
            continue
        target = session(ident)["transcripts"]
        if not any(t["role"] == role and t["text"] == text for t in target):
            target.append(
                {
                    "index": index,
                    "role": role,
                    "text": text,
                    "sha256": sha(text),
                    "source": "timeline",
                }
            )
    for item in sessions.values():
        item["transcripts"].sort(key=lambda t: t["index"])
    for item in tasks.values():
        item["verifiedToolCount"] = sum(
            t["id"] in item["results"] and item["results"][t["id"]]["isError"] is False
            for t in item["tools"]
        )
        item["allToolsVerified"] = bool(item["tools"]) and item[
            "verifiedToolCount"
        ] == len(item["tools"])
        item["completionVerified"] = item["status"] == "completed"
    for item in sessions.values():
        summarize_session(item, tasks)
    return {
        "sessions": list(sessions.values()),
        "tasks": list(tasks.values()),
        "outstandingTaskIds": [
            t["id"] for t in tasks.values() if t["status"] == "running"
        ],
    }


def read_jsonl_prefix(path: Any) -> Any:
    """Ignore only a concurrently written final line; never hide an interior gap."""
    data = pathlib.Path(path).read_bytes()
    lines = data.splitlines(keepends=True)
    pending = bool(lines and not lines[-1].endswith(b"\n"))
    if pending:
        lines = lines[:-1]
    return (
        [json.loads(line) for line in lines],
        pending,
        hashlib.sha256(data).hexdigest(),
    )


def trace_state(path: Any, candidate: Any) -> Any:
    """Perform trace state."""
    rows, pending, digest = read_jsonl_prefix(path)
    if not rows:
        return {
            "path": str(path),
            "valid": False,
            "failures": ["manifest-missing"],
            "partialLine": pending,
        }
    failures = []
    if rows[0].get("kind") != "manifest":
        failures.append("manifest-missing")
    if (
        rows[0].get("sourceCommit") != candidate["commit"]
        or rows[0].get("artifactSha256") != candidate["sha256"]
    ):
        failures.append("candidate-mismatch")
    footer = rows[-1] if rows[-1].get("kind") == "footer" else None
    events = rows[1:-1] if footer else rows[1:]
    if any(
        r.get("kind") != "event" or r.get("sequence") != i + 1
        for i, r in enumerate(events)
    ):
        failures.append("sequence-gap")
    if footer and (not footer.get("complete") or footer.get("events") != len(events)):
        failures.append("invalid-footer")
    outgoing = [r for r in events if r.get("direction") == "out"]
    first_user = next(
        (
            r["sequence"]
            for r in events
            if r.get("message", {}).get("turn", {}).get("role") == "user"
        ),
        None,
    )
    return {
        "path": str(path),
        "sha256": digest,
        "valid": not failures,
        "failures": failures,
        "events": len(events),
        "complete": bool(footer and not failures and not pending),
        "partialLine": pending,
        "applicationSentEventTypes": sorted(
            {str(r.get("message", {}).get("type")) for r in outgoing}
        ),
        "applicationInputBeforeCaller": any(
            r.get("message", {}).get("type")
            in [
                "input_text.append",
                "session.input_text.append",
                "conversation.item.create",
                "response.create",
            ]
            and (first_user is None or r["sequence"] < first_user)
            for r in outgoing
        ),
    }


def report_herdr(config: Any, state: Any, sequence: Any) -> Any:
    """Only the observer's own inherited Herdr binding may report its owned pane."""
    binding = config.get("herdr", {})
    executable = binding.get("cli")
    pane = binding.get("nativePane")
    if not executable or not pane or os.environ.get("HERDR_ENV") != "1":
        return None
    status = "working" if state["outstandingTaskIds"] else "idle"
    args = [
        executable,
        "pane",
        "report-agent",
        pane,
        "--source",
        "voice-qualification-observer",
        "--agent",
        "xcsh",
        "--state",
        status,
        "--seq",
        str(sequence),
        "--message",
        "Observed durable task state; no task submitted by observer",
        "--agent-session-id",
        config["threadId"],
        "--agent-session-path",
        config["historyPath"],
    ]
    result = run_command(args, capture_output=True, text=True, timeout=10, check=False)
    return result.returncode


def observe(config: Any, once: Any = False) -> Any:
    """Perform observe."""
    capture_state = SimpleNamespace()
    capture_state.output = pathlib.Path(config["outputDirectory"])
    capture_state.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    capture_state.journal = capture_state.output / "observer-events.jsonl"
    capture_state.previous, capture_state.revision = None, 0
    capture_state.herdr_sequence = time.time_ns() // 1_000_000
    capture_state.heartbeat = 0.0
    capture_state.candidate = config["candidate"]
    capture_state.expected = capture_state.candidate["sha256"]
    if (
        hashlib.sha256(
            pathlib.Path(capture_state.candidate["executable"]).read_bytes()
        ).hexdigest()
        != capture_state.expected
    ):
        capture_state.message = "Pinned executable changed"
        raise ValueError(capture_state.message)
    print(
        json.dumps(
            {
                "observer": "ready",
                "threadId": config["threadId"],
                "automation": "transcripts,tools,outcomes,call IDs",
                "workSubmitted": False,
            }
        ),
        flush=True,
    )
    while True:
        try:
            capture_state.history, capture_state.pending, capture_state.history_hash = (
                read_jsonl_prefix(config["historyPath"])
            )
            state = derive(capture_state.history)
            capture_state.captures = [
                trace_state(p, capture_state.candidate)
                for directory in config["captureDirectories"]
                for p in sorted(pathlib.Path(directory).glob("*.jsonl"))
            ]
            # Private source text remains in original history. Receipts contain hashes
            # and execution facts; safe terminal text can be inspected through Herdr.
            capture_state.receipt_sessions = [
                dict(
                    s,
                    transcripts=[
                        {"index": t["index"], "role": t["role"], "sha256": t["sha256"]}
                        for t in s["transcripts"]
                    ],
                )
                for s in state["sessions"]
            ]
            capture_state.receipt_tasks = [
                dict(
                    t,
                    final=[sha(text) for text in t["final"]],
                    request=sha(t.get("request", "")),
                )
                for t in state["tasks"]
            ]
            capture_state.receipt = {
                "candidate": capture_state.candidate,
                "threadId": config["threadId"],
                "historySha256": capture_state.history_hash,
                "completeHistoryRecords": len(capture_state.history),
                "partialHistoryLine": capture_state.pending,
                "sessions": capture_state.receipt_sessions,
                "tasks": capture_state.receipt_tasks,
                "outstandingTaskIds": state["outstandingTaskIds"],
                "captures": capture_state.captures,
                "observationOnly": True,
                "noWorkSubmittedOrReplayed": True,
                "physicalAudioObserved": False,
                "physicalPhoneRenderingObserved": False,
                "acceptanceClaim": False,
            }
            # Checkpoints and unrelated host polls change file hashes continuously.
            # Emit progress only for new conversation/task state or integrity changes.
            capture_state.current = sha(
                {
                    "sessions": capture_state.receipt_sessions,
                    "tasks": capture_state.receipt_tasks,
                    "outstanding": state["outstandingTaskIds"],
                    "historyPartial": capture_state.pending,
                    "captures": [
                        {
                            "path": x["path"],
                            "valid": x["valid"],
                            "complete": x.get("complete"),
                            "failures": x["failures"],
                            "inputBeforeCaller": x.get("applicationInputBeforeCaller"),
                        }
                        for x in capture_state.captures
                    ],
                }
            )
            if capture_state.current != capture_state.previous:
                capture_state.revision += 1
                capture_state.receipt["revision"] = capture_state.revision
                capture_state.target = capture_state.output / "latest.json"
                capture_state.temporary = capture_state.output / "latest.tmp"
                capture_state.temporary.write_text(
                    json.dumps(capture_state.receipt, indent=2) + "\n"
                )
                capture_state.temporary.chmod(0o600)
                capture_state.temporary.replace(capture_state.target)
                with capture_state.journal.open("a") as capture_state.stream:
                    capture_state.stream.write(
                        json.dumps(
                            {
                                "revision": capture_state.revision,
                                "receiptSha256": sha(capture_state.receipt),
                                "atUnixMs": time.time_ns() // 1_000_000,
                            }
                        )
                        + "\n"
                    )
                capture_state.journal.chmod(0o600)
                print(
                    json.dumps(
                        {
                            "revision": capture_state.revision,
                            "sessions": [
                                {
                                    "id": s["id"],
                                    "lifecycle": s["lifecycle"],
                                    "tasks": len(s["taskIds"]),
                                    "startup": s["startupObservations"],
                                    "identityRequests": s["identityRequests"],
                                    "profileRequests": s["profileRequests"],
                                }
                                for s in state["sessions"]
                            ],
                            "tasks": [
                                {
                                    "id": t["id"],
                                    "status": t["status"],
                                    "tools": [x["name"] for x in t["tools"]],
                                    "verifiedTools": t["verifiedToolCount"],
                                }
                                for t in state["tasks"][-5:]
                            ],
                            "outstanding": state["outstandingTaskIds"],
                            "captureFailures": [
                                f for x in capture_state.captures for f in x["failures"]
                            ],
                        }
                    ),
                    flush=True,
                )
                for _iteration_value in state["sessions"][-2:]:
                    capture_state.session = _iteration_value
                    for _iteration_value in capture_state.session["transcripts"][-2:]:
                        capture_state.transcript = _iteration_value
                        print(
                            capture_state.session["id"][:8]
                            + " "
                            + capture_state.transcript["role"]
                            + ": "
                            + visible(capture_state.transcript["text"]),
                            flush=True,
                        )
                capture_state.previous = capture_state.current
                capture_state.herdr_sequence += 1
                try:
                    capture_state.code = report_herdr(
                        config, state, capture_state.herdr_sequence
                    )
                    if capture_state.code:
                        print(
                            json.dumps(
                                {
                                    "herdrReportFailed": capture_state.code,
                                    "noWorkReplay": True,
                                }
                            ),
                            flush=True,
                        )
                except (OSError, subprocess.TimeoutExpired):
                    print(
                        json.dumps(
                            {"herdrReportFailed": "unavailable", "noWorkReplay": True}
                        ),
                        flush=True,
                    )
        except (OSError, ValueError, KeyError) as error:
            # Recording failure affects evidence only. Keep observing; never launch,
            # cancel, or retry any application task as recovery.
            print(
                json.dumps(
                    {
                        "observerFailure": type(error).__name__,
                        "acceptanceClaim": False,
                        "noWorkReplay": True,
                    }
                ),
                flush=True,
            )
        if once:
            return
        if time.monotonic() - capture_state.heartbeat >= HEARTBEAT_SECONDS:
            print(
                json.dumps(
                    {
                        "observer": "watching",
                        "revision": capture_state.revision,
                        "atUnixMs": time.time_ns() // 1_000_000,
                    }
                ),
                flush=True,
            )
            capture_state.heartbeat = time.monotonic()
        time.sleep(1)


def apply_data(
    index: Any,
    data: Any,
    current_task: Any,
    session: Any,
    task: Any,
    delegation_sessions: Any,
    delegation_texts: Any,
) -> Any:
    """Classify retained history without changing its evidence ownership."""
    kind = data.get("kind")
    if kind == "voiceTimeline":
        item = data.get("item", {})
        ident = item.get("realtimeSessionId")
        if ident and item.get("type") in [
            "realtimeSessionStarted",
            "realtimeSessionClosed",
        ]:
            session(ident)["lifecycle"] = (
                "open" if item["type"] == "realtimeSessionStarted" else "closed"
            )
            session(ident)["outcome"] = item.get("outcome")
    elif kind == "voiceStartupAudioDiagnostic" and data.get("realtimeSessionId"):
        session(data["realtimeSessionId"])["startupAudio"] = {
            k: data[k]
            for k in ("frames", "signalFrames", "maxRms", "peak", "callerObserved")
        }
    elif kind == "transcript":
        ident = data.get("realtimeSessionId")
        if ident:
            session(ident)["transcripts"].append(
                {
                    "index": index,
                    "role": data["role"],
                    "text": data["text"],
                    "sha256": sha(data["text"]),
                }
            )
    elif kind == "delegation" and data.get("realtimeSessionId"):
        delegation_sessions[data["key"]] = data["realtimeSessionId"]
        if data.get("text"):
            delegation_texts[data["key"]] = data["text"]
    elif kind == "voiceTaskDelegation":
        ident = data["taskId"]
        owner = delegation_sessions.get(data["delegationId"])
        task(ident)["sessionId"] = owner
        task(ident)["revision"] = data.get("revision")
        task(ident)["request"] = delegation_texts.get(data["delegationId"], "")
        if owner and ident not in session(owner)["taskIds"]:
            session(owner)["taskIds"].append(ident)
    elif kind == "turnStarted":
        current_task = data["id"]
        task(current_task).update(status="running", startIndex=index)
    elif kind == "requestAccepted":
        current_task = data["turnId"]
        task(current_task)["admissions"].append(
            {
                "method": data["method"],
                "clientIdSha256": sha(data.get("clientUserMessageId")),
            }
        )
    elif kind == "turnCompleted":
        task(data["id"]).update(status=data["status"], endIndex=index)
        if current_task == data["id"]:
            current_task = None
    return current_task


def apply_message(row: Any, current_task: Any, task: Any) -> Any:
    """Classify retained history without changing its evidence ownership."""
    if row.get("type") == "message" and current_task:
        message = row["message"]
        target = task(current_task)
        if message.get("role") == "assistant":
            for part in message.get("content", []):
                if part.get("type") == "toolCall":
                    target["tools"].append(
                        {
                            "id": part["id"],
                            "name": part["name"],
                            "argumentsSha256": sha(part["arguments"]),
                        }
                    )
                elif part.get("type") == "text":
                    target["final"].append(part["text"])
        elif message.get("role") == "toolResult":
            target["results"][message["toolCallId"]] = {
                "isError": message.get("isError"),
                "sha256": sha(message),
            }
            if (
                message.get("toolName") in ["person_profile", "machine_profile"]
                and message.get("isError") is False
            ):
                text = "\n".join(
                    p.get("text", "")
                    for p in message.get("content", [])
                    if p.get("type") == "text"
                )
                try:
                    value = json.loads(text)
                except ValueError:
                    value = None
                if isinstance(value, dict):
                    target.setdefault("canonicalProfileResults", []).append(
                        {
                            "tool": message["toolName"],
                            "resultSha256": sha(value),
                            "state": value.get("state"),
                            "factsEmpty": value.get("facts") == {},
                        }
                    )


def summarize_session(item: Any, tasks: Any) -> Any:
    """Classify retained history without changing its evidence ownership."""
    transcripts = item["transcripts"]
    first_user = next(
        (i for i, t in enumerate(transcripts) if t["role"] == "user"),
        len(transcripts),
    )
    early = [t for t in transcripts[:first_user] if t["role"] == "assistant"]
    item["startupObservations"] = {
        "assistantBeforeCaller": bool(early),
        "userTranscriptObserved": first_user < len(transcripts),
        "selfDialogueBeforeCaller": any(
            re.search(r"(?i)\bwho are you\s*\?", t["text"])
            and re.search(r"(?i)\bi(?: am|'m|\u2019m)\b", t["text"])
            for t in early
        ),
        "startupSilenceRequirement": "best-effort",
    }
    audio = item.get("startupAudio")
    item["startupObservations"]["audioAcceptance"] = (
        "signal-observed"
        if audio and audio["signalFrames"]
        else "no-signal-observed"
        if audio and audio["frames"]
        else "unverified"
    )
    # Report each real caller's profile lookup separately from startup speech.
    # This is execution qualification; audio usefulness still needs human ears.
    item["profileRequests"] = []

    def normalize(text: str) -> str:
        """Normalize recorded words for comparison."""
        return " ".join(re.findall(r"[a-z0-9]+", text.lower()))

    item["identityRequests"] = []
    for i, transcript in enumerate(transcripts):
        if (
            transcript["role"] != "user"
            or normalize(transcript["text"]) != "who are you"
        ):
            continue
        following = transcripts[i + 1 :]
        next_user = next(
            (j for j, t in enumerate(following) if t["role"] == "user"),
            len(following),
        )
        answer = " ".join(
            t["text"] for t in following[:next_user] if t["role"] == "assistant"
        )
        status = "pending"
        if answer:
            words = normalize(answer)
            branded = re.search(r"\bxcsh\b|\bek see shell\b|\bxc shell\b", words)
            status = (
                "xcsh-identity-verified"
                if branded and "chatgpt" not in words
                else "identity-mismatch"
            )
        item["identityRequests"].append(
            {
                "transcriptIndex": transcript["index"],
                "requestSha256": transcript["sha256"],
                "identityStatus": status,
                "answerSha256": sha(answer),
            }
        )
    for i, transcript in enumerate(transcripts):
        if transcript["role"] != "user" or "what do you know about me" not in normalize(
            transcript["text"]
        ):
            continue
        text = normalize(transcript["text"])
        owners = [
            tasks[t]
            for t in item["taskIds"]
            if text in normalize(tasks[t].get("request", ""))
        ]
        subsequent = transcripts[i + 1 :]
        next_user = next(
            (j for j, t in enumerate(subsequent) if t["role"] == "user"),
            len(subsequent),
        )
        answered = any(t["role"] == "assistant" for t in subsequent[:next_user])
        status = "pending"
        if len(owners) == 1 and owners[0]["status"] != "running":
            owner = owners[0]
            status = (
                "canonical-read-verified"
                if owner["completionVerified"]
                and owner["allToolsVerified"]
                and any(
                    v["tool"] == "person_profile"
                    for v in owner.get("canonicalProfileResults", [])
                )
                else "canonical-read-missing"
            )
        elif not owners and answered:
            status = "no-backend-delegation"
        item["profileRequests"].append(
            {
                "transcriptIndex": transcript["index"],
                "requestSha256": transcript["sha256"],
                "taskIds": [t["id"] for t in owners],
                "executionStatus": status,
            }
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("config")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    observe(json.loads(pathlib.Path(args.config).read_text()), args.once)
