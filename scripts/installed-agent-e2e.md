# Installed-agent release acceptance

The release harness runs the supplied executable through a real PTY with the production
`xcsh_context`, `xcsh_api`, `bash`, and native `grep` tools. It checks actual tool results,
recorded tenant requests, complete assistant turns, saved profile bytes, and fresh resource
markers withheld from the prompt. A completion claim alone cannot pass.

The supported hosts are Linux and macOS. The controller needs Python's standard library
and OpenSSL; it does not need Bun or external `rg`. xcsh ships its native search engine.
Operators who use the separate shell `rg` command manage that utility themselves.
Keep `installed_agent_acceptance/` beside the `installed_agent_e2e.py` entrypoint when
copying the controller. Its modules separate validation, fixture transport, profile setup,
terminal capture, credential handoff, and scenario execution without adding dependencies.

## Run the exact artifact

First verify release immutability, source ancestry, the source build run and attempt,
asset digests, checksums, and native provenance. Install that verified artifact into a
task-owned prefix. The harness records its resolved path, version, SHA-256, host,
architecture, backend, and scenario. `--artifact-origin` labels the supplied provenance;
it does not replace those independent release checks.

```bash
python3 scripts/installed_agent_e2e.py \
  --executable "$TASK_PREFIX/bin/xcsh" \
  --output "$EVIDENCE_ROOT/deterministic" \
  --backend deterministic --artifact-origin published

python3 scripts/installed_agent_e2e.py \
  --executable "$TASK_PREFIX/bin/xcsh" \
  --output "$EVIDENCE_ROOT/live" \
  --backend live --artifact-origin published \
  --credential-store "$HOME/.xcsh/agent/agent.db"
```

Outputs must be new directories. Failed runs remain preserved. Diagnose and change the
failed candidate or driver before another run. `--scenario` selects a diagnostic subset;
its receipt does not claim complete-matrix acceptance.

Deterministic mode uses scripted Anthropic SSE transport with synthetic credentials.
Live mode uses `openai-codex/gpt-6.1-sol` with high thinking and runs each supported case
twice consecutively in fresh profiles with new markers. The store is opened read-only;
exactly one valid enabled subscription credential is handed to the child through memory
and its environment. Disabled credentials are not enabled, and provider configuration
is not copied or changed. An existing `OPENAI_CODEX_OAUTH_TOKEN` environment handoff is
also supported, without `--credential-store`. Never put a credential in an argument,
transcript, issue, or public receipt.

## Scope and outcome checks

The matrix covers explicit and automatic context selection, guided/manual namespace
selection, cancellation, repetition, A-to-B transitions, cached shell values, runtime
controls, command overrides, environment authority, missing configuration, guarded
context requests, offline selection, HTTP/transport failures, empty lists, admitted
A work followed by B selection, plugin success/failure, and native search outcomes.
Provider failure, malformed response, and missing-tool controls are deterministic only.

Required saved-profile fields retain their existing validation contract. The missing
required-token case rejects invalid B activation and proves that A remains effective.
Optional values absent from valid B remain absent; environment-without-token coverage
checks local API rejection with no saved-context authority or credential fallback.

API requests retain unresolved `{namespace}` arguments with discovery expansion disabled.
Requests are matched to actual tool-result request IDs, URL, method, status, and retry
flags. Admitted A work and retries retain A; newly admitted work uses B. Namespace
commands preserve saved profiles and startup pointers; deliberate context activation
follows its existing persistence contract. Receipts distinguish successful local
selection from a failed subsequent API call.

## Preserve and review evidence

`receipts/` contains allowlisted outcomes and evidence digests. Raw PTY bytes, input
timing, synthetic backend requests, sessions, profiles, and failures are under `private/`.
The native search cases install a recording `rg` sentinel on PATH. Any execution fails.

Replay captured byte boundaries with the existing Unicode-11 xterm terminal and renderer:

```bash
bun packages/coding-agent/scripts/render-installed-agent-evidence.ts \
  "$EVIDENCE_ROOT/deterministic"
```

The renderer writes private PNGs and verifies actual terminal cells against the captured
selection assertions. Image inspection is recorded separately. Review all replay verdicts
before accepting the installation; source tests and local builds are separate evidence.

Homebrew CI invokes the deterministic matrix after fresh installation and again after
upgrade, under the existing standard account. Signing, native loading, uninstall, and
user-data checks remain required. CI encrypts raw captures with the public recipient
certificate and uploads only ciphertext and sanitized receipts, including failed runs.
The maintainer retains the private decryption key outside the worktree. Download and
decrypt those captures privately before replay and visual review; preserve their checksums.

Final acceptance requires a newly incremented immutable release, green merged-main CI,
every required release publication and verification job, complete Ubuntu deterministic
and live coverage, and Intel/ARM Homebrew fresh-install and upgrade coverage. Keep the
parent acceptance issue open until all of those gates pass.
