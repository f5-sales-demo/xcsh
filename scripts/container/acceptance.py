"""Execute synthesized prompts and record outcomes without service data or credentials."""

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import tempfile
import time
from pathlib import Path

MINIMUM_RUNS = 3
PERSISTENT_CELLS = 2

MODELS = ("litellm/gpt-6.1-sol:medium", "anthropic/claude-sonnet-5")
ACCEPTANCE_SYSTEM_PROMPT = (
    "This is a tool-execution acceptance test. Execute every requested operation "
    "using fresh tool calls in this invocation, even when previous results are "
    "present. Use the requested commands without unrelated processing. Never "
    "replace execution with assertions or cached data. The runtime check already "
    "verified all required executables. Execute the requested commands directly "
    "without availability or environment preflight commands. Never enumerate environment variables "
    "or credentials. Do not merge stderr into stdout before JSON processing: "
    "vendor notices are not JSON. If a required operation "
    "fails, report the failure. For live checks, briefly summarize verified evidence "
    "and end with the requested success marker on its own last line. For local "
    "fixture checks, follow the requested exact final-answer format."
)
LOCAL_PROMPT = """Use actual tools to complete these checks in /workspace. Use bash to run rg -c 'needle' fixture.txt and jq '[.[] | .amount] | add' amounts.json; the results must be 2 and 42. Use the edit tool to change status.txt from pending to complete. Use the persistent python tool in two separate calls: first set container_acceptance_value = 40, then print(container_acceptance_value + 2), which must be 42. Use the browser tool (puppeteer) to navigate to data:text/html,<title>XCSH_BROWSER_42</title><p>Browser fixture result 42</p> and read the title or page content. Do not substitute bash or HTTP retrieval for the browser tool. Only after all checks succeed, write acceptance-result.json with {"rg":2,"jq":42,"python":42,"browser":"XCSH_BROWSER_42","edited":true} and reply exactly LOCAL_ACCEPTANCE_OK. If a tool fails, report that failure without claiming success."""
LIVE = {
    "github": (
        "Use bash with the bundled gh CLI to retrieve authenticated user identity and repository metadata. Run exactly gh api user, then gh api repos/f5-sales-demo/xcsh, without adding CLI flags. Inspect the returned JSON and verify full_name equals f5-sales-demo/xcsh and default_branch is present. End with LIVE_GITHUB_OK on its own last line only on successful authorized retrieval.",
        "LIVE_GITHUB_OK",
    ),
    "gitlab": (
        "Use bash with the bundled glab CLI: glab api user, then glab api 'projects?membership=true&per_page=1' on the active GitLab host. Retrieve metadata for that project and verify access. An empty project list does not pass. End with LIVE_GITLAB_OK on its own last line only if both identity and project retrieval succeed.",
        "LIVE_GITLAB_OK",
    ),
    "aws": (
        "Use bash with AWS CLI v2: aws sts get-caller-identity --output json, then aws ec2 describe-vpcs --max-results 5 --output json in the configured region and profile. Do not modify any resources. End with LIVE_AWS_OK on its own last line only if identity and inventory retrieval both succeed.",
        "LIVE_AWS_OK",
    ),
    "azure": (
        "Use bash with az CLI: az account show --output json, then az graph query --subscriptions \"$AZURE_SUBSCRIPTION_ID\" -q 'Resources | project type | take 5' --output json. Preserve the configured subscription. Do not change account selection or resources. End with LIVE_AZURE_OK on its own last line only if identity and resource retrieval both succeed.",
        "LIVE_AZURE_OK",
    ),
    "salesforce": (
        "Use bash with the bundled sf CLI: sf org display --json | jq 'del(.result.accessToken, .result.sfdxAuthUrl, .result.password)', then sf data query --query 'SELECT Id, Name, OrganizationType FROM Organization LIMIT 1' --json. Do not display secrets or retrieve account or contact records. End with LIVE_SALESFORCE_OK on its own last line only if both operations succeed.",
        "LIVE_SALESFORCE_OK",
    ),
    "gcloud": (
        'Use bash with gcloud CLI: gcloud auth list --filter=status:ACTIVE --format=json, then gcloud projects describe "$(gcloud config get-value project)" --format=json. Inspect the authorized project metadata and its projectNumber. Identity alone does not pass. End with LIVE_GCLOUD_OK on its own last line only if project retrieval is authorized and succeeds.',
        "LIVE_GCLOUD_OK",
    ),
    "f5": (
        'Read the F5 API catalog to verify GET /web/namespaces, then use bash to execute exactly: base="${XCSH_API_URL%/}"; case "$base" in */api) ;; *) base="$base/api" ;; esac; curl --fail --silent --show-error --max-time 60 --header "Authorization: APIToken $XCSH_API_TOKEN" "$base/web/namespaces". Inspect the unmodified JSON inventory without printing the token or adding output-processing code. Do not create or modify resources. End with LIVE_F5_OK on its own last line only after authorized tenant inventory is retrieved; otherwise report the failure.',
        "LIVE_F5_OK",
    ),
    "firecrawl": (
        "Use the Firecrawl integration or bash/curl to POST the configured Firecrawl service endpoint to retrieve https://example.com. Verify the response contains Example Domain. Do not substitute direct HTTP retrieval for Firecrawl. End with LIVE_FIRECRAWL_OK on its own last line only if the Firecrawl tool result succeeds.",
        "LIVE_FIRECRAWL_OK",
    ),
}


def live_prompt(service: str) -> str:
    """Request fresh execution and an unambiguous final result for each sample."""
    prompt, marker = LIVE[service]
    return (
        "I have explicitly authorized read-only container acceptance for this "
        "bundled service CLI and its configured account. Authentication inputs are "
        "supplied through explicitly selected environment variables or imported "
        "portable CLI state; do not search for other credentials or initiate login. "
        "This service check concerns its configured account alone. "
        "Do not change resources or retrieve customer records. "
        + prompt
        + "\n\nExecute the provided commands as written; do not add output-processing code. "
        "This is a new acceptance sample: execute the tools now; previous "
        "results do not count. After all requested operations succeed, briefly "
        "summarize the verified operations without personal identifiers or secrets, "
        f"then put {marker} alone on the last line. "
        "On failure, describe the failure instead of emitting the success marker."
    )


def live_evidence(calls: dict, results: list[dict], service: str) -> bool:
    """Require a service operation and returned inventory fields, not an echoed marker."""
    aliases = {
        "github": ("github", "gh"),
        "gitlab": ("gitlab", "glab"),
        "aws": ("aws",),
        "azure": ("azure", "az"),
        "salesforce": ("salesforce", "sf"),
        "gcloud": ("gcloud",),
        "f5": ("f5", "xcsh", "api"),
        "firecrawl": ("firecrawl",),
    }
    selected = []
    for result in results:
        call = calls[result["toolCallId"]]
        name = call.get("toolName", "").lower()
        arguments = json.dumps(call.get("args", {})).lower()
        native = name not in {"read", "grep", "search_tool_bm25"} and any(
            alias in name for alias in aliases[service]
        )
        cli = name == "bash" and any(
            re.search(r"\b" + alias + r"\s", arguments) for alias in aliases[service]
        )
        if service == "firecrawl" and name == "bash":
            cli = "firecrawl" in arguments or "3002" in arguments
        if service == "f5" and name == "bash":
            cli = bool(re.search(r"\bcurl\s", arguments)) and all(
                part in arguments
                for part in ("xcsh_api_url", "xcsh_api_token", "web/namespaces")
            )
        if service == "f5":
            args = call.get("args", {})
            native = (
                name == "xcsh_api"
                and isinstance(args, dict)
                and args.get("method") == "GET"
                and "web/namespaces" in arguments
            )
        if native or cli:
            selected.append(result.get("result", {}))
    payload = json.dumps(selected).lower()
    required = {
        "github": (("f5-sales-demo/xcsh",), ("default_branch", "defaultbranchref")),
        "gitlab": (("path_with_namespace", "pathwithnamespace"),),
        "aws": (("arn", "account"), ("vpcs",)),
        "azure": (("tenantid", "tenant_id"), ("data", "totalrecords")),
        "salesforce": (("organizationtype",),),
        "gcloud": (("projectnumber", "project_number"),),
        "f5": (("items", "namespace"),),
        "firecrawl": (("example domain",),),
    }
    return bool(selected) and all(
        any(field in payload for field in group) for group in required[service]
    )


def evaluate(
    events: list[dict],
    selector: str,
    marker: str,
    *,
    local: bool = False,
    service: str | None = None,
) -> dict:
    """Require matched successful tool results and the selected provider API."""
    if not all(isinstance(event, dict) for event in events):
        return {"passed": False, "category": "invalid_events"}
    provider, separator, model = selector.partition("/")
    if not separator or not provider or not model:
        return {"passed": False, "category": "invalid_selector"}
    model = model.split(":", 1)[0]
    calls = {
        event["toolCallId"]: event
        for event in events
        if event.get("type") == "tool_execution_start"
        and isinstance(event.get("toolCallId"), str)
    }
    results = [
        event
        for event in events
        if event.get("type") == "tool_execution_end"
        and event.get("toolCallId") in calls
    ]
    successful = [event for event in results if not event.get("isError")]
    assistants = [
        event["message"]
        for event in events
        if event.get("type") == "message_end"
        and isinstance(event.get("message"), dict)
        and event["message"].get("role") == "assistant"
    ]
    final = assistants[-1] if assistants else {}
    content = final.get("content", [])
    if not isinstance(content, list) or not all(
        isinstance(item, dict) for item in content
    ):
        return {"passed": False, "category": "invalid_events"}
    text = "".join(
        item.get("text", "") for item in content if item.get("type") == "text"
    ).strip()
    route = {
        "provider": final.get("provider"),
        "model": final.get("model"),
        "api": final.get("api"),
    }
    expected_api = "openai-responses" if provider == "litellm" else "anthropic-messages"
    final_marker = text == marker
    if service in LIVE:
        # A correct live interpretation may include a summary before its final marker.
        final_marker = bool(text) and text.splitlines()[-1].strip() == marker
    passed = (
        route["api"] == expected_api
        and bool(successful)
        and len(successful) == len(results) == len(calls)
        and route["provider"] == provider
        and route["model"] == model
        and final_marker
    )
    if local:
        names = [event.get("toolName") for event in successful]
        passed = (
            passed
            and "bash" in names
            and "edit" in names
            and names.count("python") >= PERSISTENT_CELLS
            and any(name in names for name in ("browser", "puppeteer"))
        )
    if service and service != "local":
        passed = passed and live_evidence(calls, successful, service)
    return {
        "passed": passed,
        "resolved": route,
        "toolCalls": len(calls),
        "successfulToolResults": len(successful),
        "category": "passed" if passed else "tool_route_or_result_failure",
    }


def acceptance(argv: list[str], workspace: str, arguments: list[str]) -> bool:
    """Run the complete matrix in a dedicated workspace and write private outcomes."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--model", action="append")
    parser.add_argument("--report", required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument(
        "--defer-service",
        action="append",
        choices=tuple(LIVE),
        default=[],
        help="Explicitly defer a live gate; record omitted coverage in the report",
    )
    parser.add_argument(
        "--candidate",
        action="store_true",
        help="Allow an unpublished local image, frozen to its inspected ID",
    )
    parser.add_argument("--timeout", type=int, default=240)
    opts = parser.parse_args(arguments)
    if opts.defer_service and not opts.live:
        msg = "--defer-service requires --live"
        raise ValueError(msg)
    deferred = sorted(set(opts.defer_service))
    if len(deferred) == len(LIVE):
        msg = "Live acceptance requires at least one service"
        raise ValueError(msg)
    if opts.runs < MINIMUM_RUNS:
        msg = "Full acceptance requires at least three consecutive runs per model"
        raise ValueError(msg)
    for selector in opts.model or MODELS:
        provider, separator, model = selector.partition("/")
        if not separator or not provider or not model:
            msg = "Acceptance --model requires PROVIDER/MODEL"
            raise ValueError(msg)
    image = argv[-1]
    if not opts.candidate and not re.search(r"@sha256:[a-f0-9]{64}$", image):
        msg = "Published acceptance requires an immutable image digest; use --candidate for local builds"
        raise ValueError(msg)
    base = argv[: argv.index("run")]
    inspected = subprocess.run(  # noqa: S603 - fixed image inspection through the validated launcher.
        [*base, "image", "inspect", image, "--format", "json"],
        capture_output=True,
        text=True,
        check=True,
    )
    identity = json.loads(inspected.stdout)[0]
    expected_arch = "arm64" if platform.machine() in {"arm64", "aarch64"} else "amd64"
    if identity.get("Architecture") != expected_arch:
        msg = "Candidate image does not match the native host architecture"
        raise ValueError(msg)
    if not opts.candidate and not any(
        value.endswith("@" + image.split("@")[-1])
        for value in (identity.get("RepoDigests") or [])
    ):
        msg = "Pulled image does not match the selected immutable digest"
        raise ValueError(msg)
    argv = [*argv[:-1], identity["Id"]]
    os.umask(0o077)
    root = Path(workspace)
    if any(root.iterdir()):
        msg = "Acceptance requires an empty dedicated workspace; select --workspace DIR"
        raise ValueError(msg)
    samples = []
    private = Path(tempfile.mkdtemp(prefix="xcsh-container-acceptance-"))
    report = {
        "schemaVersion": 1,
        "passed": False,
        "fullSuitePassed": False,
        "deferredServices": deferred,
        "candidateVersion": opts.expected_version,
        "imageId": identity["Id"],
        "architecture": identity["Architecture"],
        "systemPromptSha256": hashlib.sha256(
            ACCEPTANCE_SYSTEM_PROMPT.encode()
        ).hexdigest(),
        "samples": samples,
    }
    try:
        started = time.monotonic()
        runtime = subprocess.run(  # noqa: S603 - launcher constructs a rootless Podman argv; no shell.
            [*argv, "container-test"],
            capture_output=True,
            check=False,
            text=True,
            timeout=opts.timeout,
        )
        (private / "runtime.stdout").write_text(runtime.stdout)
        (private / "runtime.stderr").write_text(runtime.stderr)
        report["runtimePassed"] = (
            runtime.returncode == 0
            and ("xcsh/" + opts.expected_version) in runtime.stdout.splitlines()
        )
        report["startupSeconds"] = round(time.monotonic() - started, 3)
        if not report["runtimePassed"]:
            return False
        for selector in opts.model or MODELS:
            for repeat in range(1, opts.runs + 1):
                # Refuse to overwrite the user's files; fixtures must be a selected dedicated workspace.
                for name, value in {
                    "fixture.txt": "needle\nhaystack\nneedle\n",
                    "amounts.json": '[{"amount":19},{"amount":23}]\n',
                    "status.txt": "pending\n",
                }.items():
                    (root / name).write_text(value)
                (root / "acceptance-result.json").unlink(missing_ok=True)
                prompts = [("local", LOCAL_PROMPT, "LOCAL_ACCEPTANCE_OK")]
                if opts.live:
                    prompts += [
                        (service, live_prompt(service), marker)
                        for service, (_prompt, marker) in LIVE.items()
                        if service not in deferred
                    ]
                for service, prompt, marker in prompts:
                    started = time.monotonic()
                    command = [
                        *argv,
                        "--mode",
                        "json",
                        "--no-session",
                        "--no-memories",
                        "--no-title",
                        "--no-lsp",
                        "--require-tool-call",
                        "--append-system-prompt",
                        ACCEPTANCE_SYSTEM_PROMPT,
                        "--model",
                        selector,
                        prompt,
                    ]
                    try:
                        result = subprocess.run(  # noqa: S603 - same validated launcher argv and fixed fixture prompts.
                            command,
                            capture_output=True,
                            check=False,
                            text=True,
                            timeout=opts.timeout,
                        )
                        name = f"{selector.split('/')[0]}-{repeat}-{service}"
                        (private / (name + ".events")).write_text(result.stdout)
                        (private / (name + ".stderr")).write_text(result.stderr)
                        events = [
                            json.loads(line)
                            for line in result.stdout.splitlines()
                            if line.strip()
                        ]
                        sample = evaluate(
                            events,
                            selector,
                            marker,
                            local=service == "local",
                            service=service,
                        )
                        sample["passed"] = sample["passed"] and result.returncode == 0
                        if service == "local":
                            artifact = root / "acceptance-result.json"
                            correct = (
                                artifact.exists()
                                and json.loads(artifact.read_text())
                                == {
                                    "rg": 2,
                                    "jq": 42,
                                    "python": 42,
                                    "browser": "XCSH_BROWSER_42",
                                    "edited": True,
                                }
                                and (root / "status.txt").read_text().strip()
                                == "complete"
                            )
                            sample["passed"] = sample["passed"] and correct
                            if artifact.exists():
                                sample["artifactSha256"] = hashlib.sha256(
                                    artifact.read_bytes()
                                ).hexdigest()
                    except (subprocess.TimeoutExpired, json.JSONDecodeError):
                        sample = {
                            "passed": False,
                            "category": "timeout_or_invalid_events",
                        }
                    sample.update(
                        service=service,
                        selector=selector,
                        run=repeat,
                        seconds=round(time.monotonic() - started, 3),
                    )
                    samples.append(sample)
                    print(
                        service,
                        selector,
                        repeat,
                        "PASS" if sample["passed"] else "UNFINISHED",
                        flush=True,
                    )
        # Full-service acceptance cannot pass when --live was omitted.
        report["passed"] = (
            opts.live and bool(samples) and all(sample["passed"] for sample in samples)
        )
        report["fullSuitePassed"] = report["passed"] and not deferred
        report["localPassed"] = bool(samples) and all(
            sample["passed"] for sample in samples if sample["service"] == "local"
        )
        return report["passed"]
    finally:
        Path(opts.report).write_text(json.dumps(report, indent=2) + "\n")
