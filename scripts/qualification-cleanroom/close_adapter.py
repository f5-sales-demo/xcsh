"""Verify normal phone closure and close only the owned capture producer."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import time
from typing import Any

from qualification_exec import command_output, run_command


def close(lab: Any, project: Any) -> Any:
    """Perform close."""
    lab, project = pathlib.Path(lab), pathlib.Path(project)
    prep = json.loads((project / "preparation.private.json").read_text())
    active = json.loads((lab / "active-campaign.json").read_text())
    ensure(
        prep["candidate"] == active["candidate"],
        'prep["candidate"] == active["candidate"]',
    )
    binary = prep["candidate"]["executable"]
    ensure(
        (
            hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()
            == prep["candidate"]["sha256"]
        ),
        '(\n    hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()\n    == prep["candidate"]["sha256"]\n)',
    )
    status = json.loads(command_output([binary, "remote-control", "status", "--json"]))
    observed = json.loads(
        (project / ".xcsh/voice-observer/output/latest.json").read_text()
    )
    ensure(status["activeVoiceSessions"] == 0, 'status["activeVoiceSessions"] == 0')
    ensure(not observed["outstandingTaskIds"], 'not observed["outstandingTaskIds"]')
    ensure(
        all(t["completionVerified"] for t in observed["tasks"]),
        'all(t["completionVerified"] for t in observed["tasks"])',
    )
    ensure(observed["sessions"], 'observed["sessions"]')
    ensure(
        all(s["lifecycle"] == "closed" for s in observed["sessions"]),
        'all(s["lifecycle"] == "closed" for s in observed["sessions"])',
    )
    run_command(
        ["/usr/bin/systemctl", "--user", "stop", "xcsh-uat.service"], check=True
    )
    return {
        "candidate": prep["candidate"],
        "activeVoiceSessions": 0,
        "outstandingTaskIds": [],
        "normalPhoneClosureObserved": True,
        "ownedProducerStopped": True,
        "closedCallIds": [s["id"] for s in observed["sessions"]],
        "herdrRestarted": False,
        "atUnixMs": time.time_ns() // 1_000_000,
    }


def ensure(condition: object, message: str) -> None:
    """Enforce a qualification invariant even when Python optimization is enabled."""
    if not condition:
        raise AssertionError(message)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", required=True)
    parser.add_argument("--project", required=True)
    args = parser.parse_args()
    print(json.dumps(close(args.lab, args.project)))
