# ruff: noqa: INP001
"""Run reviewed clarification replies in one installed CLI RPC session."""

import contextlib
import json
import os
import queue
import select
import signal
import subprocess
import threading
import time
from typing import Any


def run_rpc_turns(
    command: list[str], prompts: list[str], timeout_seconds: float = 180
) -> dict[str, Any]:
    """Wait for each completed agent turn before sending its reviewed reply."""
    events: queue.Queue[tuple[str, str]] = queue.Queue()
    stderr: list[str] = []
    turns: list[list[dict[str, Any]]] = []
    with subprocess.Popen(  # noqa: S603 - caller passes argv, never shell source
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        start_new_session=True,
    ) as process:

        def read_stdout() -> None:
            if process.stdout is None:
                return
            for line in process.stdout:
                events.put(("line", line))
            events.put(("eof", ""))

        def read_stderr() -> None:
            if process.stderr is None:
                return
            stderr.extend(process.stderr)

        readers = [
            threading.Thread(target=read_stdout, daemon=True),
            threading.Thread(target=read_stderr, daemon=True),
        ]
        for reader in readers:
            reader.start()
        try:
            if process.stdin is None:
                message = "Installed RPC stdin is unavailable"
                raise ValueError(message)
            os.set_blocking(process.stdin.fileno(), False)
            for index, prompt in enumerate(prompts):
                deadline = time.monotonic() + timeout_seconds
                request_id = f"qualification-turn-{index}"
                write_prompt(
                    process.stdin.fileno(),
                    request_id,
                    prompt,
                    deadline,
                    command,
                    timeout_seconds,
                )
                turn: list[dict[str, Any]] = []
                while True:
                    if deadline - time.monotonic() <= 0:
                        raise subprocess.TimeoutExpired(command, timeout_seconds)
                    try:
                        kind, line = events.get(
                            timeout=max(0, deadline - time.monotonic())
                        )
                    except queue.Empty:
                        raise subprocess.TimeoutExpired(
                            command, timeout_seconds
                        ) from None
                    if kind == "eof":
                        message = (
                            "Installed RPC process ended before completed agent turn"
                        )
                        raise ValueError(message)
                    turn.append(json.loads(line))
                    event = turn[-1]
                    if not isinstance(event, dict):
                        message = "Installed RPC event must be an object"
                        raise TypeError(message)
                    if (
                        event.get("type") == "response"
                        and event.get("id") == request_id
                        and event.get("success") is False
                    ):
                        message = "Installed RPC prompt rejected"
                        raise ValueError(message)
                    if event.get("type") == "agent_end":
                        if (
                            len(
                                [
                                    item
                                    for item in turn
                                    if item.get("type") == "response"
                                    and item.get("id") == request_id
                                    and item.get("success") is True
                                ]
                            )
                            != 1
                        ):
                            message = "Installed RPC completion lacks its prompt acknowledgement"
                            raise ValueError(message)
                        turns.append(turn)
                        break
            return {"turns": turns, "stderr": "".join(stderr)}
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1)
            for reader in readers:
                reader.join(timeout=1)


def write_prompt(
    input_fd: int,
    request_id: str,
    prompt: str,
    deadline: float,
    command: list[str],
    timeout_seconds: float,
) -> None:
    """Write one exact request within the same turn deadline as response reads."""
    payload = (
        json.dumps({"id": request_id, "type": "prompt", "message": prompt}) + "\n"
    ).encode()
    offset = 0
    while offset < len(payload):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([], [input_fd], [], remaining)[1]:
            raise subprocess.TimeoutExpired(command, timeout_seconds)
        try:
            offset += os.write(input_fd, payload[offset : offset + 65536])
        except BlockingIOError:
            continue


def turn_messages(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract only the messages of a completed turn, without prior-turn history."""
    completed = [event for event in events if event.get("type") == "agent_end"]
    if len(completed) != 1 or not isinstance(completed[0].get("messages"), list):
        message = "Exactly one completed model turn with messages required"
        raise ValueError(message)
    messages = completed[0]["messages"]
    for message in messages:
        if not isinstance(message, dict) or not isinstance(
            message.get("content")
            if message.get("role") == "assistant"
            else message.get("content", []),
            list,
        ):
            error = "Completed model messages must be objects with content arrays"
            raise TypeError(error)
        if any(not isinstance(part, dict) for part in message.get("content", [])):
            error = "Completed model content parts must be objects"
            raise TypeError(error)
    return messages


def run_json_process(
    command: list[str], timeout_seconds: float = 180
) -> subprocess.CompletedProcess[str]:
    """Bound a single-turn JSON invocation and kill its complete process group."""
    with subprocess.Popen(  # noqa: S603 - exact installed argv without shell evaluation
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
            return subprocess.CompletedProcess(
                command, process.returncode, stdout, stderr
            )
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=1)
