"""Candidate-bound private voice/lifecycle runner; resumption never replays work.

Adapters are explicit argv arrays whose executables are frozen with the spec.
Collectors own their footer; the runner never manufactures capture completeness.
"""

from __future__ import annotations

import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
from http import HTTPStatus
from typing import Any

from qualification_exec import run_command

CAMPAIGN_GATES = 34
CAMPAIGN_PLUGINS = 23
LIFECYCLE_GATES = 299
TOTAL_GATES = CAMPAIGN_GATES + LIFECYCLE_GATES

PHRASES = [
    "Who are you?",
    "What do you know about me?",
    "Please repeat that.",
    "What files are in this project?",
    "Which context and workspace are active?",
    "What does my saved machine profile say, separately from the computer running xcsh and this workspace?",
    "Tell me about xcsh\u2019s capabilities, selected execution model and reasoning, host, and workspace.",
]
OPERATIONS = ("prepare", "pair", "arm", "observe", "inspect", "close", "seal", "resume")


def digest(path: Any) -> Any:
    """Perform digest."""
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def canonical(value: Any) -> Any:
    """Perform canonical."""
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def load(path: Any) -> Any:
    """Perform load."""
    return json.loads(pathlib.Path(path).read_text())


def private_path(path: Any, directory: Any = False) -> Any:
    """Perform private path."""
    path = pathlib.Path(path).absolute()
    if path.resolve() != path:
        message = "symlink in private path"
        raise ValueError(message)
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        message = "private path owner or mode mismatch"
        raise ValueError(message)
    if not (path.is_dir() if directory else path.is_file()):
        message = "private path type mismatch"
        raise ValueError(message)
    return path


def write(path: Any, data: Any) -> Any:
    """Perform write."""
    path = pathlib.Path(path)
    with path.open("x") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
    path.chmod(0o600)


def tree(root: Any) -> Any:
    """Perform tree."""
    root = pathlib.Path(root)
    result = {}
    for path in sorted(root.rglob("*")):
        if any(
            part in (".git", "node_modules", "__pycache__")
            for part in path.relative_to(root).parts
        ):
            continue
        if path.is_symlink():
            message = "mutable symlink in frozen source"
            raise ValueError(message)
        if path.is_file():
            result[str(path.relative_to(root))] = digest(path)
    if not result:
        message = "empty frozen source"
        raise ValueError(message)
    return result


def freeze(spec: Any) -> Any:
    """Perform freeze."""
    candidate = spec["candidate"]
    if (
        not re.fullmatch("[0-9a-f]{40}", candidate["commit"])
        or digest(candidate["executable"]) != candidate["sha256"]
    ):
        message = "candidate mismatch"
        raise ValueError(message)
    fixtures = spec.get("fixtureHashes", {})
    if any(digest(path) != expected for path, expected in fixtures.items()):
        message = "fixture hash mismatch"
        raise ValueError(message)
    return {
        "candidate": candidate,
        "sources": {name: tree(path) for name, path in spec["sources"].items()},
        "adapters": {
            name: {arg: digest(arg) for arg in argv if pathlib.Path(arg).is_file()}
            for name, argv in spec["adapters"].items()
        },
        "effectiveConfiguration": spec["effectiveConfiguration"],
        "fixtureHashes": fixtures,
    }


def campaign_cases(ledger: Any) -> Any:
    """Perform campaign cases."""
    gates = ledger["gates"]
    plugins = ledger["marketplace"]
    rows = gates + [row for plugin in plugins for row in plugin["gates"]]
    if (
        len(gates) != CAMPAIGN_GATES
        or len(plugins) != CAMPAIGN_PLUGINS
        or sum(len(p["gates"]) for p in plugins) != LIFECYCLE_GATES
    ):
        message = "campaign scope was reduced"
        raise ValueError(message)
    if len({row["id"] for row in rows}) != TOTAL_GATES:
        message = "duplicate campaign gate"
        raise ValueError(message)
    # History is archived separately; no previous status is promoted here.
    return {
        row["id"]: {"requirement": row["requirement"], "status": "incomplete"}
        for row in rows
    }


def adapter(spec: Any, name: Any, output: Any) -> Any:
    """Perform adapter."""
    argv = spec["adapters"].get(name)
    if not argv or not all(isinstance(arg, str) for arg in argv):
        message = "required adapter unavailable: " + name
        raise ValueError(message)
    env = dict(os.environ)
    env.update(spec.get("environment", {}))
    # Long-running setup is governed by its controller, up to two hours.
    limit = 7200 if name in ("setup", "destroy", "deploy") else 120
    with pathlib.Path(output).open("xb") as stream:
        result = run_command(
            argv,
            cwd=spec["workspace"],
            env=env,
            stdout=stream,
            stderr=subprocess.STDOUT,
            timeout=limit,
            check=False,
        )
    if result.returncode:
        message = "adapter failed; inspect private output: " + name
        raise ValueError(message)
    return load(output)


def field(value: Any, dotted: Any) -> Any:
    """Perform field."""
    for component in dotted.split("."):
        value = value[int(component)] if isinstance(value, list) else value[component]
    return value


def assertion(rule: Any) -> Any:
    """Derive acceptance from source evidence rather than reported success flags."""
    value = load(rule["path"])
    kind = rule["kind"]
    if kind == "equals":
        if rule["field"].split(".")[-1] in (
            "pass",
            "passed",
            "success",
            "accepted",
            "qualified",
            "automatedPass",
        ):
            message = "reported acceptance cannot prove itself"
            raise ValueError(message)
        return field(value, rule["field"]) == rule["expected"]
    if kind == "empty":
        return field(value, rule["field"]) in ([], {})
    if kind == "plan-no-change":
        changes = value["resource_changes"]
        return bool(changes) and all(
            row["change"]["actions"] == ["no-op"] for row in changes
        )
    if kind == "saved-plan":
        plan = field(value, rule["field"])
        content = plan.get("content")
        return (
            isinstance(content, str)
            and bool(content.strip())
            and hashlib.sha256(content.encode()).hexdigest() == plan.get("sha256")
        )
    if kind == "traffic":
        samples, logs = value["samples"], value["workloadLogs"]
        expected = rule["fixtureId"]
        nonces = [row["nonce"] for row in samples]
        return (
            bool(samples)
            and len(set(nonces)) == len(nonces)
            and all(
                row["body"]["fixtureId"] == expected
                and row["body"]["nonce"] == row["nonce"]
                and row["status"] == HTTPStatus.OK
                and row["ceUid"] == rule["ceUid"]
                and row["loadBalancerUid"] == rule["loadBalancerUid"]
                for row in samples
            )
            and all(
                any(
                    log["nonce"] == row["nonce"]
                    and log["fixtureId"] == expected
                    and log["sourceIp"] == rule["ceInsideIp"]
                    for log in logs
                )
                for row in samples
            )
        )
    message = "unknown assertion kind"
    raise ValueError(message)


def observer_module() -> Any:
    """Perform observer module."""
    path = pathlib.Path(__file__).with_name("observer.py")
    spec = importlib.util.spec_from_file_location("voice_observer", path)
    if spec is None or spec.loader is None:
        message = "Qualification module loader is unavailable"
        raise RuntimeError(message)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def capture_paths(binding: Any) -> Any:
    """Perform capture paths."""
    paths = list(binding["capturePaths"])
    if binding.get("captureDirectory"):
        paths += [
            str(p)
            for p in sorted(pathlib.Path(binding["captureDirectory"]).glob("*.jsonl"))
            if p.name not in binding["captureBaseline"]
        ]
    if binding.get("diagnosticDirectory"):
        paths += [
            str(p)
            for p in sorted(
                pathlib.Path(binding["diagnosticDirectory"]).glob("*.jsonl")
            )
            if p.name not in binding["diagnosticBaseline"]
        ]
    return list(dict.fromkeys(paths))


def inspect_attempt(spec: Any, attempt: Any) -> Any:
    """Perform inspect attempt."""
    observer = observer_module()
    binding = load(attempt / "arm.json")
    history, pending, history_hash = observer.read_jsonl_prefix(binding["historyPath"])
    # Include only this attempt's fresh capture paths, never old successful files.
    traces = [
        observer.trace_state(path, spec["candidate"]) for path in capture_paths(binding)
    ]
    derived = observer.derive(history[binding["historyStartRecord"] :])
    sessions = derived["sessions"]
    call_id = binding.get("callId")
    session = (
        next((s for s in sessions if s["id"] == call_id), None)
        if call_id
        else (sessions[0] if len(sessions) == 1 else None)
    )
    failures = []
    if not session:
        failures.append("call-not-observed")
    else:
        if session["lifecycle"] != "closed":
            failures.append("call-not-closed")
        if session.get("outcome") == "failed":
            failures.append("call-failed")
        if session["startupObservations"]["audioAcceptance"] == "signal-observed":
            failures.append("unsolicited-startup-audio")
        if session["startupObservations"]["assistantBeforeCaller"]:
            failures.append("unsolicited-startup-speech")
        if not session["startupObservations"]["userTranscriptObserved"]:
            failures.append("caller-not-observed")
        if any(
            r["identityStatus"] != "xcsh-identity-verified"
            for r in session["identityRequests"]
        ):
            failures.append("identity-answer-unverified")
        if any(
            r["executionStatus"] != "canonical-read-verified"
            for r in session["profileRequests"]
        ):
            failures.append("canonical-profile-read-unverified")
        phrase = spec["cases"][binding["caseId"]].get("spokenRequest")
        if phrase:

            def normalize(text: str) -> str:
                """Normalize recorded words for comparison."""
                return " ".join(re.findall("[a-z0-9]+", text.lower()))

            if not any(
                t["role"] == "user" and normalize(t["text"]) == normalize(phrase)
                for t in session["transcripts"]
            ):
                failures.append("exact-caller-request-missing")
        if any(
            not t["completionVerified"] or (t["tools"] and not t["allToolsVerified"])
            for t in derived["tasks"]
        ):
            failures.append("task-or-tool-incomplete")
    if pending or derived["outstandingTaskIds"]:
        failures.append("history-or-task-incomplete")
    if not traces or any(
        not t["complete"] or t["applicationInputBeforeCaller"] for t in traces
    ):
        failures.append("capture-incomplete-or-startup-injection")
    failures.extend(
        "assertion-failed:" + rule["id"]
        for rule in spec["cases"][binding["caseId"]]["assertions"]
        if not assertion(rule)
    )
    return {
        "candidate": spec["candidate"],
        "caseId": binding["caseId"],
        "threadId": binding["threadId"],
        "callId": session["id"] if session else call_id,
        "historySha256": history_hash,
        "traces": traces,
        "failures": failures,
        "automatedPass": not failures,
        "physicalAcceptance": False,
    }


def journal(root: Any) -> Any:
    """Perform journal."""
    result: list[Any] = []
    for path in sorted((root / "journal").glob("*.json")):
        record = load(path)
        if record["sequence"] != len(result) + 1 or record["previous"] != (
            canonical(result[-1]) if result else None
        ):
            message = "journal sequence or hash gap"
            raise ValueError(message)
        result.append(record)
    return result


def record(root: Any, operation: Any, payload: Any) -> Any:
    """Perform record."""
    history = journal(root)
    row = {
        "sequence": len(history) + 1,
        "previous": canonical(history[-1]) if history else None,
        "operation": operation,
        "payload": payload,
        "atUnixMs": time.time_ns() // 1_000_000,
    }
    write(root / "journal" / f"{row['sequence']:06d}.json", row)


def execute(
    root: Any,
    operation: Any,
    spec_path: Any = None,
    case_id: Any = None,
    attempt_id: Any = None,
    observations: Any = None,
) -> Any:
    """Perform execute."""
    root = pathlib.Path(root).absolute()
    if operation == "prepare":
        return execute_prepare(root, spec_path)
    private_path(root, directory=True)
    spec = load(root / "spec.json")
    frozen = load(root / "freeze.json")
    history = journal(root)
    if (
        not history
        or history[0]["payload"]["specSha256"] != digest(root / "spec.json")
        or history[0]["payload"]["freezeSha256"] != digest(root / "freeze.json")
    ):
        message = "campaign admission changed"
        raise ValueError(message)
    if freeze(spec) != frozen:
        message = "frozen candidate, adapter, catalog, or configuration changed"
        raise ValueError(message)
    early_result = None
    if operation == "resume":
        early_result = {
            "root": str(root),
            "lastOperation": history[-1]["operation"],
            "attempts": [p.name for p in (root / "attempts").iterdir()],
            "replayedMutations": 0,
            "fullGoalComplete": False,
        }
    if operation == "pair":
        path = root / (f"pair-{time.time_ns()}.json")
        result = adapter(spec, "pair", path)
        record(root, operation, {"receipt": str(path), "sha256": digest(path)})
        early_result = {
            "pairingReceipt": str(path),
            "humanAction": "scan and authorize QR",
            "acceptance": False,
        }
    if early_result is not None:
        return early_result
    if not attempt_id or not re.fullmatch("[a-zA-Z0-9_-]+", attempt_id):
        message = "explicit safe attempt ID required"
        raise ValueError(message)
    attempt = root / "attempts" / attempt_id
    if operation == "arm":
        return execute_arm(attempt, attempt_id, case_id, root, spec)
    private_path(attempt, directory=True)
    arm = next(
        (
            r
            for r in history
            if r["operation"] == "arm" and r["payload"]["attempt"] == attempt_id
        ),
        None,
    )
    if not arm or arm["payload"]["armSha256"] != digest(attempt / "arm.json"):
        message = "attempt arm binding changed"
        raise ValueError(message)
    if (attempt / "seal.json").exists():
        message = "sealed attempt is immutable"
        raise ValueError(message)
    if operation in ("observe", "inspect"):
        result = inspect_attempt(spec, attempt)
        write(attempt / (f"inspection-{time.time_ns()}.json"), result)
        return result
    if operation == "close":
        result = adapter(spec, "close", attempt / "close.json")
        if result["activeVoiceSessions"] != 0 or result["outstandingTaskIds"]:
            message = "phone call or backend work remains open"
            raise ValueError(message)
        record(
            root,
            operation,
            {"attempt": attempt_id, "sha256": digest(attempt / "close.json")},
        )
        return {"closed": True, "sealPending": True}
    if operation == "seal":
        return execute_seal(
            attempt, attempt_id, frozen, history, observations, root, spec
        )
    message = "unknown operation"
    raise ValueError(message)


def main() -> Any:
    """Perform main."""
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=OPERATIONS)
    parser.add_argument("--root", required=True)
    parser.add_argument("--spec")
    parser.add_argument("--case")
    parser.add_argument("--attempt")
    parser.add_argument("--observations")
    args = parser.parse_args()
    # A sibling lock works for initial creation and subsequent operations.
    lock = pathlib.Path(args.root).absolute().with_suffix(".runner.lock")
    with lock.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            result = execute(
                args.root,
                args.operation,
                args.spec,
                args.case,
                args.attempt,
                args.observations,
            )
        except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
            print(
                json.dumps(
                    {
                        "operation": args.operation,
                        "error": str(error),
                        "acceptance": False,
                    }
                )
            )
            raise SystemExit(1) from error
        print(json.dumps(result))


def execute_prepare(root: Any, spec_path: Any) -> Any:
    """Execute the prepare phase with the existing admission and evidence checks."""
    operation = "prepare"
    spec = load(spec_path)
    frozen = freeze(spec)
    ledger = load(spec["ledgerPath"])
    cases = campaign_cases(ledger)
    if not set(spec["cases"]).issubset(cases):
        message = "unknown campaign case"
        raise ValueError(message)
    for case in spec["cases"].values():
        if not case["assertions"] or len({r["id"] for r in case["assertions"]}) != len(
            case["assertions"]
        ):
            message = "case requires distinct automated assertions"
            raise ValueError(message)
    root.mkdir(mode=0o700)
    for name in (
        "journal",
        "attempts",
        "archive",
        "settings",
        "plugins",
        "cache",
        "sessions",
        "fixtures",
        "controller",
        "terraform-data",
    ):
        (root / name).mkdir(mode=0o700)
    shutil.copyfile(spec["ledgerPath"], root / "archive/previous-ledger.json")
    (root / "archive/previous-ledger.json").chmod(0o600)
    write(root / "spec.json", spec)
    write(root / "freeze.json", frozen)
    write(
        root / "scope.json",
        {
            "cases": cases,
            "gates": 34,
            "plugins": 23,
            "lifecycleGates": 299,
            "finalRepetitionsRequired": 2,
            "fullGoalComplete": False,
        },
    )
    record(
        root,
        operation,
        {
            "specSha256": digest(root / "spec.json"),
            "freezeSha256": digest(root / "freeze.json"),
        },
    )
    return {"prepared": True, "root": str(root), "fullGoalComplete": False}


def execute_arm(
    attempt: Any, attempt_id: Any, case_id: Any, root: Any, spec: Any
) -> Any:
    """Execute the arm phase with the existing admission and evidence checks."""
    operation = "arm"
    if case_id not in spec["cases"]:
        message = "case lacks concrete acceptance rules"
        raise ValueError(message)
    attempt.mkdir(mode=0o700)
    binding = adapter(spec, "arm", attempt / "arm-adapter.json")
    for key in (
        "threadId",
        "historyPath",
        "capturePaths",
        "hostIdentity",
        "workerIdentity",
        "effectiveConfiguration",
        "fixtureHashes",
        "ownership",
    ):
        if not binding.get(key):
            message = "missing arm binding: " + key
            raise ValueError(message)
    if (
        binding["effectiveConfiguration"] != spec["effectiveConfiguration"]
        or not binding.get("collectorsArmed")
        or not binding.get("pairingVerified")
    ):
        message = "pairing, model, instructions, or collectors not verified"
        raise ValueError(message)
    if binding["fixtureHashes"] != spec.get("fixtureHashes"):
        message = "arm fixture binding differs from frozen fixture hashes"
        raise ValueError(message)
    # Challenge expiry applies before authorization. A registered client does
    # not expire when its already-consumed QR challenge does.
    if (
        binding.get("clientExpiresAt")
        and datetime.datetime.fromisoformat(binding["clientExpiresAt"]).timestamp()
        <= time.time()
    ):
        message = "paired client expired"
        raise ValueError(message)
    rows, pending, _ = observer_module().read_jsonl_prefix(binding["historyPath"])
    if pending or not binding["capturePaths"]:
        message = "incomplete history or missing captures at arm"
        raise ValueError(message)
    binding.update(
        caseId=case_id,
        candidate=spec["candidate"],
        historyStartRecord=len(rows),
        armedAtUnixMs=time.time_ns() // 1_000_000,
    )
    write(attempt / "arm.json", binding)
    record(
        root,
        operation,
        {"attempt": attempt_id, "armSha256": digest(attempt / "arm.json")},
    )
    return {
        "armed": True,
        "threadId": binding["threadId"],
        "humanAction": "tap voice once, remain silent eight seconds",
    }


def execute_seal(
    attempt: Any,
    attempt_id: Any,
    frozen: Any,
    history: Any,
    observations: Any,
    root: Any,
    spec: Any,
) -> Any:
    """Execute the seal phase with the existing admission and evidence checks."""
    operation = "seal"
    result = inspect_attempt(spec, attempt)
    if not (attempt / "close.json").exists():
        message = "closure receipt missing"
        raise ValueError(message)
    close = next(
        (
            r
            for r in history
            if r["operation"] == "close" and r["payload"]["attempt"] == attempt_id
        ),
        None,
    )
    if not close or close["payload"]["sha256"] != digest(attempt / "close.json"):
        message = "closure receipt changed"
        raise ValueError(message)
    required = spec["cases"][result["caseId"]].get("physicalObservations", [])
    physical = load(observations) if observations else {}
    if required and (
        physical.get("attemptId") != attempt_id
        or physical.get("candidate") != spec["candidate"]
        or any(physical.get(k) is not True for k in required)
    ):
        result["failures"].append("physical-observations-missing-or-failed")
    result.update(
        passed=not result["failures"],
        physicalAcceptance=bool(required) and not result["failures"],
        dependencies=frozen,
        physicalObservations=physical,
        evidenceHashes={
            str(p.relative_to(attempt)): digest(p)
            for p in attempt.iterdir()
            if p.is_file()
        },
        assertionEvidenceHashes={
            r["id"]: digest(r["path"])
            for r in spec["cases"][result["caseId"]]["assertions"]
        },
        fullGoalComplete=False,
    )
    archive = attempt / "sealed-evidence"
    archive.mkdir(mode=0o700)
    binding = load(attempt / "arm.json")
    paths = [
        binding["historyPath"],
        *capture_paths(binding),
        *binding["fixtureHashes"],
        *(r["path"] for r in spec["cases"][result["caseId"]]["assertions"]),
    ]
    result["retainedEvidence"] = []
    for index, source in enumerate(paths):
        target = archive / f"{index:03d}-{pathlib.Path(source).name}"
        shutil.copyfile(source, target)
        target.chmod(0o600)
        result["retainedEvidence"].append(
            {"source": source, "path": str(target), "sha256": digest(target)}
        )
    write(attempt / "seal.json", result)
    record(
        root,
        operation,
        {
            "attempt": attempt_id,
            "sha256": digest(attempt / "seal.json"),
            "passed": result["passed"],
        },
    )
    return result


if __name__ == "__main__":
    main()
