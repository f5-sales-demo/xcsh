"""Lifecycle of one installed executable acceptance attempt."""

from __future__ import annotations

import base64
import json
import re
import subprocess
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .common import (
    API_PATH,
    NEGATIVE_SCENARIOS,
    PROMPT,
    SHELL_COMMAND,
    AcceptanceError,
    Json,
    digest,
    fail,
    write_json,
)
from .credentials import credential_is_absent
from .fixtures import Fixture
from .profiles import (
    bang_command,
    expected_for,
    make_profile,
    messages_in,
    namespace_command,
    observe_profile,
)
from .terminal import Terminal
from .validation import validate_evidence

if TYPE_CHECKING:
    import pathlib

PLUGIN_FIXTURE = """import fs from 'node:fs';
export default function fixture(pi) {
  const keys = ['XCSH_API_URL', 'XCSH_API_TOKEN', 'XCSH_NAMESPACE', 'XCSH_USERNAME', 'XCSH_REGION', 'XCSH_STALE'];
  const original = new Map(keys.map(key => [key, process.env[key]]));
  process.on('exit', () => fs.writeFileSync(process.env.INSTALLED_E2E_PLUGIN_LOG + '.restored', JSON.stringify({
    environmentRestored: keys.every(key => process.env[key] === original.get(key))
  })));
  pi.integrations.register({
    id: 'context-fixture', name: 'Synthetic context fixture', plugin: 'context-fixture', kind: 'local',
    probe: async () => {
      fs.writeFileSync(process.env.INSTALLED_E2E_PLUGIN_LOG, JSON.stringify({
        namespace: process.env.XCSH_NAMESPACE,
        tokenMatches: process.env.XCSH_API_TOKEN === process.env.INSTALLED_E2E_PLUGIN_EXPECTED_TOKEN,
        loginAbsent: process.env.XCSH_USERNAME === undefined,
        regionAbsent: process.env.XCSH_REGION === undefined,
        timeout: process.env.XCSH_PLUGIN_GIT_TIMEOUT_MS
      }));
      if (process.env.INSTALLED_E2E_PLUGIN_FAIL === '1') throw new Error('Synthetic plugin failure');
      return {state: 'ready'};
    }
  });
}
"""


@dataclass
class RunOptions:
    """Bind all scenarios to one executable and artifact identity."""

    executable: pathlib.Path
    output: pathlib.Path
    backend: str
    fingerprint: Json
    tls: pathlib.Path
    token: str | None


@dataclass
class ProfileState:
    """Saved configuration bytes and current session offsets."""

    profile: pathlib.Path
    cwd: pathlib.Path
    env: dict[str, str]
    args: list[str]
    contexts: pathlib.Path = field(init=False)
    pointer: pathlib.Path = field(init=False)
    saved: dict[str, bytes] = field(default_factory=dict)
    original_pointer: bytes | None = None
    start: int = 0
    network_start: int = 0


@dataclass
class RunEvidence:
    """Private observations and pending independent validation batches."""

    receipt: Json
    observations: Json = field(
        default_factory=lambda: {
            "savedProfilesUnchanged": False,
            "startupPointerUnchanged": False,
            "selectionFeedback": False,
            "selectionBorder": False,
            "selectionNetworkFree": True,
            "externalRgExecutions": 0,
            "evidenceComplete": False,
        }
    )
    evaluations: list[tuple[list[Json], list[Json], Json]] = field(default_factory=list)
    selection_start: int = 0


class ScenarioRun:
    """Own the lifecycle and evidence for exactly one fresh-profile attempt."""

    def __init__(self, options: RunOptions, scenario: str, repetition: int) -> None:
        """Create one evidence directory and independent transport fixture."""
        self.options, self.scenario = options, scenario
        self.run_name = scenario + "-" + str(repetition)
        self.private = options.output / "private" / self.run_name
        self.private.mkdir(parents=True, mode=0o700)
        self.fixture = Fixture(self.private, options.tls, scenario)
        self.terminal: Terminal | None = None
        self.state: ProfileState
        self.evidence = RunEvidence(
            dict(
                options.fingerprint,
                backend=options.backend,
                scenario=scenario,
                repetition=repetition,
                result="fail",
            )
        )

    @property
    def active_terminal(self) -> Terminal:
        """Return the active terminal only within its owned lifecycle."""
        if self.terminal is None:
            fail("terminal lifecycle is inactive")
        return self.terminal

    def execute(self) -> Json:
        """Run once, preserve failures, then check privacy after shutdown."""
        try:
            self.initialize()
            self.select()
            self.reject_invalid()
            self.plugin()
            self.override()
            self.active_terminal.send(self.prompt() + "\r")
            self.admit()
            self.completion()
            self.evaluate()
            self.subsequent()
            self.finalize()
        except (
            AcceptanceError,
            OSError,
            ValueError,
            TypeError,
            KeyError,
            subprocess.SubprocessError,
        ) as error:
            (self.private / "failure.txt").write_text(
                type(error).__name__ + ": " + str(error) + "\n"
            )
            self.evidence.receipt.update(
                result="fail", failure="acceptance evidence incomplete or disagreed"
            )
        finally:
            self.cleanup()
        return self.evidence.receipt

    def initialize(self) -> None:
        """Initialize one fresh installed acceptance scenario."""
        profile, cwd, env, args = make_profile(
            self.private,
            self.fixture,
            self.options.executable,
            self.options.backend,
            self.options.tls,
            self.options.token,
        )
        self.state = ProfileState(profile=profile, cwd=cwd, env=env, args=args)
        self.state.contexts = self.state.profile / "xdg-config/xcsh/contexts"
        self.state.pointer = self.state.contexts.parent / "active_context"
        self.state.saved = {
            p.name: p.read_bytes() for p in self.state.contexts.glob("*.json")
        }
        self.state.original_pointer = (
            self.state.pointer.read_bytes() if self.state.pointer.exists() else None
        )
        write_json(
            self.private / "persistence-before.json",
            {
                "profiles": {
                    name: base64.b64encode(value).decode()
                    for name, value in self.state.saved.items()
                },
                "pointer": base64.b64encode(self.state.original_pointer).decode()
                if self.state.original_pointer is not None
                else None,
            },
        )
        self.terminal = Terminal(
            self.state.args, self.state.env, self.state.cwd, self.private
        )
        self.active_terminal.wait(
            lambda: "\x1b[?2004h" in self.active_terminal.raw, "input-handler"
        )
        if self.state.original_pointer:
            self.active_terminal.wait(
                lambda: "127:example-old" in self.active_terminal.screen.text(),
                "startup-context",
            )
        self.active_terminal.settle(1.5)
        startup_text = (
            ("127:example-old",)
            if self.state.original_pointer
            else ("127:example-env",)
            if self.scenario.startswith("environment")
            else ()
        )
        self.active_terminal.capture("startup", required=startup_text)

    def select(self) -> None:
        """Select one fresh installed acceptance scenario."""
        self.evidence.selection_start = len(self.fixture.events.requests)
        if self.scenario == "offline":
            self.fixture.close_tenant()
        if self.scenario in ("transition", "cached-shell"):
            if self.scenario == "cached-shell":
                bang_command(
                    self.active_terminal,
                    "export XCSH_STALE=cached-stale XCSH_REGION=cached-region XCSH_PLUGIN_GIT_TIMEOUT_MS=1234; cat prime-marker.txt",
                    self.fixture.state.cache_marker,
                )
            self.active_terminal.send("/context activate context-b\r")
            self.active_terminal.wait(
                lambda: "127:example-b" in self.active_terminal.screen.text(),
                "context-b-border",
            )
            self.active_terminal.capture(
                "context-b-selected", required=("127:example-b", "context-b")
            )
            self.active_terminal.settle(1)
            self.evidence.observations.update(
                selectionFeedback="Selected context-b" in self.active_terminal.raw,
                selectionBorder="127:example-b" in self.active_terminal.screen.text(),
            )
        elif self.scenario.startswith("environment") or self.scenario == "no-context":
            if self.scenario == "no-context":
                self.active_terminal.send("/context namespace default\r")
                self.active_terminal.wait(
                    lambda: "No active context" in self.active_terminal.screen.text(),
                    "no-context-rejection",
                )
                self.evidence.observations.update(
                    selectionFeedback=True,
                    selectionBorder="127:" not in self.active_terminal.screen.text(),
                )
                self.active_terminal.capture(
                    "no-context-rejection",
                    required=("No active context",),
                    forbidden=("Unhandled Rejection",),
                )
            else:
                self.evidence.observations.update(
                    selectionFeedback=True,
                    selectionBorder="127:example-env"
                    in self.active_terminal.screen.text(),
                )
        elif self.scenario == "nonexistent":
            self.active_terminal.send("/context activate nonexistent-fixture\r")
            self.active_terminal.wait(
                lambda: "not found" in self.active_terminal.screen.text().lower(),
                "nonexistent-rejection",
            )
            self.evidence.observations.update(
                selectionFeedback=True,
                selectionBorder="127:example-old" in self.active_terminal.screen.text(),
            )
            self.active_terminal.capture(
                "nonexistent-rejection", required=("not found", "127:example-old")
            )
            if self.state.pointer.read_bytes() != self.state.original_pointer:
                fail("nonexistent activation changed selection")
        elif not self.scenario.startswith("admitted-"):
            self.evidence.observations["selectionNetworkFree"] = namespace_command(
                self.active_terminal,
                self.fixture,
                guided=self.scenario in ("guided", "guided-manual", "cancelled"),
                manual=self.scenario == "guided-manual",
                cancel=self.scenario == "cancelled",
            )
            self.evidence.observations.update(
                selectionFeedback=True,
                selectionBorder=(
                    "127:example-old" if self.scenario == "cancelled" else "127:default"
                )
                in self.active_terminal.screen.text(),
            )
            if self.scenario == "repeated":
                self.evidence.observations["selectionNetworkFree"] &= namespace_command(
                    self.active_terminal, self.fixture
                )

    def reject_invalid(self) -> None:
        """Reject_invalid one fresh installed acceptance scenario."""
        if self.scenario == "missing-token":
            before_invalid = len(self.fixture.events.requests)
            self.active_terminal.send("/context activate context-b\r")
            self.active_terminal.wait(
                lambda: "not found or invalid" in self.active_terminal.screen.text(),
                "invalid-required-profile",
            )
            self.evidence.observations["requiredProfileRejected"] = (
                "127:default" in self.active_terminal.screen.text()
                and self.state.pointer.read_bytes() == self.state.original_pointer
            )
            self.evidence.observations["selectionNetworkFree"] &= (
                len(self.fixture.events.requests) == before_invalid
            )
            self.active_terminal.capture(
                "invalid-required-profile",
                required=("not found or invalid", "127:default"),
            )
        if self.scenario in ("nonexistent", "no-context"):
            self.evidence.observations["selectionNetworkFree"] = (
                len(self.fixture.events.requests) == self.evidence.selection_start
            )
        if self.scenario == "refused":
            # A listener is actually removed; a fake HTTP status cannot prove connection refusal.
            self.fixture.close_tenant()

    def plugin(self) -> None:
        """Plugin one fresh installed acceptance scenario."""
        if self.scenario.startswith("plugin-"):
            extension = (
                self.state.profile / "config/agent/extensions/context-fixture.js"
            )
            extension.parent.mkdir(mode=0o700)
            extension.write_text(PLUGIN_FIXTURE)
            plugin_log = self.private / "plugin-context.json"
            child_env = dict(
                self.state.env,
                INSTALLED_E2E_PLUGIN_LOG=str(plugin_log),
                INSTALLED_E2E_PLUGIN_EXPECTED_TOKEN=self.fixture.state.tokens[
                    "context-b"
                ],
                INSTALLED_E2E_PLUGIN_FAIL="1"
                if self.scenario == "plugin-failure"
                else "0",
            )
            child_env.pop("OPENAI_CODEX_OAUTH_TOKEN", None)
            child = subprocess.run(  # noqa: S603 - validated CLI path and task-owned fixture argv, no shell
                [
                    str(self.options.executable),
                    "plugin",
                    "status",
                    "context-fixture",
                    "--context",
                    "context-b",
                    "--json",
                ],
                env=child_env,
                cwd=self.state.cwd,
                capture_output=True,
                check=False,
                timeout=30,
            )
            (self.private / "plugin.stdout").write_bytes(child.stdout)
            (self.private / "plugin.stderr").write_bytes(child.stderr)
            if child.returncode:
                fail("plugin fixture command did not run")
            actual = json.loads(plugin_log.read_text())
            self.evidence.observations["pluginEnvironmentRestored"] = (
                json.loads(
                    plugin_log.with_name(plugin_log.name + ".restored").read_text()
                ).get("environmentRestored")
                is True
            )
            self.evidence.observations["pluginEffectiveContext"] = actual == {
                "namespace": "example-b",
                "tokenMatches": True,
                "loginAbsent": True,
                "regionAbsent": True,
                "timeout": "1234",
            }
            states = json.loads(child.stdout)["integrations"]
            if len(states) != 1 or states[0]["state"] != (
                "error" if self.scenario == "plugin-failure" else "ready"
            ):
                fail("plugin success/failure was not observed")
            self.active_terminal.settle()
            self.active_terminal.capture("after-plugin-child")
            self.evidence.observations["parentContextPreserved"] = (
                "127:default" in self.active_terminal.screen.text()
            )

    def override(self) -> None:
        """Override one fresh installed acceptance scenario."""
        if self.scenario == "override":
            bang_command(
                self.active_terminal,
                "XCSH_NAMESPACE=command-override sh -c 'printf OVERRIDE=%s \"$XCSH_NAMESPACE\"'",
                "OVERRIDE=command-override",
            )

    def prompt(self) -> str:
        """Prompt one fresh installed acceptance scenario."""
        self.state.start = len(messages_in(self.state.profile))
        self.state.network_start = len(self.fixture.events.requests)
        prompt = PROMPT
        if self.scenario.startswith("search-"):
            pattern = (
                "needle"
                if self.scenario == "search-match"
                else "absent-pattern"
                if self.scenario == "search-no-match"
                else "["
            )
            prompt = (
                "Inspect current context with xcsh_context status. Use bash with exactly this command: "
                + SHELL_COMMAND
                + "\n"
                "Use the native grep tool with path exactly search.txt and pattern exactly "
                + json.dumps(pattern)
                + ". Return only one JSON object with namespace, outcome (match, no-match or invalid), "
                "and matchingContent (the exact file line content for match, or an empty string)."
            )
            child = subprocess.run(  # noqa: S603 - validated CLI path and task-owned fixture argv, no shell
                [str(self.options.executable), "grep", pattern, "search.txt"],
                env=self.state.env,
                cwd=self.state.cwd,
                capture_output=True,
                check=False,
                timeout=30,
            )
            (self.private / "cli-search.stdout").write_bytes(child.stdout)
            (self.private / "cli-search.stderr").write_bytes(child.stderr)
            if child.returncode != (1 if self.scenario == "search-invalid" else 0):
                fail("CLI native search exit status differs")
            if (
                self.scenario == "search-match"
                and self.fixture.state.search_marker.encode() not in child.stdout
            ):
                fail("CLI native search missed fixture")
            if (
                self.scenario == "search-no-match"
                and self.fixture.state.search_marker.encode() in child.stdout
            ):
                fail("CLI native search invented match")
            if self.scenario == "search-invalid" and child.returncode == 0:
                fail("CLI accepted invalid regex")
            if self.scenario == "search-invalid" and not re.search(
                rb"regex|pattern|parse", child.stderr, re.IGNORECASE
            ):
                fail("CLI did not report a pattern diagnostic")
            if self.scenario != "search-invalid" and not re.search(
                rb"Total matches:\s*"
                + (b"1" if self.scenario == "search-match" else b"0")
                + rb"\b",
                child.stdout,
            ):
                fail("CLI native match count differs")
        if self.scenario == "environment-name-guard":
            prompt += " Guard the API call for saved context context-a."
        if any(
            marker in prompt
            for marker in [
                *self.fixture.state.markers,
                self.fixture.state.search_marker,
            ]
        ):
            fail("oracle marker leaked into prompt")
        return prompt

    def admit(self) -> None:
        """Admit one fresh installed acceptance scenario."""
        if self.scenario.startswith("admitted-"):
            self.active_terminal.wait(
                self.fixture.gates.gated.is_set, "admitted-a-request", seconds=120
            )
            if self.scenario == "admitted-context":
                self.active_terminal.send("/context activate context-b\r")
                self.active_terminal.wait(
                    lambda: "127:example-b" in self.active_terminal.screen.text(),
                    "b-border-during-a",
                )
            else:
                self.evidence.observations["selectionNetworkFree"] = namespace_command(
                    self.active_terminal, self.fixture
                )
            self.active_terminal.capture(
                "b-selected-a-running",
                required=(
                    "127:example-b"
                    if self.scenario == "admitted-context"
                    else "127:default",
                ),
            )
            self.evidence.observations.update(
                selectionFeedback=True, selectionBorder=True
            )
            self.fixture.gates.release.set()

    def completed(self) -> bool:
        """Completed one fresh installed acceptance scenario."""
        messages = messages_in(self.state.profile)[self.state.start :]
        return (
            bool(messages)
            and messages[-1].get("role") == "assistant"
            and messages[-1].get("stopReason") in ("stop", "error", "aborted", "length")
        )

    def completion(self) -> None:
        """Completion one fresh installed acceptance scenario."""
        self.active_terminal.wait(self.completed, "completed-agent-turn", seconds=180)
        self.active_terminal.settle()
        final_namespace = (
            "example-b"
            if self.scenario in ("transition", "cached-shell", "admitted-context")
            else "example-old"
            if self.scenario in ("cancelled", "nonexistent")
            else "example-env"
            if self.scenario.startswith("environment")
            else None
            if self.scenario == "no-context"
            else "default"
        )
        self.active_terminal.capture(
            "completion",
            required=("127:" + final_namespace,) if final_namespace else (),
            forbidden=("Unhandled Rejection",),
        )
        self.evidence.observations.update(
            observe_profile(
                self.state.profile,
                self.state.contexts,
                self.state.pointer,
                self.state.saved,
                self.state.original_pointer,
                self.fixture,
            )
        )
        self.evidence.observations["credentialNotRecorded"] = credential_is_absent(
            self.private, self.options.token
        )
        self.evidence.observations["bangCommandsCompleted"] = all(
            any(
                m.get("role") == "bashExecution"
                and m.get("command", "").strip() == command.strip()
                and m.get("exitCode") == 0
                and not m.get("cancelled")
                and not m.get("truncated")
                and marker in m.get("output", "")
                for m in messages_in(self.state.profile)
            )
            for command, marker in self.active_terminal.bang_obligations
        )

    def evaluate(self) -> None:
        """Evaluate one fresh installed acceptance scenario."""
        messages = messages_in(self.state.profile)[self.state.start :]
        self.evidence.evaluations.clear()
        expected = expected_for(self.scenario, self.fixture)
        requests = self.fixture.events.requests[self.state.network_start :]
        # Environment authority is deliberately distinct from saved-context identity.
        requests = [
            dict(r, context=None) if r["context"] == "environment" else r
            for r in requests
        ]
        if self.scenario.startswith("admitted-"):
            expected.update(
                namespace="example-old",
                context="context-a",
                shellValues=["NS=example-old"],
                requestCount=2,
                backendStatuses=[503, 200],
                url=self.fixture.urls["context-a"]
                + API_PATH.replace("{namespace}", "example-old"),
            )
            requests = [r for r in requests if "/http_loadbalancers" in r["path"]]
        if self.scenario in NEGATIVE_SCENARIOS:
            rejected = False
            try:
                validate_evidence(
                    self.evidence.receipt,
                    messages,
                    requests,
                    expected,
                    self.evidence.observations,
                )
            except AcceptanceError as error:
                intended = (
                    "required tool did not execute: xcsh_context"
                    if self.scenario == "provider-missing-tool"
                    else "incomplete assistant turn"
                )
                rejected = str(error) == intended
            if not rejected or not self.fixture.events.provider:
                fail("provider fault was not independently rejected")
            fault = self.scenario.removeprefix("provider-")
            if (
                fault not in self.fixture.events.provider_faults
                or any(
                    c.get("type") == "toolCall"
                    for m in messages
                    if m.get("role") == "assistant"
                    for c in m.get("content", [])
                )
                or requests
            ):
                fail("negative provider control executed unintended work")
            if (
                self.scenario != "provider-missing-tool"
                and messages[-1].get("stopReason") != "error"
            ):
                fail("provider transport fault did not report failure")
            self.evidence.receipt.update(
                result="pass", agentOutcome="rejected", negativeControl=True
            )
        else:
            self.evidence.evaluations.append((messages, requests, expected))
            self.evidence.receipt.update(
                validate_evidence(
                    self.evidence.receipt,
                    messages,
                    requests,
                    expected,
                    self.evidence.observations,
                )
            )

    def subsequent(self) -> None:
        """Subsequent one fresh installed acceptance scenario."""
        if self.scenario.startswith("admitted-"):
            self.state.start = len(messages_in(self.state.profile))
            self.state.network_start = len(self.fixture.events.requests)
            self.active_terminal.send(PROMPT + "\r")
            self.active_terminal.wait(self.completed, "completed-b-turn", seconds=180)
            self.active_terminal.settle()
            self.active_terminal.capture(
                "b-completion",
                required=(
                    "127:example-b"
                    if self.scenario == "admitted-context"
                    else "127:default",
                ),
            )
            expected = expected_for(
                "transition" if self.scenario == "admitted-context" else "explicit",
                self.fixture,
            )
            self.evidence.observations.update(
                observe_profile(
                    self.state.profile,
                    self.state.contexts,
                    self.state.pointer,
                    self.state.saved,
                    self.state.original_pointer,
                    self.fixture,
                )
            )
            second_messages = messages_in(self.state.profile)[self.state.start :]
            second_requests = self.fixture.events.requests[self.state.network_start :]
            self.evidence.evaluations.append(
                (second_messages, second_requests, expected)
            )
            second = validate_evidence(
                self.evidence.receipt,
                second_messages,
                second_requests,
                expected,
                self.evidence.observations,
            )
            self.evidence.receipt["subsequentAdmission"] = second

    def finalize(self) -> None:
        """Finalize one fresh installed acceptance scenario."""
        self.active_terminal.close()
        self.terminal = None
        self.fixture.close()
        self.evidence.observations.update(
            observe_profile(
                self.state.profile,
                self.state.contexts,
                self.state.pointer,
                self.state.saved,
                self.state.original_pointer,
                self.fixture,
            )
        )
        self.evidence.observations["credentialNotRecorded"] = credential_is_absent(
            self.private, self.options.token
        )
        for batch, transport, oracle in self.evidence.evaluations:
            validate_evidence(
                self.evidence.receipt,
                batch,
                transport,
                oracle,
                self.evidence.observations,
            )
        write_json(
            self.private / "persistence-after.json",
            {
                "profiles": {
                    p.name: base64.b64encode(p.read_bytes()).decode()
                    for p in self.state.contexts.glob("*.json")
                },
                "pointer": base64.b64encode(self.state.pointer.read_bytes()).decode()
                if self.state.pointer.exists()
                else None,
            },
        )
        write_json(self.private / "observations.json", self.evidence.observations)
        self.evidence.receipt["observations"] = self.evidence.observations

    def cleanup(self) -> None:
        """Cleanup one fresh installed acceptance scenario."""
        if self.terminal:
            self.terminal.close()
        self.fixture.close()
        self.evidence.observations["credentialNotRecorded"] = credential_is_absent(
            self.private, self.options.token
        )
        if not self.evidence.observations["credentialNotRecorded"]:
            self.evidence.receipt.update(
                result="fail", failure="credential privacy gate failed"
            )
        self.evidence.receipt["observations"] = self.evidence.observations
        self.evidence.receipt["evidence"] = {
            str(p.relative_to(self.private)): digest(p)
            for p in self.private.rglob("*")
            if self.evidence.observations["credentialNotRecorded"]
            and p.is_file()
            and (
                "profile" not in p.relative_to(self.private).parts
                or "sessions" in p.relative_to(self.private).parts
            )
        }
        write_json(
            self.options.output / "receipts" / (self.run_name + ".json"),
            self.evidence.receipt,
        )
