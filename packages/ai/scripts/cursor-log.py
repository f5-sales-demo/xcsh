#!/usr/bin/env python3
# pylint: disable=invalid-name
"""Filter and display Cursor debug logs (JSONL format).

Usage:
   cursor-log.py /tmp/cursor_ask.jsonl           # Filter and display
   cursor-log.py /tmp/cursor_ask.jsonl -f        # Follow mode (like tail -f)
   cursor-log.py /tmp/cursor_ask.jsonl -v        # Verbose (show all)
   cursor-log.py /tmp/cursor_ask.jsonl --last 50 # Show last N entries
"""

import argparse
import contextlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

SKIP_DELTAS = {"tokenDelta", "partialToolCall", "heartbeat", "thinkingDelta"}
COALESCE_DELTAS = {"textDelta"}
TOOL_ARGUMENT_PREVIEW_LIMIT = 200
JSON_PREVIEW_LIMIT = 120
TEXT_PREVIEW_LIMIT = 300
FOLLOW_FLUSH_SECONDS = 0.5
FOLLOW_BUFFER_LIMIT = 50


def get_delta_type(entry: dict) -> str | None:
    """Return delta type if this is a delta entry, else None."""
    typ = entry.get("type", "")
    subtype = entry.get("subtype", "")

    if typ == "interactionUpdate" and subtype in SKIP_DELTAS | COALESCE_DELTAS:
        return subtype

    if typ == "info" and subtype == "interactionUpdate":
        data = entry.get("data", {})
        if isinstance(data, dict):
            return data.get("updateCase")

    return None


def is_noise(entry: dict, verbose: bool = False) -> bool:
    """Return whether an entry should be omitted from concise output."""
    if verbose:
        return False

    typ = entry.get("type", "")
    subtype = entry.get("subtype", "")

    # serverMessage:interactionUpdate is redundant (we log the inner update)
    if typ == "serverMessage" and subtype == "interactionUpdate":
        return True

    # KV blob ops are noisy
    if typ == "kvClient" or (typ == "serverMessage" and subtype == "kvServerMessage"):
        return True

    # conversationCheckpointUpdate is noisy
    if typ == "serverMessage" and subtype == "conversationCheckpointUpdate":
        return True

    # execClient:requestContextResult is redundant with info:execClientMessage
    if typ == "execClient" and subtype == "requestContextResult":
        return True

    # Filter streaming deltas that we skip entirely
    delta_type = get_delta_type(entry)
    return delta_type in SKIP_DELTAS


# pylint: disable=too-many-return-statements
def format_data(typ: str, subtype: str, data: dict | None) -> str:  # noqa: PLR0911
    """Format the useful portion of one structured log payload."""
    if not data or not isinstance(data, dict):
        return ""

    # Extract useful fields based on message type
    if typ == "serverMessage" and subtype == "execServerMessage":
        msg = data.get("message", {})
        case = msg.get("case", "")
        value = msg.get("value", {})
        if case == "mcpArgs":
            name = value.get("name") or value.get("toolName") or "?"
            args = value.get("args", {})
            args_str = json.dumps(args, default=str) if args else ""
            if len(args_str) > TOOL_ARGUMENT_PREVIEW_LIMIT:
                args_str = args_str[:TOOL_ARGUMENT_PREVIEW_LIMIT] + "..."
            return f" tool:{name} {args_str}"
        if case == "grepArgs":
            pattern = value.get("pattern", "")
            path = value.get("path", ".")
            return (
                f" grep:{pattern[:30]}@{path[:30]}" if pattern else f" grep@{path[:30]}"
            )
        if case == "shellArgs":
            cmd = value.get("command", "")[:50]
            return f" shell:{cmd}"
        if case in ("readArgs", "writeArgs", "lsArgs", "deleteArgs"):
            path = value.get("path", "")
            return f" {case.replace('Args', '')}:{path[:60]}" if path else f" {case}"
        return f" {case}"

    if typ == "info" and subtype == "interactionUpdate":
        update_case = data.get("updateCase", "")
        return f" {update_case}"

    if typ == "info" and subtype == "builtRunRequest":
        return f" tools={data.get('tools', 0)}"

    if typ == "info" and subtype == "execClientMessage":
        return f" {data.get('messageCase', '')}"

    # Default: show compact JSON
    filtered = {
        k: v
        for k, v in data.items()
        if v is not None and k not in ("detail", "$typeName")
    }
    if not filtered:
        return ""
    s = json.dumps(filtered, default=str)
    return f" {s[:JSON_PREVIEW_LIMIT]}..." if len(s) > JSON_PREVIEW_LIMIT else f" {s}"


def format_entry(entry: dict, verbose: bool = False) -> str | None:
    """Format one non-noise log entry for display."""
    if is_noise(entry, verbose):
        return None

    ts = entry.get("ts", 0)
    typ = entry.get("type", "?")
    subtype = entry.get("subtype")
    data = entry.get("data")

    time_str = (
        datetime.fromtimestamp(ts / 1000, tz=UTC).strftime("%H:%M:%S.%f")[:-3]
        if ts
        else "??:??:??"
    )

    type_str = f"{typ}:{subtype}" if subtype else typ
    data_str = format_data(typ, subtype or "", data) if not verbose else ""

    if verbose and data:
        data_str = " " + json.dumps(data, default=str)[:300]

    return f"[{time_str}] {type_str}{data_str}"


def extract_text_delta(entry: dict) -> str | None:
    """Extract text from a textDelta entry."""
    data = entry.get("data", {})
    if isinstance(data, dict):
        # Direct textDelta
        if "text" in data:
            return data["text"]
        # Nested in message.value
        msg = data.get("message", {})
        if isinstance(msg, dict):
            value = msg.get("value", {})
            if isinstance(value, dict) and "text" in value:
                return value["text"]
    return None


def coalesce_entries(entries: list[dict], verbose: bool = False) -> list[str]:
    """Process entries, coalescing consecutive textDeltas."""
    output = []
    text_buffer = ""
    text_ts = 0

    def flush_text() -> None:
        nonlocal text_buffer, text_ts
        if text_buffer:
            time_str = datetime.fromtimestamp(text_ts / 1000, tz=UTC).strftime(
                "%H:%M:%S.%f"
            )[:-3]
            text = text_buffer.replace("\n", "\\n")
            if len(text) > TEXT_PREVIEW_LIMIT:
                text = text[:TEXT_PREVIEW_LIMIT] + "..."
            output.append(f"[{time_str}] text: {text}")
            text_buffer = ""
            text_ts = 0

    for entry in entries:
        typ = entry.get("type", "")
        subtype = entry.get("subtype", "")

        # Accumulate textDelta
        if typ == "interactionUpdate" and subtype == "textDelta":
            text = extract_text_delta(entry)
            if text:
                if not text_buffer:
                    text_ts = entry.get("ts", 0)
                text_buffer += text
            continue

        # Skip noise entirely (don't flush for these)
        if is_noise(entry, verbose):
            continue

        # Real entry - flush text buffer first
        flush_text()

        formatted = format_entry(entry, verbose)
        if formatted:
            output.append(formatted)

    flush_text()
    return output


def parse_entries(path: Path, last: int = 0) -> list[dict]:
    """Parse JSONL file into entries."""
    entries = []
    lines = path.read_text().strip().split("\n")
    if last > 0:
        lines = lines[-last:] if len(lines) > last else lines
    for line in lines:
        if line.strip():
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"[PARSE ERROR] {line[:100]}", file=sys.stderr)  # noqa: T201
    return entries


def process_file(
    path: Path, verbose: bool = False, follow: bool = False, last: int = 0
) -> None:
    """Render a JSONL log once or follow it until interrupted."""
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)  # noqa: T201
        sys.exit(1)

    if follow:
        # Follow mode: buffer briefly then emit
        with path.open() as f:
            f.seek(0, 2)
            buffer = []
            last_emit = time.time()
            while True:
                line = f.readline()
                if line and line.strip():
                    with contextlib.suppress(json.JSONDecodeError):
                        buffer.append(json.loads(line))
                # Emit buffered entries every 0.5s or when buffer is large
                if buffer and (
                    time.time() - last_emit > FOLLOW_FLUSH_SECONDS
                    or len(buffer) > FOLLOW_BUFFER_LIMIT
                ):
                    for out in coalesce_entries(buffer, verbose):
                        print(out, flush=True)  # noqa: T201
                    buffer = []
                    last_emit = time.time()
                elif not line:
                    time.sleep(0.05)
    else:
        entries = parse_entries(path, last)
        for out in coalesce_entries(entries, verbose):
            print(out)  # noqa: T201


def main() -> None:
    """Parse command-line arguments and render the selected log."""
    parser = argparse.ArgumentParser(description="Filter Cursor debug logs")
    parser.add_argument("file", type=Path, help="JSONL log file")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show all entries")
    parser.add_argument(
        "-f", "--follow", action="store_true", help="Follow mode (tail -f)"
    )
    parser.add_argument("--last", type=int, default=0, help="Show last N entries")

    args = parser.parse_args()

    with contextlib.suppress(KeyboardInterrupt):
        process_file(
            args.file, verbose=args.verbose, follow=args.follow, last=args.last
        )


if __name__ == "__main__":
    main()
