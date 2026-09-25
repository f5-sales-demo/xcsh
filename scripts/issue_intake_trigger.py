#!/usr/bin/env python3
# ruff: noqa: D103, EM101, EM102, TRY003, S603
"""Mac desktop scheduled-task trigger for Ubuntu xcsh issue intake."""

from __future__ import annotations

import argparse
import json
import stat
import subprocess
import sys
from pathlib import Path

LEASE_FILE = Path.home() / ".local" / "share" / "xcsh-issue-intake" / "herdr.lease"
SSH_TARGET = "r.mordasiewicz@f5.com"
REMOTE_WORKER = "/data/robin-GIT/xcsh/scripts/issue_intake_worker.py"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="validate pairing without polling issues"
    )
    args = parser.parse_args()
    mode = LEASE_FILE.stat().st_mode
    if mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise PermissionError(f"Herdr lease must be owner-only: {LEASE_FILE}")
    payload = json.loads(LEASE_FILE.read_text())
    lease = payload["lease"]
    if not isinstance(lease, str) or not lease:
        raise ValueError("invalid Herdr lease file")
    command = [
        "ssh",
        "-o",
        "BatchMode=yes",
        SSH_TARGET,
        f'export PATH="/home/robin/.local/bin:$PATH"; python3 {REMOTE_WORKER}',
    ]
    if args.check:
        command[-1] += " --check"
    result = subprocess.run(command, input=lease, text=True, check=False)
    return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, KeyError, ValueError) as exc:
        print(
            json.dumps({"status": "trigger-error", "reason": str(exc)}), file=sys.stderr
        )
        sys.exit(1)
