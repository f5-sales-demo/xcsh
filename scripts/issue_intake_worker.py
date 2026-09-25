#!/usr/bin/env python3
# ruff: noqa: D103, EM101, TRY003, S603
"""Ubuntu side of the Mac scheduled-task handoff. Lease arrives only on stdin."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

MAX_LEASE_BYTES = 16384
ENDPOINT = "/home/robin/.config/herdr/sessions/xcsh-issue-intake/herdr.sock"
CONSUMER = "xcsh-issue-intake-mac-worker"
ALLOWED_ENV = {
    "HERDR_BIN_PATH",
    "HERDR_ENV",
    "HERDR_PANE_ID",
    "HERDR_SOCKET_PATH",
    "HERDR_TAB_ID",
    "HERDR_WORKSPACE_ID",
}
EXPECTED_WORKSPACE = "w1"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    lease = sys.stdin.read(MAX_LEASE_BYTES + 1).strip()
    if not lease or len(lease) > MAX_LEASE_BYTES:
        raise ValueError("missing or oversized Herdr lease")
    result = subprocess.run(
        [
            "/home/robin/.local/bin/herdr",
            "context",
            "resolve",
            "--endpoint",
            ENDPOINT,
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
        environment["HERDR_SOCKET_PATH"] != ENDPOINT
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
        ValueError,
        subprocess.CalledProcessError,
        json.JSONDecodeError,
    ) as exc:
        print(
            json.dumps({"status": "handoff-error", "reason": str(exc)}), file=sys.stderr
        )
        sys.exit(1)
