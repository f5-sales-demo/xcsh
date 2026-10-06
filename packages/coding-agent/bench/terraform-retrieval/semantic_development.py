# ruff: noqa: INP001, T201, TRY301, PLR2004
# TRY301: audit records invalid boundaries; PLR2004: fixed command arity.
"""Ubuntu subscription-only exposed development diagnostic; never qualification."""

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit


def valid_read_uri(uri: str) -> bool:
    """Accept only documented anchored exact reads and view parameters."""
    parsed = urlsplit(uri)
    query = parse_qs(parsed.query, keep_blank_values=True)
    return all(
        [
            parsed.scheme == "xcsh",
            parsed.netloc == "terraform-documentation",
            parsed.path.startswith("/documentation/"),
            parsed.path.endswith(".md"),
            ".." not in parsed.path.split("/"),
            bool(parsed.fragment),
            not parsed.query
            or (
                len(query) == 1
                and query.get("view") in (["hint"], ["context"], ["full"])
            ),
        ]
    )


def normalize(uri: str) -> str:
    """Retain the exact anchor while dropping only view parameters."""
    if not valid_read_uri(uri):
        return "invalid:" + uri
    parsed = urlsplit(uri)
    return urlunsplit(parsed._replace(query=""))


# pylint: disable=too-many-locals,too-many-branches,too-many-statements,too-many-boolean-expressions
# A single audit keeps command identity, execution and bytes in one pass.
def audit_commands(events: list[dict[str, Any]], prefix: list[str]) -> dict[str, Any]:
    """Measure actual complete command envelopes and reject helper bypasses."""
    started: dict[str, str] = {}
    completed: set[str] = set()
    violations: list[dict[str, Any]] = []
    reads = []
    outputs: list[dict[str, Any]] = []
    for event in events:
        item = event.get("item", {})
        if item.get("type") not in (
            None,
            "agent_message",
            "reasoning",
            "command_execution",
        ):
            violations.append({"reason": "non-helper-tool", "type": item.get("type")})
        if item.get("type") != "command_execution":
            continue
        identity = item.get("id")
        if not isinstance(identity, str) or not identity:
            violations.append({"reason": "invalid-command-id"})
            continue
        if event.get("type") == "item.started":
            if identity in started:
                violations.append({"reason": "duplicate-command-start", "id": identity})
            started[identity] = item.get("command", "")
            continue
        if event.get("type") != "item.completed":
            continue
        if identity in completed:
            violations.append({"reason": "duplicate-command-result", "id": identity})
        if identity not in started or started[identity] != item.get("command"):
            violations.append({"reason": "unpaired-command-result", "id": identity})
        completed.add(identity)
        try:
            command = item["command"]
            argv = shlex.split(command)
            if (
                len(argv) == 3
                and argv[0] in ("/bin/zsh", "/bin/bash", "/bin/sh")
                and argv[1] in ("-lc", "-c")
            ):
                command = argv[2]
                argv = shlex.split(command)
            if command != shlex.join(argv):
                message = "Canonical escaped helper argv required"
                raise ValueError(message)
            operation = argv[len(prefix)] if len(argv) > len(prefix) else ""
            valid = argv[: len(prefix)] == prefix and (
                (
                    operation == "candidates"
                    and len(argv) in (len(prefix) + 2, len(prefix) + 3)
                )
                or (
                    operation in ("read", "search", "discover")
                    and len(argv) == len(prefix) + 2
                )
            )
            if not valid:
                message = "Helper-only single-operation command required"
                raise ValueError(message)
            value = argv[len(prefix) + 1]
            if operation == "candidates" and len(argv) == len(prefix) + 3:
                offset = int(argv[-1])
                if offset < 0:
                    message = "Invalid offset"
                    raise ValueError(message)
            uri = urlsplit(value) if operation == "read" else None
            view = parse_qs(uri.query).get("view", ["full"])[0] if uri else "discovery"
            if uri and not valid_read_uri(value):
                message = "Invalid exact read URI"
                raise ValueError(message)
            if operation == "discover":
                destination = urlsplit(value)
                if (
                    destination.scheme != "xcsh"
                    or destination.netloc != "terraform-documentation"
                    or destination.path not in ("", "/")
                    or destination.fragment
                ):
                    message = "Invalid discovery continuation URI"
                    raise ValueError(message)
            output = item["aggregated_output"]
            response = json.loads(output)
            if not isinstance(response, dict) or response.get("status") not in (
                "complete",
                "oversized",
            ):
                message = "Helper returned an error or unsupported status"
                raise ValueError(message)
            envelope = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
            size = len(envelope.encode("utf-8"))
            budget = (
                4096
                if view in ("discovery", "hint")
                else 16384
                if view == "context"
                else None
            )
            outputs.append(
                {
                    "id": identity,
                    "operation": operation,
                    "value": value,
                    "output_bytes": len(output.encode("utf-8")),
                    "envelope_bytes": size,
                    "budget_bytes": budget,
                }
            )
            if budget and size > budget:
                violations.append(
                    {
                        "reason": "response-budget-exceeded",
                        "id": identity,
                        "bytes": size,
                        "budget": budget,
                    }
                )
            if item.get("exit_code") != 0:
                message = "Helper command failed"
                raise ValueError(message)
            if (
                operation == "read"
                and response.get("status") == "complete"
                and response.get("uri") == value
                and isinstance(response.get("content"), str)
                and bool(response["content"].strip())
                and response.get("development_only") is True
                and response.get("qualification_passed") is False
                and (budget is None or size <= budget)
                and identity in started
                and started[identity] == item.get("command")
                and view in ("context", "full")
            ):
                reads.append(value)
        except (KeyError, ValueError, TypeError, UnicodeError) as error:
            violations.append(
                {
                    "reason": "invalid-helper-result",
                    "id": identity,
                    "detail": str(error),
                }
            )
    violations.extend(
        {"reason": "incomplete-command", "id": identity}
        for identity in started.keys() - completed
    )
    if not completed:
        violations.append({"reason": "no-helper-results"})
    return {
        "passed": not violations,
        "successful_reads": reads,
        "tool_calls": len(completed),
        "outputs": outputs,
        "max_envelope_bytes": max(
            (row["envelope_bytes"] for row in outputs), default=0
        ),
        "total_envelope_bytes": sum(row["envelope_bytes"] for row in outputs),
        "violations": violations,
    }


def main() -> None:
    """Sanitize prompts, pin source inputs, execute on Ubuntu and audit traces."""
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("suite", "index", "assets", "output"):
        parser.add_argument("--" + option, type=Path, required=True)
    parser.add_argument("--ids", required=True)
    parser.add_argument("--regression", action="store_true", required=True)
    parser.add_argument("--codex", default="/home/robin/.local/bin/codex")
    parser.add_argument("--bun", default="/home/robin/.bun/bin/bun")
    args = parser.parse_args()
    if os.uname().sysname != "Linux":
        message = "Iterative model diagnostics must run on Ubuntu"
        raise RuntimeError(message)
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("OPENAI_", "LITELLM_"))
    }
    status = subprocess.run(  # noqa: S603 - trusted local executable passed as argv
        [args.codex, "login", "status"],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    if "Logged in using ChatGPT" not in status.stdout + status.stderr:
        message = "ChatGPT subscription login required"
        raise RuntimeError(message)
    args.output.mkdir(exist_ok=False, parents=True)
    raw = args.suite.read_bytes()
    suite = json.loads(raw)
    if isinstance(suite, dict):
        suite = suite["cases"]
    identifiers = args.ids.split(",")
    selected = [
        next(case for case in suite if case["id"] == identity)
        for identity in identifiers
    ]
    sanitized = [{"id": case["id"], "prompt": case["prompt"]} for case in selected]
    (args.output / "input.json").write_text(
        json.dumps(sanitized, ensure_ascii=False) + "\n"
    )
    config = {
        "index": str(args.index.resolve()),
        "assets": str(args.assets.resolve()),
        "input": str((args.output / "input.json").resolve()),
    }
    config_path = args.output.resolve() / "config.json"
    config_path.write_text(json.dumps(config) + "\n")
    helper = Path(__file__).with_name("semantic-development-helper.ts").resolve()
    prefix = [args.bun, str(helper), str(config_path)]
    retrieval_files = sorted(
        helper.parents[2].joinpath("src/internal-urls").glob("terraform-*.ts")
    )
    if not retrieval_files:
        message = "Missing retrieval source binding"
        raise RuntimeError(message)
    bound_files = [
        helper.parents[2] / "src/internal-urls/documentation-metadata.ts",
        config_path,
        Path(config["input"]),
        Path(__file__).resolve(),
        helper,
        helper.with_name("semantic-development-context.ts"),
        *retrieval_files,
        args.index,
        args.assets,
        args.suite,
    ]
    hashes = {}
    for file in bound_files:
        with file.open("rb") as handle:
            hashes[str(file)] = hashlib.file_digest(handle, "sha256").hexdigest()
    head = subprocess.check_output(
        ["/usr/bin/git", "rev-parse", "HEAD"], text=True
    ).strip()
    binding = {
        "suite_sha256": hashlib.sha256(raw).hexdigest(),
        "index_sha256": hashlib.file_digest(
            args.index.open("rb"), "sha256"
        ).hexdigest(),
        "assets_sha256": hashlib.sha256(args.assets.read_bytes()).hexdigest(),
        "helper_sha256": hashlib.sha256(helper.read_bytes()).hexdigest(),
        "context_sha256": hashlib.sha256(
            helper.with_name("semantic-development-context.ts").read_bytes()
        ).hexdigest(),
        "consumer_commit": head,
        "source_files_sha256": hashes,
        "evaluator_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "retrieval_sources_sha256": hashlib.sha256(
            b"".join(
                path.as_posix().encode() + b"\0" + path.read_bytes() + b"\0"
                for path in sorted(
                    helper.parents[2]
                    .joinpath("src/internal-urls")
                    .glob("terraform-*.ts")
                )
            )
        ).hexdigest(),
    }
    prompt = (
        "Read-only exposed development diagnostic. No edits, web, contacts, subagents, "
        "HCL or other file reads. Expected answers withheld; provider scope is inferred "
        "by the helper from the question. Resolve cases "
        + args.ids
        + ". Use ONLY this exact helper prefix for all tool calls: "
        + shlex.join(prefix)
        + ". Operations: candidates CASE_ID [OFFSET] (start at zero; follow next_offset to "
        "inspect alternatives); read EXACT_URI (use view=context and the exact anchor); "
        "search QUERY (bounded consumer discovery for a reformulated question); "
        "discover EXACT_ROOT_URI (follow returned node/filter/choice continuations). "
        "One helper operation per tool call; no batching, pipelines, concatenation, "
        "direct SQLite or other shell commands. Candidate discovery is mechanically "
        "bounded to 4KiB; context to16KiB including envelope reserve. Oversized records "
        "provide exact read destinations. Read the chosen complete leaf section before "
        "selecting and compare relevant parent/alternative sections. If candidates omit "
        "the target, reformulate using search before reporting a retrieval gap. Clarify only "
        "genuinely absent information; do not invent unsupported fields or apply "
        "evidence. Return JSON "
        "{results:[{id,selected_uri,clarification,reason,evidence_uris}]} only. "
        "Negative/control cases may use selected_uri:null. This is development, not "
        "installed UAT or qualification."
    )
    start = time.monotonic()
    with (
        (args.output / "events.jsonl").open("w") as log,
        (args.output / "stderr.log").open("w") as err,
    ):
        process = subprocess.run(  # noqa: S603 - trusted CLI, no shell interpolation
            [
                args.codex,
                "exec",
                "-s",
                "read-only",
                "-c",
                'model_provider="openai"',
                "-c",
                'forced_login_method="chatgpt"',
                "--json",
                "-o",
                str(args.output / "result.json"),
                prompt,
            ],
            env=env,
            stdout=log,
            stderr=err,
            check=False,
        )
    events = [
        json.loads(line)
        for line in (args.output / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    audit = audit_commands(events, prefix)
    for file in bound_files:
        with file.open("rb") as handle:
            if hashlib.file_digest(handle, "sha256").hexdigest() != hashes[str(file)]:
                audit["violations"].append(
                    {"reason": "source-changed-during-run", "path": str(file)}
                )
                audit["passed"] = False
    result = json.loads((args.output / "result.json").read_text())
    actual = {normalize(uri) for uri in audit["successful_reads"]}
    rows = []
    for case in selected:
        matches = [row for row in result["results"] if row.get("id") == case["id"]]
        answer = matches[0] if len(matches) == 1 else {}
        uri = answer.get("selected_uri")
        rows.append(
            {
                "id": case["id"],
                "kind": case["kind"],
                "selected_uri": uri,
                "expected_destination_match": isinstance(uri, str)
                and normalize(uri) in {normalize(want) for want in case["expected"]},
                "selected_leaf_read": isinstance(uri, str) and normalize(uri) in actual,
                "clarification": answer.get("clarification"),
            }
        )
    receipt = {
        "development_only": True,
        "qualification_passed": False,
        "scope_supplied": False,
        "expected_answers_withheld": True,
        "execution_route": "Ubuntu Codex ChatGPT login",
        "exit_code": process.returncode,
        "model_network_wall_ms": (time.monotonic() - start) * 1000,
        **binding,
        "events_sha256": hashlib.sha256(
            (args.output / "events.jsonl").read_bytes()
        ).hexdigest(),
        "audit": audit,
        "cases": rows,
        "remaining": (
            "Independent benchmark, installed UAT and publication gates remain unmet; "
            "ambiguous/control semantic correctness requires review."
        ),
    }
    (args.output / "receipt.json").write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {
                "exit_code": process.returncode,
                "audit_passed": audit["passed"],
                "cases": rows,
            }
        )
    )


if __name__ == "__main__":
    main()
