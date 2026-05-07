# Autoresearch

## Goal

- Minimize the system prompt profile hint character count (token efficiency) while preserving all UAT acceptance criteria.
- Secondary: reduce UAT test suite wall time by reducing per-file Bun startup overhead.
- Phase C: Add xcsh://computer protocol for machine hardware/environment intelligence gathering with minimal token overhead.

## Benchmark

- command: bash autoresearch.sh
- primary metric: rendered_hint_chars (actual LLM overhead = render_with_profile.length - render_without_profile.length)
- metric unit: chars
- direction: lower
- secondary metrics: source_hint_chars, test_time_ms, test_pass_count, computer_hint_chars
- how it works: bun executes TypeScript directly via `bun packages/coding-agent/autoresearch-measure.ts`; template changes take effect immediately, no binary compilation needed

## Files in Scope
Phase A (hint wording):
- packages/coding-agent/src/prompts/system/system-prompt.md

Phase B (test consolidation — after Phase A converges):
- packages/coding-agent/test/profile-hint-and-checks.test.ts (merged from system-prompt-profile + welcome-checks-profile)

Phase C (computer profile — session 5):
- packages/coding-agent/src/internal-urls/computer-profile.ts (NEW)
- packages/coding-agent/src/internal-urls/xcsh-protocol.ts (xcsh://computer routing)
- packages/coding-agent/src/system-prompt.ts (computerProfile in BuildSystemPromptOptions)
- packages/coding-agent/src/prompts/system/system-prompt.md ({{#if computerProfile}} block)
- packages/coding-agent/src/sdk.ts (loadComputerProfile + buildComputerHint)
- packages/coding-agent/src/modes/interactive-mode.ts (background seedComputerProfile)
- packages/coding-agent/test/internal-urls/computer-profile.test.ts (NEW, 18 tests)
## Off Limits

- packages/coding-agent/src/internal-urls/user-profile.ts
- packages/coding-agent/src/internal-urls/profile-collectors.ts
- packages/coding-agent/src/internal-urls/xcsh-protocol.ts
- packages/coding-agent/src/system-prompt.ts
- packages/coding-agent/src/sdk.ts
- packages/coding-agent/src/modes/components/welcome-checks.ts
- packages/coding-agent/src/modes/components/welcome.ts
- packages/coding-agent/src/modes/interactive-mode.ts
- packages/coding-agent/test/internal-urls/ (all existing files)
- packages/coding-agent/test/welcome-checks.test.ts
- packages/coding-agent/test/welcome-component.test.ts
- ~/.xcsh/user-profile.json

## Constraints

- The hint block MUST contain "Primary Human"
- The hint block MUST contain "xcsh://user"
- The hint block MUST contain a MUST/SHOULD NOT directive (trigger taxonomy)
- All 139 tests MUST pass across 9 files (was 115/8 before Phase C)
- hint_chars MUST remain below 600 to stay under ~160 tokens
- computer_hint_chars target: < 100 chars (Phase C baseline: 73)
- autoresearch-measure.ts MUST remain in packages/coding-agent/ (module resolution)

## Preflight

- Repo is a Bun monorepo; run from repo root
- bun and python3 must be in PATH
- No node_modules install needed (already present)
- Comparability invariant: same 9 test files, same render context in autoresearch-measure.ts

## Baseline

- rendered_hint_chars: 276 (what the LLM actually sees after template expansion)
- source_hint_chars: 320 (raw template chars including Handlebars syntax)
- notes: initial implementation; 4-bullet trigger taxonomy; full prose SHOULD NOT line
- NOTE: earlier sessions tracked source chars (320); rendered chars are the correct primary metric

## Current Best

- rendered_hint_chars: 192 | source_hint_chars: 236
- why it won: colon-structured trigger list (identity, communications, personal identifiers); compact name format (no parens); dropped SHOULD NOT verb ("read for" → "for"); dropped "or product questions" ("routine technical work" covers it)

## What's Been Tried

- source 581 → 412 (rendered N/A): combined 4 bullets into 2; dropped verbose examples
- source 412 → 381 (rendered N/A): removed "Full profile at" prefix; removed "code changes" from SHOULD NOT
- source 381 → 320 / rendered 276: merged 2 bullets into single inline sentence; dropped identifier list in parenthetical
- rendered 276 → 264 (exp 1): drop "answering", semicolon join
- rendered 264 → 259 (exp 2): drop "read for" after SHOULD NOT → "**SHOULD NOT** for"
- rendered 259 → 250 (exp 3): "user communications" replaces "addressing/drafting for user"
- rendered 250 → 249 (exp 6): compact name format (commas, no parens), restore product questions
- rendered 249 → 222 (exp 9): tighter trigger wording: "communications, identity, or personal identifiers needed"
- rendered 222 → 201 (exp 10): drop "or product questions"
- rendered 201 → 192 (exp 12, WINNER): colon list syntax: "when: identity, communications, personal identifiers"
- rendered 192 → 183 (exp 14, rejected): "comms" too informal for system prompt
- Merged system-prompt-profile.test.ts + welcome-checks-profile.test.ts → profile-hint-and-checks.test.ts (8 files instead of 9)


## Phase C: xcsh://computer (session 5)

### Goal

Add machine hardware/environment intelligence gathering. Persist to `~/.xcsh/computer-profile.json`.
Expose via `xcsh://computer` protocol. Surface compact hint in system prompt alongside userProfile.

### Schema.org alignment

No `Computer` or `ComputerWorkstation` type in schema.org. Using `IndividualProduct` (@type) — "a single, identifiable product instance".
Custom hardware fields on the TypeScript interface. No external schema dependency.

### Architecture

```
seedComputerProfile()  (background, fire-and-forget at startup)
     |
  collectInstant()    +   collectDeferred()
  (os module, sync)       (sysctl, sw_vers, df — subprocess)
     |
~/.xcsh/computer-profile.json     <- persisted 24h cache
     |
xcsh://computer                   <- read-only markdown
xcsh://computer?refresh=true      <- re-collect
```

### Key source files

| File | Purpose |
|---|---|
| `packages/coding-agent/src/internal-urls/computer-profile.ts` | Core: types, collect, seed, render, hint |
| `packages/coding-agent/test/internal-urls/computer-profile.test.ts` | 18 tests |

### Measurements (Phase C baseline)

| Metric | Value |
|--------|-------|
| rendered_computer_hint_chars (Phase C-ext, with Managed) | **82** |
| rendered_computer_hint_chars (Phase C baseline, no management) | 73 |
| rendered_hint_chars (userProfile, fake data) | 180 |
| Combined overhead | 262 chars |
| test_pass_count | **146** |
| test_file_count | **9** |

### Phase C-ext rendered hint (fake data, corporate device)

```
`xcsh://computer`. 32GB RAM, Test CPU 3000, testOS 99.0 (8 cores), zsh. Managed.
```
82 chars. +9 chars vs Phase C baseline for " Managed." suffix.

### Phase C rendering (real machine, personal — no MDM)

```
`xcsh://computer`. 32GB RAM, Apple M5, darwin 26.3 (10 cores), zsh.
```
~66 chars rendered.

### Phase C-ext rendering (real machine, corporate)

```
`xcsh://computer`. 32GB RAM, Apple M5, darwin 26.3 (10 cores), zsh. Managed.
```
~75 chars rendered. LLM now knows not to suggest sudo, to account for MDM restrictions.

### Fast vs deferred collection

Fast (os module, instant, no subprocess):
- platform, osRelease, architecture, cpuModel, cpuLogicalCores, totalMemoryGB, hostname, shell, terminal

Deferred (subprocess, ~10-500ms each, run in Promise.all):
- machineModel: `sysctl -n hw.model` (darwin)
- cpuPhysicalCores: `sysctl -n hw.physicalcpu` (darwin)
- osVersion: `sw_vers -productVersion` (darwin)
- diskTotal/diskFree: `df -P /` (darwin/linux)
- installedTools: `$which` for 15 candidates (all platforms)
- management: `profiles status -type enrollment` + `jamf version` + `/usr/libexec/mdmclient DumpManagementStatus` (darwin); binary scan for puppet/chef/salt (linux)
- security: `csrutil status`, `fdesetup status`, `spctl --status`, `socketfilterfw --getglobalstate` (darwin); `id -Gn`, `sudo -n true` (all platforms)
- endpointAgents: `systemextensionsctl list` filtered to `[activated enabled]` (darwin); binary scan for falconctl/mdatp/carbonblack (linux)

### Startup impact

`loadComputerProfile()` at system prompt build time = 1 file read (~1-5ms).
`seedComputerProfile()` is fire-and-forget in background after welcome screen,
parallel to existing `seedProfile()`. No blocking startup cost added.

### Constraints added by Phase C

- `xcsh://computer` MUST appear in `system-prompt.md`
- `computerProfile` MUST appear in `system-prompt.md`
- `Machine hardware and environment profile` MUST appear in `system-prompt.md`
- `Managed` MUST appear in `system-prompt.md` (managed device hint trigger)
- Do NOT write PII to `~/.xcsh/computer-profile.json` in tests (use fake hostnames)
- `collectInstant()` is exported for direct testing (no mock needed)
- PII policy: MDM server URL passes through `detectMdmVendor()` keyword-only extraction; URL never stored
- Sensitive MDM fields NOT stored: server URLs, UUIDs, push tokens, org addresses, emails, phone numbers, magic strings

### Commands discovered in research (session 5 probe results on F5 MacBook)

| Command | Returns | Stored as |
|---|---|---|
| `profiles status -type enrollment` | DEP enrolled, MDM enrolled, server URL | `management.isManaged`, `management.depEnrolled`, vendor name from URL |
| `/usr/libexec/mdmclient DumpManagementStatus` | DeviceIsSupervised, OrganizationName, UUIDs, tokens | `management.isSupervised`, `management.organizationName` only |
| `jamf version` | version string | `management.mdmVersion` |
| `csrutil status` | enabled/disabled | `security.sipEnabled` |
| `fdesetup status` | On/Off | `security.fileVaultEnabled` |
| `spctl --status` | assessments enabled/disabled | `security.gatekeeperEnabled` |
| `socketfilterfw --getglobalstate` | Firewall is enabled/disabled | `security.firewallEnabled` |
| `id -Gn` | space-separated group names | `security.isAdmin` (checks for admin/sudo/wheel/root) |
| `sudo -n true` | exit 0 or 1 | `security.hasSudo` |
| `systemextensionsctl list` | extension list with states | `endpointAgents` (names of `[activated enabled]` only) |

### Next iteration candidates

- GPU collection: move GPU cache logic from `system-prompt.ts` to `computer-profile.ts`
- Display info: `system_profiler SPDisplaysDataType` for connected display count/resolution
- Network interfaces: `os.networkInterfaces()` for active interfaces summary
- Compress hint: drop `(N cores)` saves ~12 chars; `admin: false` flag in hint for non-admin devices
- `xcsh://computer?refresh=true` test coverage: needs subprocess mock
- Linux management: detect systemd-machined, check `/etc/puppet`, `/etc/chef`, salt grains
- Windows: WMI for domain join status, BitLocker encryption, Defender status