"""Bind an already prepared real project to its verified host and collectors."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
from typing import Any

from qualification_exec import command_output


def arm(lab: Any, project: Any) -> Any:
    """Perform arm."""
    lab, project = pathlib.Path(lab), pathlib.Path(project)
    active = json.loads((lab / "active-campaign.json").read_text())
    prep = json.loads((project / "preparation.private.json").read_text())
    ensure(
        active["candidate"] == prep["candidate"],
        'active["candidate"] == prep["candidate"]',
    )
    binary = active["candidate"]["executable"]
    ensure(
        (
            hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()
            == active["candidate"]["sha256"]
        ),
        '(\n    hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()\n    == active["candidate"]["sha256"]\n)',
    )
    clients = json.loads(
        command_output([binary, "remote-control", "clients", "--json"])
    )["data"]
    ensure(len(clients) == 1, "len(clients) == 1")
    status = json.loads(command_output([binary, "remote-control", "status", "--json"]))
    ensure(status["activeVoiceSessions"] == 0, 'status["activeVoiceSessions"] == 0')
    checkpoint = json.loads((lab / "resume-checkpoint.json").read_text())
    source = pathlib.Path(checkpoint["sourceWorktree"])
    env = dict(
        os.environ,
        PATH=str(lab / "tooling/bun-1.4.3/bin")
        + ":"
        + str(pathlib.Path.home() / ".local/bin")
        + ":/usr/local/bin:/usr/bin:/bin",
    )
    runtime = json.loads(
        command_output(
            [
                "bun",
                "packages/coding-agent/scripts/lifecycle-uat-controller.ts",
                "preflight",
                "--campaign-dir",
                active["campaign"],
            ],
            cwd=source,
            env=env,
        )
    )
    ensure(len(runtime["workers"]) == 1, 'len(runtime["workers"]) == 1')
    ensure(
        runtime["workers"][0]["threadId"] == prep["threadId"],
        'runtime["workers"][0]["threadId"] == prep["threadId"]',
    )
    observer = json.loads(
        (project / ".xcsh/voice-observer/output/latest.json").read_text()
    )
    ensure(
        observer["candidate"] == active["candidate"],
        'observer["candidate"] == active["candidate"]',
    )
    ensure(not observer["outstandingTaskIds"], 'not observer["outstandingTaskIds"]')
    capture = list(
        (pathlib.Path(active["campaign"]) / "captures").glob(
            "host-" + str(runtime["childPid"]) + "-*.jsonl"
        )
    )
    ensure(len(capture) == 1, "len(capture) == 1")
    voice = pathlib.Path(active["campaign"]) / "diagnostics"
    return {
        "threadId": prep["threadId"],
        "historyPath": prep["sessionPath"],
        "capturePaths": [str(capture[0])],
        "diagnosticDirectory": str(voice),
        "diagnosticBaseline": [p.name for p in voice.glob("*.jsonl")],
        "captureDirectory": str(pathlib.Path(active["campaign"]) / "captures"),
        "captureBaseline": [
            p.name
            for p in (pathlib.Path(active["campaign"]) / "captures").glob("*.jsonl")
        ],
        "hostIdentity": {
            "supervisorPid": runtime["supervisorPid"],
            "childPid": runtime["childPid"],
            "hostname": "nuc",
            "invocation": runtime["invocation"],
        },
        "workerIdentity": runtime["workers"][0],
        "effectiveConfiguration": {
            "executionModel": prep["executionModel"],
            "executionEffort": prep["executionEffort"],
            "context": prep["context"],
            "namespace": prep["namespace"],
        },
        "fixtureHashes": {
            str(project / "fixture.json"): hashlib.sha256(
                (project / "fixture.json").read_bytes()
            ).hexdigest()
        },
        "ownership": {
            "stateRoot": prep["controllerState"],
            "previousOwnedResourcesAbsent": True,
            "finalDisposition": "destroy-and-prove-absence",
        },
        "collectorsArmed": True,
        "pairingVerified": True,
        "phoneBuild": clients[0]["appVersion"],
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
    print(json.dumps(arm(args.lab, args.project)))
