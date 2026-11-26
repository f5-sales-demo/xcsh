"""Installed executable acceptance: profiles."""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from typing import TYPE_CHECKING

from .common import API_PATH, Json, fail, write_json

if TYPE_CHECKING:
    import pathlib

    from .fixtures import Fixture
    from .terminal import Terminal


def messages_in(profile: pathlib.Path) -> list[Json]:
    """Read complete persisted messages while a session writer may still be active."""
    records = []
    for file in sorted((profile / "sessions").glob("**/*.jsonl")):
        data = file.read_bytes()
        # A partial writer record is not completion evidence. Retry until its newline appears.
        for line in data.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                continue
            record = json.loads(line)
            if record.get("type") == "message":
                records.append(record["message"])
    return records


def persisted_entries(profile: pathlib.Path) -> list[Json]:
    """Read all persisted session entries after a completed message."""
    return [
        json.loads(line)
        for file in sorted((profile / "sessions").glob("**/*.jsonl"))
        for line in file.read_text().splitlines()
    ]


def observe_profile(
    profile: pathlib.Path,
    contexts: pathlib.Path,
    pointer: pathlib.Path,
    saved: dict[str, bytes],
    expected_pointer: bytes | None,
    fixture: Fixture,
) -> Json:
    """Recheck saved bytes, transcript completeness and the recorded fallback sentinel."""
    files = sorted((profile / "sessions").glob("**/*.jsonl"))
    complete = bool(files) and all(file.read_bytes().endswith(b"\n") for file in files)
    thoughts = [
        entry.get("thinkingLevel")
        for entry in persisted_entries(profile)
        if entry.get("type") == "thinking_level_change"
    ]
    actual = {p.name: p.read_bytes() for p in contexts.glob("*.json")}
    return {
        "savedProfilesUnchanged": actual == saved,
        "startupPointerUnchanged": (pointer.read_bytes() if pointer.exists() else None)
        == expected_pointer,
        "externalRgExecutions": len(
            (profile / "external-rg.log").read_text().splitlines()
        )
        if (profile / "external-rg.log").exists()
        else 0,
        "evidenceComplete": complete,
        "inheritedFallbackUnused": not any(
            r.get("endpoint") == "inherited" for r in fixture.events.requests
        ),
        "thinkingLevel": thoughts[-1] if thoughts else None,
    }


def bang_command(terminal: Terminal, command: str, expected_output: str) -> None:
    """Observe non-echoed output now and retain obligations for lazy session persistence."""
    terminal.send("! " + command + "\r")
    terminal.wait(lambda: expected_output in terminal.screen.text(), "bang-output")
    terminal.settle()
    terminal.capture("bang-command")
    terminal.bang_obligations.append((command, expected_output))


def make_profile(
    private: pathlib.Path,
    fixture: Fixture,
    executable: pathlib.Path,
    backend: str,
    tls: pathlib.Path,
    token: str | None,
) -> tuple[pathlib.Path, pathlib.Path, dict[str, str], list[str]]:
    """Create a disposable profile containing only synthetic F5 configuration."""
    profile = private / "profile"
    agent = profile / "config/agent"
    cwd = profile / "project"
    for directory in (
        agent,
        cwd,
        profile / "sessions",
        profile / "bin",
        profile / "xdg-config/xcsh/contexts",
    ):
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    write_json(
        agent / "config.yml",
        {
            "startup": {"checkUpdate": False},
            "marketplace": {"autoUpdate": "off"},
            "memories": {"enabled": False},
            "theme": {"forceSlot": "dark"},
            "symbolPreset": "ascii",
        },
    )
    contexts = profile / "xdg-config/xcsh/contexts"
    for name in (
        ("context-a",)
        if fixture.scenario == "automatic-startup"
        else ("context-a", "context-b")
    ):
        values: Json = {
            "name": name,
            "apiUrl": fixture.urls[name],
            "apiToken": fixture.state.tokens[name],
            "defaultNamespace": "example-old" if name == "context-a" else "example-b",
        }
        if name == "context-a":
            values["env"] = {"XCSH_REGION": "region-a"}
        if fixture.scenario == "missing-token" and name == "context-b":
            values.pop("apiToken")
        write_json(contexts / (name + ".json"), values)
    pointer = contexts.parent / "active_context"
    if (
        not fixture.scenario.startswith("environment")
        and fixture.scenario != "no-context"
    ):
        pointer.write_text("context-a")
    env = {
        "PATH": str(profile / "bin") + ":" + os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(profile),
        "TERM": "xterm-256color",
        "LANG": "C.UTF-8",
        "PI_CODING_AGENT_DIR": str(agent),
        "PI_CONFIG_DIR": "config",
        "TMPDIR": str(profile),
        "NODE_EXTRA_CA_CERTS": str(tls / "certificate.pem"),
        "SHELL": "/bin/bash",
        "XCSH_API_URL": fixture.urls["inherited"],
        "XCSH_API_TOKEN": fixture.state.tokens["inherited"],
        "XCSH_NAMESPACE": "example-inherited",
        "XCSH_USERNAME": "synthetic-login",
        "XCSH_REGION": "inherited-region",
        "XCSH_STALE": "synthetic-stale",
        "XCSH_PLUGIN_GIT_TIMEOUT_MS": "1234",
        "XCSH_LOCALE": "en",
    }
    for kind in ("CONFIG", "CACHE", "DATA", "STATE"):
        env["XDG_" + kind + "_HOME"] = str(profile / ("xdg-" + kind.lower()))
    if fixture.scenario == "cached-shell":
        env.pop("XCSH_PLUGIN_GIT_TIMEOUT_MS")
    if fixture.scenario.startswith("environment"):
        env.update(
            XCSH_API_URL=fixture.urls["inherited"],
            XCSH_API_TOKEN=fixture.state.tokens["environment"],
            XCSH_NAMESPACE="example-env",
        )
        if fixture.scenario == "environment-missing-token":
            env.pop("XCSH_API_TOKEN")
        if fixture.scenario == "environment-name-guard":
            env["XCSH_CONTEXT_NAME"] = "context-a"
    elif fixture.scenario == "no-context":
        env = {k: v for k, v in env.items() if not k.startswith("XCSH_")}
    sentinel = profile / "bin/rg"
    sentinel.write_text(
        "#!/bin/sh\nprintf 'external rg invoked\\n' >> \"$HOME/external-rg.log\"\nexit 97\n"
    )
    sentinel.chmod(0o700)
    (cwd / "search.txt").write_text("needle " + fixture.state.search_marker + "\n")
    (cwd / "prime-marker.txt").write_text(fixture.state.cache_marker + "\n")
    args = [
        str(executable),
        "--no-extensions",
        "--no-skills",
        "--no-rules",
        "--no-lsp",
        "--no-mcp",
        "--no-title",
        "--no-memories",
        "--tools",
        "xcsh_context,xcsh_api,bash,grep",
        "--session-dir",
        str(profile / "sessions"),
    ]
    if pointer.exists() and fixture.scenario != "automatic-startup":
        args += ["--context", "context-a"]
    if backend == "deterministic":
        env["ANTHROPIC_API_KEY"] = "synthetic-provider-key"
        write_json(
            agent / "models.yml",
            {
                "providers": {
                    "anthropic": {
                        "baseUrl": fixture.provider_url,
                        "apiKey": "synthetic-provider-key",
                    }
                }
            },
        )
        args += ["--provider", "anthropic", "--model", "claude-sonnet-4-5"]
    else:
        if token is None:
            fail("live credential missing at child handoff")
        env["OPENAI_CODEX_OAUTH_TOKEN"] = token
        args += [
            "--provider",
            "openai-codex",
            "--model",
            "gpt-6.1-sol",
            "--thinking",
            "high",
        ]
    return profile, cwd, env, args


def namespace_command(
    terminal: Terminal,
    fixture: Fixture,
    namespace: str = "default",
    guided: bool = False,
    manual: bool = False,
    cancel: bool = False,
) -> bool:
    """Drive a real explicit or guided namespace command and observe its immediate outcome."""
    terminal.settle()
    before = len(fixture.events.requests)
    provider_before = len(fixture.events.provider)
    terminal.send("/context namespace" + ("" if guided else " " + namespace) + "\r")
    if guided:
        terminal.wait(
            lambda: "Session namespace" in terminal.screen.text(), "namespace-selector"
        )
        terminal.capture("selector", required=("Session namespace",))
        if cancel:
            terminal.send("\x1b")
            terminal.wait(
                lambda: (
                    "Session namespace" not in terminal.screen.text()
                    and "127:example-old" in terminal.screen.text()
                ),
                "cancelled-selector",
            )
            terminal.capture(
                "cancelled",
                required=("127:example-old",),
                forbidden=("Session namespace",),
            )
            return (
                len(fixture.events.requests) == before
                and len(fixture.events.provider) == provider_before
            )
        if manual:
            terminal.send("\x1b[B\x1b[B\r")
            terminal.wait(
                lambda: "Applies to future turns" in terminal.screen.text(),
                "manual-namespace-input",
            )
            terminal.capture(
                "manual-input",
                required=("Session namespace", "Applies to future turns"),
            )
            terminal.send("\x01\x0b" + namespace + "\r")
        else:
            terminal.send("\r")
    terminal.wait(
        lambda: (
            "Namespace " + namespace in terminal.screen.text()
            and "127:" + namespace in terminal.screen.text()
        ),
        "namespace-border-feedback",
    )
    terminal.capture(
        "selected", required=("Namespace " + namespace, "127:" + namespace)
    )
    terminal.settle()
    return (
        len(fixture.events.requests) == before
        and len(fixture.events.provider) == provider_before
    )


def expected_for(scenario: str, fixture: Fixture) -> Json:
    """Create the scenario oracle independently of assistant completion text."""
    namespace: str | None = "default"
    context: str | None = "context-a"
    status: int | None = 200
    if scenario in ("cancelled", "nonexistent"):
        namespace = "example-old"
    if scenario in ("transition", "cached-shell"):
        namespace, context = "example-b", "context-b"
    if scenario.startswith("environment"):
        namespace, context = "example-env", None
    if scenario == "no-context":
        namespace, context, status = None, None, None
    if scenario in ("environment-name-guard", "environment-missing-token"):
        status = None
    if scenario in ("offline", "timeout", "refused"):
        status = 0
    if scenario.startswith("http-"):
        status = int(scenario.split("-")[1])
    search = scenario.startswith("search-")
    expected: Json = {
        "tools": ["xcsh_context", "bash", "grep" if search else "xcsh_api"],
        "namespace": namespace,
        "context": context,
        "status": status,
        "markers": []
        if search or status != HTTPStatus.OK or scenario == "empty"
        else fixture.state.markers,
        "requestCount": 0
        if search or status is None or scenario in ("refused", "offline")
        else 2
        if status in (429, 503)
        else 1,
        "empty": scenario == "empty",
        "endpoint": "environment" if scenario.startswith("environment") else context,
    }
    if search:
        expected.update(
            grep=scenario[7:],
            searchMarker=fixture.state.search_marker,
            grepPattern="needle"
            if scenario == "search-match"
            else "absent-pattern"
            if scenario == "search-no-match"
            else "[",
            grepPath="search.txt",
        )
    if scenario == "environment-name-guard":
        expected["guard"] = "context-a"
    expected["plugin"] = scenario.startswith("plugin-")
    expected["bang"] = scenario in ("cached-shell", "override")
    if scenario == "missing-token":
        expected["invalidProfile"] = True
    if scenario in ("auth-error", "offline"):
        expected["authStatus"] = "auth_error"
    if scenario == "timeout":
        expected["backendStatuses"] = [None]
    if context:
        expected["shellValues"] = [
            "NS=" + (namespace or ""),
            "LOGIN=unset",
            "STALE=unset",
            "TIMEOUT=1234",
            "REGION=" + ("region-a" if context == "context-a" else "unset"),
        ]
    if not search and status is not None:
        endpoint = (
            fixture.urls["inherited"]
            if scenario.startswith("environment")
            else fixture.urls[context or "context-a"]
        )
        expected["url"] = endpoint + API_PATH.replace("{namespace}", namespace or "")
    if scenario == "timeout":
        expected["timeout"] = True
    return expected
