# Developing the Office add-in

This guide is the standard operating procedure (SOP) for building, testing, sideloading, troubleshooting,
and releasing the xcsh Office add-in. Use it with the repository-wide workflow in
[`DEVELOPING.md`](../../DEVELOPING.md) and the desktop acceptance inventory in [`UAT.md`](UAT.md).

## Prerequisites

Allow about 30 minutes for a first workstation setup, 10 minutes for the focused local gate, and 20 minutes
plus model response time for the automated and desktop user acceptance testing (UAT) paths.

| Requirement | Why you need it | Verify |
| --- | --- | --- |
| Bun from the root `packageManager` field | Installs workspaces, builds the pane, and runs tests | `bun --version` |
| Git and GitHub command-line interface (CLI) | Uses the repository issue, worktree, and pull-request workflow | `git --version`; `gh auth status` |
| macOS with desktop Excel, Word, or PowerPoint | Sideloads and verifies the real Office WebView and Office JavaScript (Office.js) runtime | Open the target app |
| `office-addin-debugging` on `PATH` | Registers the unified manifest in desktop Office | `command -v office-addin-debugging` |
| Homebrew | Installs and certifies the released binary that contains the pane | `brew --version` |
| Rust and Zig toolchains | Build native modules and a local compiled xcsh binary | `cargo --version`; `zig version` |
| An approved LiteLLM gateway root and token | Runs live-model certification | Inject the token through the approved credential manager |
| The f5-sales-demo marketplace | Supplies the synthetic MEDDPICC fixture and plugin | `xcsh plugin list --json` |
| `jq`, ripgrep, `curl`, and `lsof` | Validate manifests, evidence, assets, and port ownership | Run each command with `--version` where supported |

Use Bun only in this monorepo. Do not run `npm install`, `yarn`, or `pnpm` in the checkout. Installing the
global Microsoft sideload helper with npm is separate from installing repository dependencies:

```bash
npm install --global office-addin-debugging
```

### Use synthetic data only

Development, automated tests, screenshots, evidence, issues, pull requests, and demonstrations must use
generated synthetic data. Do not use real customer data, personally identifiable information (PII), a
redacted customer dataset, a copied customer folder, or a customer-derived fixture. Redaction is not a
substitute for synthesis.

The Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, and Competition
(MEDDPICC) certification harness enforces this boundary. It accepts only the canonical marketplace fixture,
checks its digest, and requires identity fields such as `<CHAMPION>` and `<ACCOUNT_EXECUTIVE>` to use visible
role aliases. Run every Office server from a dedicated synthetic workspace such as a directory created under
`/tmp`; never point the development server at a customer workspace.

Keep tokens out of shell history, command output, evidence, screenshots, and repository files. The harness
redacts its configured token and the local home-directory prefix, but you must still inspect evidence before
sharing it.

## Architecture reference

The add-in has two loopback flows. Static assets load over Hypertext Transfer Protocol Secure (HTTPS) from the
fixed Transport Layer Security (TLS) origin on port 8444. Chat and Office host-tool frames use the dedicated
secure WebSocket (WSS) bridge.

```text
Excel, Word, or PowerPoint WebView
  ├─ HTTPS :8444 ──> embedded task-pane assets and manifest
  └─ WSS bridge ───> xcsh headless chat session ──> selected model provider
                         │
                         └─ host_tool_call ──> pane dispatcher ──> Office.js ──> document
```

| Layer | Source of truth | Contract |
| --- | --- | --- |
| Browser user interface (UI) | `src/panel/`, `src/core/`, `src/taskpane.tsx` | Browser-safe code; no Node.js built-ins |
| Office adapters | `src/office/` | Excel, Word, and PowerPoint tools return the agent `content[]` result shape |
| Browser transport | `src/core/transport/` | Discovers an Office-kind bridge and validates protocol frames |
| Shared wire protocol | `packages/coding-agent/src/browser/chat-protocol.ts` and conformance data | Pane and engine must change together |
| Provider configuration | `src/core/gateway/config.ts` and coding-agent chat handler | Pane sends a gateway root; xcsh chooses the provider path from the model |
| Static server and manifest | coding-agent Office pane server plus `manifest/` | Fixed `https://127-0-0-1.local-ip.sh:8444` origin |
| Browser build | `build.ts` | Produces `dist/`, rejects Node.js imports, and enforces the gzip budget |
| Compiled embed | `scripts/generate-client-bundle.ts` | Embeds `dist/` in the compiled binary, then restores the tracked empty placeholder |
| Marketplace integration | coding-agent plugin resolver and bridge list commands | The engine loads skills, commands, and resources; the pane only presents them |

### Development, compiled, and npm layouts

- A source checkout serves `packages/office-pane/dist`. Build the pane before starting the source CLI.
- A compiled xcsh binary extracts the embedded archive into a content-addressed temporary directory.
- The Homebrew release contains the compiled archive and is the supported Office distribution.
- The npm package intentionally contains neither the private pane package nor the embedded archive. Its
  `office` command exits with status 1 and directs the user to Homebrew. A bound port serving `404` is a defect,
  not an acceptable fallback.

### Provider and model ownership

An unconfigured pane opens chat-first and uses the provider already configured in the xcsh process. The
**Settings** form is optional. It opens when the user selects **Settings** or when the provider classifies a
turn as an authentication rejection.

The form stores the gateway root and token in the pane's WebView `localStorage`. The bridge applies the token
to the xcsh runtime in memory and does not write it to the xcsh credential store. Enter only the HTTPS origin,
for example `https://gateway.example.com`. The pane removes legacy paths such as `/v1`, `/openai/v1`, and
`/anthropic`; xcsh adds the route required by the selected model.

The binary owns the default model. GPT-5.6 Sol High is the vision-capable default and slow role; the smol role
uses the same model at Low effort. Claude Opus 5 remains the alternate model-switch certification route. The
GPT route uses OpenAI Chat Completions, and its bundled and generated metadata must advertise both text and
image input so Office attachments and `inspect_image` reach the provider.

## Set up a development worktree

Create the linked issue and fresh worktree by following the root development guide. From the new worktree,
install dependencies and build the pane:

```bash
bun install --frozen-lockfile
bun run --cwd packages/office-pane build
bun run --cwd packages/office-pane check
```

The pane build must report a gzip size below 256 KB and create all of these paths:

```text
packages/office-pane/dist/taskpane.html
packages/office-pane/dist/taskpane.js
packages/office-pane/dist/manifest.json
packages/office-pane/dist/assets/
packages/office-pane/dist/fonts/
```

New worktrees can lack the ignored native module even when the primary checkout has one. Confirm its presence
before coding-agent tests or a compiled build:

```bash
find packages/natives/native -maxdepth 1 -type f -name '*.node' -print
```

If the command prints nothing, build the native module in the worktree:

```bash
bun run build:native
```

Do not skip native-dependent tests or classify their loader error as a product failure. Restore the required
build input, then rerun the original command.

### Start the source build from a synthetic workspace

Build from the repository, then launch from the directory that the agent may read and modify. The process
working directory is the Office sandbox root.

```bash
XCSH_OFFICE_REPO="$(git rev-parse --show-toplevel)"
mkdir -p /tmp/xcsh-office-example
cd /tmp/xcsh-office-example
bun "$XCSH_OFFICE_REPO/packages/coding-agent/src/cli.ts" office sideload excel
```

The command registers the add-in, starts the HTTPS asset server and chat bridge, and blocks until you press
Control-C. Replace `excel` with `word` or `powerpoint` for another host. Use `office serve` only when the add-in
is already registered.

Confirm the source manifest without opening Office:

```bash
cd "$XCSH_OFFICE_REPO"
bun "$XCSH_OFFICE_REPO/packages/coding-agent/src/cli.ts" office manifest \
  --out /tmp/xcsh-office-manifest.json
jq -e '.name.short == "xcsh" and .extensions[0].ribbons[0].tabs[0].groups[0].controls[0].label == "xcsh"' \
  /tmp/xcsh-office-manifest.json
```

## Development SOP

Use this sequence for every Office behavior change:

1. Identify every affected layer in the architecture table.
2. Add a focused failing test at the lowest layer that owns the behavior.
3. Run that test and capture the expected failure.
4. Implement the smallest root-cause fix.
5. Run the focused test and its package suite.
6. Mutation-check every new guard or branch independently.
7. Run cross-boundary tests for every other affected layer.
8. Run the automated UAT that matches the change.
9. Exercise the changed path in desktop Office when it touches Office.js, the WebView, the manifest, or assets.
10. Verify the exact installed release artifact after publishing.

Do not add skips, suppressions, inline disables, fallback success paths, or broad exception catches to make a
gate pass. A retry that passes after an initial failure is evidence of order, timing, or state leakage until
you identify and fix the root cause.

### Mutation-check new guards

Commit the green implementation before mutation testing. Weaken one validation site or restore one old
behavior at a time, then rerun the focused test. The test must fail for each mutation. Restore that site with
a narrow edit and rerun the test before mutating the next site. A class-level test can pass while one of
several call sites remains unprotected, so do not mutate a whole class at once.

Do not use `git checkout -- <file>` to restore a mutation when the file contains other uncommitted work. That
command discards unrelated edits. Use a narrow patch, inspect `git diff`, and confirm the original green test.

### Change-to-test matrix

Run the focused command in the last column, then run the package and repository gates later in this guide.

| Changed surface | Required focused evidence | Command |
| --- | --- | --- |
| Pane UI, state, settings, or model selector | Component behavior and transport lifecycle | `bun run --cwd packages/office-pane test -- test/ChatPanel.test.tsx test/GatewayGate.test.tsx test/useChatSession.test.tsx --max-concurrency 2` |
| Gateway normalization or persistence | Root-only uniform resource locator (URL), token, and storage behavior | `bun run --cwd packages/office-pane test -- test/gateway-config.test.ts test/gateway-store.test.ts --max-concurrency 2` |
| Excel host tools or workbook fake | Tool schema, Office errors, mutation, idempotency, and formula-injection defense | `bun run --cwd packages/office-pane test -- test/excel-tools.test.ts test/fake-excel.test.ts --max-concurrency 2` |
| Word or PowerPoint host tools | Host-specific read/write behavior and non-text shapes | `bun run --cwd packages/office-pane test -- test/word-tools.test.ts test/powerpoint-tools.test.ts --max-concurrency 2` |
| Manifest, ribbon, icons, or browser build | Manifest contract, every referenced asset, browser safety, and size budget | `bun run --cwd packages/office-pane test -- test/manifest.test.ts test/build.test.ts --max-concurrency 2` |
| Pane transport or shared protocol | Frame guards, conformance, bridge discovery, and disconnect behavior | `bun run --cwd packages/office-pane test -- test/conformance.test.ts test/loopback.test.ts test/bridge-discovery.test.ts --max-concurrency 2` |
| Office CLI, server, lifecycle, or embedded bundle | Command parsing, complete-pane checks, port ownership, and manifest output | `bun test --cwd packages/coding-agent test/office-cli.test.ts test/commands/office.test.ts test/browser/office-pane-server.test.ts test/browser/office-serve-lifecycle.test.ts --max-concurrency 2` |
| Provider, model, web search, or runtime configuration | Provider route, model list/switch, server-tool shape, and default model | `bun test --cwd packages/coding-agent test/browser/chat-handler.configure.test.ts test/chat-handler-list-models.test.ts test/chat-handler-web-search.test.ts test/default-model.test.ts test/login-model.test.ts --max-concurrency 2` |
| GPT-5.6 image capability | Generated and discovered metadata, Chat Completions serialization, `inspect_image`, and Office UAT transport | `bun test packages/ai/test/model-thinking.test.ts packages/ai/test/openai-completions-compat.test.ts packages/coding-agent/test/model-registry.test.ts packages/coding-agent/test/tools/inspect-image.test.ts packages/office-pane/test/uat-bridge-client.test.ts --max-concurrency 2` |
| Plugin discovery, commands, skills, or resources | Resolver tests, bridge enumeration, and plugin-surface UAT | `bun test --cwd packages/coding-agent test/internal-urls/plugin-resolve.test.ts test/chat-handler-list-skills.test.ts test/chat-handler-slash-commands.test.ts --max-concurrency 2` |
| MEDDPICC scenario or worksheet output | Scenario oracle, UAT argument guards, stateful workbook, and live certification | `bun run --cwd packages/office-pane test -- test/meddpicc-scenario.test.ts test/uat-meddpicc-excel.test.ts --max-concurrency 2` |

Run the complete pane package after every Office change:

```bash
bun run --cwd packages/office-pane check
bun run --cwd packages/office-pane test -- --max-concurrency 2
bun run --cwd packages/office-pane build
```

Run the broader TypeScript gate when either side of the bridge changes:

```bash
bun run check:ts
bun run test:ts
```

Run the full repository suite before the pull request when the change affects the coding agent, native build,
release packaging, or shared contracts:

```bash
bun run test
```

## Build a local compiled binary

Use a compiled binary to verify embedding and release-like behavior. The coding-agent build generates the
pane archive, compiles xcsh, and resets the tracked generated file after a successful build.

```bash
bun run build:native
bun run --cwd packages/coding-agent build
packages/coding-agent/dist/xcsh --version
packages/coding-agent/dist/xcsh office manifest \
  --out /tmp/xcsh-office-compiled-manifest.json
```

Inspect `git status --short` afterward. `packages/coding-agent/src/browser/office-pane.generated.txt` must
remain the tracked empty placeholder. If a failed build leaves generated content, diagnose the build failure
and rerun the successful build path; do not commit the archive.

## Run automated UAT

Automated UAT covers the real xcsh bridge, model inference, plugin loading, production host-tool definitions,
and stateful workbook behavior. It does not replace the final desktop Office.js and WebView check.

### Print the presentation prompts

The prompts have one source of truth and can be printed without a server or model call:

```bash
bun run --cwd packages/office-pane uat:meddpicc-excel --print-prompts
```

### Verify plugin enumeration

Start `xcsh office serve` from a synthetic workspace in one terminal. In a second terminal, verify commands
and skills without a model call:

```bash
bun run --cwd packages/office-pane uat:plugin-surface meddpicc
```

Add `--turn` only when you intend to spend a model call and verify command expansion end-to-end:

```bash
bun run --cwd packages/office-pane uat:plugin-surface meddpicc --turn
```

### Run multi-model MEDDPICC certification

The harness pins the accepted plugin version and fixture digest in
`scripts/uat-meddpicc-excel.ts`. Check those constants instead of relying on a remembered version:

```bash
rg '^const (EXPECTED_(FIXTURE_SHA256|PLUGIN_VERSION|MODEL)|ALTERNATE_MODEL)' \
  packages/office-pane/scripts/uat-meddpicc-excel.ts
xcsh plugin list --json \
  | jq -e '.marketplace[] | select(.id == "meddpicc@f5-sales-demo-marketplace")'
```

If the marketplace or plugin is absent, add the approved repository catalog and install the plugin:

```bash
xcsh plugin marketplace add f5-sales-demo/marketplace
xcsh plugin marketplace update f5-sales-demo-marketplace
xcsh plugin install meddpicc@f5-sales-demo-marketplace
```

Inject `LITELLM_API_KEY` with the approved credential manager. Set only the gateway origin in the URL variable:

```bash
export LITELLM_BASE_URL="https://gateway.example.com"
test -n "${LITELLM_API_KEY:-}"
```

From the xcsh repository root, certify a local compiled binary against the canonical synthetic fixture:

```bash
XCSH_OFFICE_REPO="$(git rev-parse --show-toplevel)"
XCSH_MARKETPLACE_REPO="$(cd ../marketplace && pwd)"
XCSH_UAT_WORKSPACE="$(mktemp -d /tmp/xcsh-office-uat.XXXXXX)"
XCSH_UAT_EVIDENCE="$(mktemp /tmp/xcsh-office-evidence.XXXXXX)"

bun run --cwd packages/office-pane uat:meddpicc-excel \
  --binary "$XCSH_OFFICE_REPO/packages/coding-agent/dist/xcsh" \
  --workspace "$XCSH_UAT_WORKSPACE" \
  --fixture "$XCSH_MARKETPLACE_REPO/plugins/meddpicc/schema/example-deal.json" \
  --evidence "$XCSH_UAT_EVIDENCE"

jq -e '.status == "passed" and .scenarioModel == "gpt-5.6-sol" and
  .visionProbe.directAttachmentPassed and .visionProbe.fileInspectionPassed and
  ([.runs[].passed] | all)' \
  "$XCSH_UAT_EVIDENCE"
```

The harness fails closed unless all of these conditions hold:

- The fixture uses role aliases and matches the canonical digest.
- The exact pinned MEDDPICC plugin is installed.
- Port 8444 and Office bridge ports 19242 through 19261 are free before startup.
- The binary reports its version and has a stable file digest.
- Omitting the model selects GPT-5.6 Sol.
- Live inference succeeds on GPT-5.6 Sol, Claude Opus 5, then GPT-5.6 Sol again.
- A generated high-contrast Portable Network Graphics (PNG) image succeeds as a direct Office attachment and
  through file-based `inspect_image` under GPT-5.6 Sol.
- The MEDDPICC scenario starts under the restored GPT-5.6 Sol model.
- All five scenario steps pass against the real bridge and production Excel tool definitions.
- The second worksheet-generation run reuses one sheet and preserves the `Start` sheet.
- Only the server child started by the harness is stopped.
- The JavaScript Object Notation (JSON) evidence excludes image payloads, probe codes, model replies, and
  credentials; configured secrets and local user paths are redacted from the remaining fields.

### Complete the desktop Office check

Follow the relevant rows in [`UAT.md`](UAT.md). For Excel MEDDPICC certification, open a synthetic workbook
with a `Start` sheet and sentinel value, run `xcsh office sideload excel` from the synthetic fixture directory,
send the printed five prompts, and confirm the exact worksheet and idempotency assertions.

Record the xcsh version and pass or fail result for every exercised row. Capture screenshots only when every
visible workbook value, path, account label, user chip, notification, and adjacent window is synthetic or
removed. The automated harness cannot prove the Office ribbon, WebView rendering, icon appearance, or live
Office.js behavior; desktop UAT is mandatory when those surfaces change.

## Verify the installed release

Repository tests do not prove what Homebrew installed. After release, upgrade, resolve the actual binary, and
verify its embedded manifest:

```bash
brew update
if brew list --versions f5-sales-demo/tap/xcsh >/dev/null 2>&1; then
  brew upgrade f5-sales-demo/tap/xcsh
else
  brew install f5-sales-demo/tap/xcsh
fi
command -v xcsh
realpath "$(command -v xcsh)"
xcsh --version
xcsh office manifest --out /tmp/xcsh-office-release-manifest.json
jq -e '(.name.short == "xcsh") and (.extensions[0].runtimes[0].code.page | contains(":8444/taskpane.html"))' \
  /tmp/xcsh-office-release-manifest.json
```

Run the same MEDDPICC certification command with `--binary "$(command -v xcsh)"` and a new evidence file.
Then complete the desktop UAT from a new synthetic workspace.

The npm distribution has the opposite contract. Verify that it exits with status 1, prints the Homebrew
remedy, and emits no stack trace. Capture the command status before reading its output; a pipeline reports the
last command's status, not xcsh's status.

```bash
XCSH_RELEASE_VERSION="$(brew info --json=v2 f5-sales-demo/tap/xcsh | jq -r '.formulae[0].versions.stable')"
set +e
npx --yes --package "@f5-sales-demo/xcsh@${XCSH_RELEASE_VERSION}" \
  xcsh office manifest \
  > /tmp/xcsh-office-npm-refusal.txt \
  2>&1
XCSH_NPM_STATUS=$?
set -e

test "$XCSH_NPM_STATUS" -eq 1
rg 'brew install f5-sales-demo/tap/xcsh' /tmp/xcsh-office-npm-refusal.txt
! rg '^[[:space:]]+at ' /tmp/xcsh-office-npm-refusal.txt
```

If a release rewrote history, do not use commit ancestry as the only inclusion check. Compare the relevant
file content at the release tag and on `origin/main`, then verify the installed artifact's behavior.

## Troubleshooting

Fix the cause represented by the evidence. Do not disable the failing check, weaken validation, or add a
success fallback.

### The pane shows settings or an authentication screen

The normal first view is chat. The settings form opens after the user selects **Settings** or after a turn
returns the classified `provider-auth` reason. Do not assume that the token expired.

1. Confirm you are running the intended binary with `command -v xcsh` and `xcsh --version`.
2. Confirm the gateway field contains the HTTPS origin only, with no `/anthropic`, `/v1`, or `/openai/v1` path.
3. Select the intended model in the composer; do not encode model selection in the URL.
4. Run the multi-model harness. It distinguishes configuration rejection, missing model routes, and inference
   failure without exposing the token.
5. If chat works with no saved pane settings, clear or replace the pane settings through **Settings**. The
   binary's existing provider authentication is sufficient for chat-first mode.

### Image inspection reports an unsupported model

Treat this message for GPT-5.6 Sol as stale or incorrect capability metadata. Confirm the bundled model first:

```bash
bun -e 'import { getBundledModel } from "./packages/ai/src/models.ts"; console.log(getBundledModel("litellm", "gpt-5.6-sol")?.input)'
```

The output must include `text` and `image`. Run the GPT-5.6 image-capability row in the change-to-test matrix,
then run the multi-model UAT. If the bundled model is correct but the live turn fails, inspect the generated
`models.yml` override and model discovery merge before changing the provider or model.

### The pane opens in the wrong folder

The server inherits the directory from which `office serve` or `office sideload` starts. Stop the owned server,
change into the dedicated synthetic workspace, and run `xcsh office sideload <app>` again. Ask the pane to
report its working directory and list files as the acceptance check.

### Commands or skills are missing

Inspect the installed plugin inventory and run the plugin-surface UAT:

```bash
xcsh plugin list --json \
  | jq '.marketplace[] | {id, version: .entries[0].version}'
bun run --cwd packages/office-pane uat:plugin-surface meddpicc
```

The session loads plugin capabilities at startup. After installing or upgrading a plugin, stop the old server
and start a new one from the synthetic workspace. An empty menu is a plugin discovery or bridge enumeration
failure; do not hardcode menu entries in the pane.

### The assistant writes a transcript but not a worksheet

Confirm the host is Excel and inspect the activity rows. Worksheet generation must call `add_sheet`,
`write_cells` or `write_range`, and `read_range`. Then run the Excel tool tests and the five-step MEDDPICC
harness. If no host-tool call appears, investigate plugin prompt expansion and host-tool advertisement. If the
call appears with an error, investigate the Office.js adapter and its returned error code. Do not treat a text
summary as successful worksheet generation.

### The ribbon label or icon is stale

First verify the served manifest and icon instead of assuming Office cached the correct bytes:

```bash
xcsh office manifest --out /tmp/xcsh-office-live-manifest.json
jq '.version, .extensions[0].ribbons[0].tabs[0].groups[0].controls[0]' \
  /tmp/xcsh-office-live-manifest.json
curl --fail --silent --show-error \
  https://127-0-0-1.local-ip.sh:8444/assets/icon-32.png \
  --output /tmp/xcsh-office-icon-32.png
file /tmp/xcsh-office-icon-32.png
```

Rerun `xcsh office sideload <app>`. The command removes only this add-in's stale manifest link before
registering the current bundle. Close and reopen the Office app if its ribbon cache still shows the prior
manifest. Do not recursively delete Office container directories.

### Port 8444 is occupied

Identify the owner before stopping anything:

```bash
lsof -nP -iTCP:8444 -sTCP:LISTEN
xcsh office recycle
```

xcsh supersedes or recycles only a process whose command line identifies it as `office serve`; it does not kill
an unrelated listener. Stop a foreign process through its own lifecycle. The MEDDPICC harness refuses to adopt
or supersede any pre-existing server because it must stop only the child it owns.

### The WebView refuses the page or bridge

Read the server startup output. It must report the task-pane HTTPS URL and a secure WebSocket bridge. Probe the
TLS endpoint without disabling certificate verification:

```bash
curl --fail --silent --show-error \
  https://127-0-0-1.local-ip.sh:8444/taskpane.html \
  --output /tmp/xcsh-office-taskpane.html
```

A self-signed fallback warning means certificate provisioning failed. Fix network, proxy, or certificate
resolution at the source. Do not add `--insecure`, weaken the WebView, or change the manifest to plain
Hypertext Transfer Protocol (HTTP).

### Source mode reports that the pane is missing

Rerun the pane build and inspect every required output. The server validates `taskpane.html`, `taskpane.js`, a
parseable `manifest.json`, and every asset referenced by the manifest. A partial `dist/` is not usable.

```bash
bun run --cwd packages/office-pane build
bun packages/coding-agent/src/cli.ts office manifest \
  --out /tmp/xcsh-office-rebuilt-manifest.json
```

### npm reports that Office is unavailable

This is the expected npm contract. Install or upgrade `f5-sales-demo/tap/xcsh` with Homebrew. Do not copy the
private pane into `node_modules`; that would bypass the compiled asset, release, and certificate contracts.

### Tests cannot load the native add-on

Run the native presence check from the setup section. Build the native module with `bun run build:native`, then
rerun the unchanged test command. Do not skip the test or replace the native path with a machine-specific
absolute path.

## Verify

Before a pull-request push, verify the changed surface and record every command's exit status:

```bash
bun run --cwd packages/office-pane check
bun run --cwd packages/office-pane test -- --max-concurrency 2
bun run --cwd packages/office-pane build
bun run check:ts
bun run test
bash scripts/check-pii.sh --scope staged --mode enforce
bash scripts/check-pii.sh --scope staged --mode audit
gitleaks git --staged --no-banner --redact
```

For documentation changes, also run the Markdown and terminology gates on every changed document:

```bash
npx --yes markdownlint-cli@0.49.1 \
  DEVELOPING.md \
  packages/office-pane/DEVELOPING.md \
  packages/office-pane/UAT.md
bash scripts/lint-mdx-prose.sh --textlint-only \
  DEVELOPING.md \
  packages/office-pane/DEVELOPING.md \
  packages/office-pane/UAT.md
```

Run the required local Antigravity review from the committed branch by following `CONTRIBUTING.md`. Run the
applicable automated UAT and desktop rows before release. A successful unit suite cannot replace a failed or
unrun desktop Office check.

## Clean up

Press Control-C in the terminal that owns `office sideload` or `office serve`, then confirm no owned listener
remains:

```bash
xcsh office recycle
lsof -nP -iTCP:8444 -sTCP:LISTEN
```

Close only the synthetic workbook and Office app instance used for the test. Inspect the generated UAT evidence
before retaining it. Remove the temporary workspace only after resolving its exact path and checking that it
matches the prefix created by this guide:

```bash
XCSH_UAT_REAL="$(realpath "$XCSH_UAT_WORKSPACE")"
case "$XCSH_UAT_REAL" in
  /tmp/xcsh-office-uat.*) rm -rf -- "$XCSH_UAT_REAL" ;;
  *) printf 'Refusing unexpected path: %s\n' "$XCSH_UAT_REAL"; exit 1 ;;
esac
```

Retire the merged worktree and branch with the repository cleanup procedure in `CONTRIBUTING.md`. Check for
ignored evidence or build outputs before removing a worktree because Git does not report ignored files as
uncommitted changes.
