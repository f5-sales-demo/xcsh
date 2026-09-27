#!/usr/bin/env python3
# ruff: noqa: D103, EM101, TRY003, S603
"""Ubuntu timer entrypoint for the Herdr-paired issue watcher."""

from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

MAX_LEASE_BYTES = 16384
LEASE_FILE = Path.home() / ".local/share/xcsh-issue-intake/herdr.lease"
CONSUMER = "xcsh-issue-intake-ubuntu-worker"
ALLOWED_ENV = {
    "HERDR_BIN_PATH",
    "HERDR_ENV",
    "HERDR_PANE_ID",
    "HERDR_SOCKET_PATH",
    "HERDR_TAB_ID",
    "HERDR_WORKSPACE_ID",
}
EXPECTED_WORKSPACE = "w1"


def herdr_binary(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".local/bin/herdr"


def herdr_endpoint(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".config/herdr/sessions/xcsh-issue-intake/herdr.sock"


def read_lease(path: Path = LEASE_FILE) -> str:
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise PermissionError("Herdr lease must be owned by the worker and owner-only")
    if info.st_size > MAX_LEASE_BYTES:
        raise ValueError("oversized Herdr lease")
    payload = json.loads(path.read_text())
    lease = payload["lease"]
    if not isinstance(lease, str) or not lease:
        raise ValueError("invalid Herdr lease")
    return lease


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    lease = read_lease()
    endpoint = herdr_endpoint()
    result = subprocess.run(
        [
            str(herdr_binary()),
            "context",
            "resolve",
            "--endpoint",
            str(endpoint),
            "--consumer-id",
            CONSUMER,
        ],
        input=lease,
        text=True,
        capture_output=True,
        check=True,
    )
    context = json.loads(result.stdout)
    environment = context["environment"]
    pane = context["pane"]
    if set(environment) != ALLOWED_ENV or environment.get("HERDR_ENV") != "1":
        raise ValueError("unexpected Herdr context environment")
    if (
        environment["HERDR_SOCKET_PATH"] != str(endpoint)
        or pane["workspace_id"] != EXPECTED_WORKSPACE
    ):
        raise ValueError("Herdr lease resolves to an unexpected session or workspace")
    if args.check:
        print(json.dumps({"status": "paired", "workspace": pane["workspace_id"]}))
        return 0
    env = os.environ.copy()
    env.update(environment)
    script = Path("/data/robin-GIT/xcsh/scripts/issue_intake.py")
    completed = subprocess.run(
        [sys.executable, str(script), "run"], env=env, check=False
    )
    return completed.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (
        KeyError,
        OSError,
        ValueError,
        subprocess.CalledProcessError,
        json.JSONDecodeError,
    ) as exc:
        print(
            json.dumps({"status": "handoff-error", "reason": str(exc)}), file=sys.stderr
        )
        sys.exit(1)
