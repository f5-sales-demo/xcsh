# iPhone integration checkpoint

Checkpoint: October 25, 2026. Native ChatGPT iPhone registration and backend integration remain the baseline.
The Home Screen WebRTC app is a separate preserved prototype. Development and physical acceptance are paused
at this checkpoint; the save phase publishes recoverable source and open PRs with required CI checks.

## Scope and records

- Native baseline issue: <https://github.com/f5-sales-demo/xcsh/issues/5070>; PR: <https://github.com/f5-sales-demo/xcsh/pull/5073>.
- WebRTC continuation issue: <https://github.com/f5-sales-demo/xcsh/issues/5071>; PR: <https://github.com/f5-sales-demo/xcsh/pull/5074>.
- Historical reliability issue: <https://github.com/f5-sales-demo/xcsh/issues/4406> and PR:
  <https://github.com/f5-sales-demo/xcsh/pull/4408> remain open. Their full A/B/C/D acceptance matrix is unfinished.
- Historical failed TypeScript CI: <https://github.com/f5-sales-demo/xcsh/actions/runs/36245227514.>
  Skipped downstream jobs in that run are not passes.

Both publication PRs target `main` because current CI triggers PR validation for `main`.
The WebRTC PR depends on the native baseline and includes its shared backend changes when compared with `main`.
Review the eight original client files plus CI integration separately using the baseline-to-prototype diff.
These PRs stay in draft status because repository automation enables auto-merge on non-draft PRs.
Do not enable auto-merge, merge, release, replace installed runtime, revoke pairing, or run further phone
acceptance as part of this save phase. CI success does not establish physical acceptance.

## Source and recovery

| Stream | Original revision | Publication branch | Public snapshot recovery branch |
| --- | --- | --- | --- |
| Native backend | `438970848b9f3f538cabd9e2ba2284adfe148a12` | `fix/issue-5070-native-iphone-checkpoint` | `recovery/iphone-20261025-native-baseline` |
| WebRTC client | `3c4596b7da463bad3020fd457c21c8e57c1651c1` | `fix/issue-5071-webrtc-phone-continuation` | `recovery/iphone-20261025-webrtc-prototype` |

The original policy repair is `26654ad51167a65428afb8bbff1db81938ab44ec`, subscription routing repair
`678f4c47fc069d6e4da000e09017b3d3fe06b27b`, and client implementation
`7f80692424fe4ac4e6a6f4bd9c6ca16bbbd0178a`. Reconciliation starts at main
`f1d9af37538cfd0ab61dfdaab9a2314b25d337e4`; original revisions remain independently recoverable.
Final publication commit and check receipts are in PR comments to avoid updating this file for its own CI commit.
See [the full integration inventory](docs/iphone-integration-checkpoint.md) for shared backend ownership and scope.

Exact originals are retained privately as `refs/recovery/iphone-checkpoint-20261025/native-baseline` and
`refs/recovery/iphone-checkpoint-20261025/webrtc-prototype`.

Private recovery storage on each Linux host is `~/xcsh-publication-20261025/recovery/`.
It contains original refs, worktree inventories, binary diffs, untracked-file archives, verified Git bundles and
SHA256 manifests. NUC campaign worktrees and runtime configuration remain intact. The source transfer bundle
has SHA256 `f98a0cce0480cf3663883bf2f42ab5653d1d7352295a5c51fbf5a241b630faed`. Private all-ref bundle hashes: NUC `3a1377b1b782abeff149dd9014aca966ee64ac252f183e458edc72f4c710554f`;
workstation `53e58b748ff283d0f3d8b5847ecbda36e30dd04e5548c9a7cc4a0a3fd72eefdb`. Original recovery refs remain private because personal host paths occur in unpublished history. Public recovery branches preserve sanitized reconciled snapshots; exact originals remain in private bundles. Secret scans passed before publication; private evidence was not published.

## Hosts, tools and ownership

Resolve `<REPO_ROOT>` and the exact SSH destination from the private local control `AGENTS.md`.
All GitHub mutations run on the Ubuntu workstation through direct SSH using the delivery route recorded in
local control `AGENTS.md`. Verify effective Linux identity, Git identity, repository and intended object before
writing. The canonical GitHub repository is `f5-sales-demo/xcsh`; the NUC origin is a local recovery bundle,
not GitHub. Use the installed cross-host-cli exact-argument helpers and verify skill parity before SSH work.

| Host | Role and path |
| --- | --- |
| Mac control workspace | Local `xcsh-recap`; sanitized handoff mirror and private evidence scripts; no Xcode |
| Ubuntu workstation | `<REPO_ROOT>/xcsh`; publication in `<REPO_ROOT>/.worktrees/xcsh-native-iphone-checkpoint-20261025` and `<REPO_ROOT>/.worktrees/xcsh-webrtc-phone-continuation-20261025` |
| NUC | `~/GIT/xcsh-uat/.worktrees/voice-subscription-cleanroom-20261021` and `~/GIT/xcsh-uat/.worktrees/owned-phone-client-20261022`; installed qualification runtime |

Repository owners review shared backend changes in `packages/coding-agent`, related AI/UI/native code and
build inputs. WebRTC adapter and browser code live under `scripts/qualification-cleanroom/owned-phone-client`.
No CODEOWNERS file was present at the inspected main revision; ownership here describes code surfaces and
operational responsibility, not an assigned reviewer. Protected governance files must not be modified.

Current publication toolchain is declared Bun **1.4.2**, matching upstream packageManager/bootstrap and CI.
Historical backend/client qualification used Bun **1.4.3**, with an explicit bootstrap version override.
Those historical results do not prove current 1.4.2 validation. Use the declared Rust toolchain and a Linux
source-matched native addon; never reuse an addon from an unrelated source tree. Publication qualification used Node 26.11.1, Python 3.15.0, pre-commit 3.6.2 and
Rust nightly-2026-09-03 (rustc/cargo 1.100.0 nightly). Node supports prose/hooks; Python supports docs checks.
The adapter requires Python 3.10 or newer and pins aiohttp 3.14.5 in its isolated environment. WebRTC CI uses an isolated virtual environment with pinned aiohttp,
mocked RPC and no provider credentials. Bootstrap with:

```sh
bun --version
bash scripts/ci-bun-install.sh
bun scripts/ensure-dev-native.ts
```

Run standard pre-commit before every source commit/push, plus the installed Git hook. Do not bypass hooks,
weaken gates or count skipped mandatory jobs as passes:

```sh
pre-commit run
bun run pii:gate -- --scope staged
bun run check
bun run check:docs-quality
bun test --cwd packages/coding-agent test/remote-control --max-concurrency=2
bun run test
bun run ci:test:smoke
```

The WebRTC adapter regressions and browser JavaScript build run automatically through `bun run test:ts`,
the existing CI entrypoint. Exact current command outputs and failed-run logs are retained privately under
`~/xcsh-publication-20261025/`; latest commit/check receipts are published in each PR.

## Installed provenance and permissions

The NUC backend is **23.9.5**, source `438970848b9f3f538cabd9e2ba2284adfe148a12`, executable SHA256
`da314f93c46e454f81dc831789e75733a094cd75f6e298a6420665afdbe8102d`.
Immutable executable is beneath `~/xcsh-voice-cleanroom-20261021/qualification/artifacts/`, keyed by full commit
and hash. Policy revision 26 SHA256 is `8e878bc4508b4cb4b6558bd86db9012102a281cdd8a79f2053fa5e94151a8223`.
The user systemd service `xcsh-uat.service` owns backend startup and controller-managed replacement.
Read-only checkpoint inspection observed it active/running and verified both running backend executable hashes.

The client source is `3c4596b7da463bad3020fd457c21c8e57c1651c1`, frozen tree SHA256
`bc2a22b0cb65e92acfa7552f271f9b1fa84f5df23d78c87aede58b807afa91ee`, retained under
`qualification/owned-phone-artifacts/`. Its private HTTPS Python adapter and physical observer are separate
processes, described in `qualification/owned-phone-runtime/runtime.private.json`, `process.private.json`,
and `physical-monitor-process.private.json`. Do not assume a shell-launched adapter has durable startup ownership.
The backend was not replaced by the prototype and is not replaced by publication branch artifacts.

Fresh host registration and native phone pairing were established during historical qualification.
Current registration/pairing snapshot: October 25 read-only inspection: host enabled/enrolled, relay connected, one paired iOS client, zero active voice sessions.
Retain the host ChatGPT subscription credential; frontend assets do not receive provider credentials.
The prototype authenticates with a separate private connection token and creates only owned calls through Unix RPC.
Native remote sessions and owned-client threads retain **workspace-write/on-request** permissions.
Read-only/never applies only to dedicated synthetic cycle fixtures, not the real phone permission policy.

Rollback references include the original immutable executable, `qualification/installation.private.json`,
the controller campaign `~/xcsh-voice-cleanroom-20261021/nuc-voice-cleanroom-438970848b-da314f93c46e`, and
historical cleanout archive `~/xcsh-uat-lab/voice-subscription-20261021/cleanout-1792637589163632152`.
That archive contains old state/units; it is recovery evidence, not permission to restore obsolete pairings.

## Validation and known failures

| Layer | Evidence and result | Limit |
| --- | --- | --- |
| Historical source, Bun 1.4.3 | 513 affected voice tests; 35 docs checks; 328 Rust tests; full Bun 13,897 pass, 1,080 skip, 0 fail | Earlier failures and SIGSEGV remain preserved; not publication CI |
| Historical compiled artifact | Normal build; voice, Vertex auth, API specs, QMD and Terraform docs checks passed | Applies to retained 4389708 artifact |
| Installation and lifecycle | Fresh enrollment; installed hash verified; five passing replacement cycles; installed quiet synthetic probe and provider closure | Earlier replacement and capture-assessment failures remain separate |
| Native automated policy | Actual source-owned creation carried policy; attachment avoided rejected behavioral mutations; native config/read exposed policy | Native phone startup-policy consumption remains unproven |
| Native physical identity | Failed: identified as ChatGPT and added unsolicited follow-up | No unchanged retry; no native voice acceptance |
| Owned-client source | Four mocked adapter tests, browser JS build, TypeScript and commit checks passed historically | Physical iPhone Safari/Home Screen behavior pending |
| Owned-client automated speech | xcsh identity; 426 media frames; zero startup peak; provider closure | Automated result does not accept the phone |
| Fresh publication | Both streams: 13,934 Bun pass / 1,080 skip / 0 fail; 328 required Rust tests pass without skips; 35 docs tests pass; pre-commit, source checks, native readiness and CLI smoke pass; WebRTC additionally 4 mocked adapter tests and browser build pass | Source and CI only; final heads/check links in PR comments |
| Physical/endurance | Two fresh owned-client calls pending, second at least 20 minutes | Human hearing/voice required; engine replacement unobserved means tested duration only |

Native subscription append rejection, native identity failure, earlier full-suite failures, replacement failures,
and failed capture assessments remain private and immutable. Evidence roots include
`qualification/failed-phone-evidence-1792674635531995745`,
`physical-call1-failure-1792674619659347878.private.json`,
`live-source-probe/owned-identity-1792674936185314206`,
`owned-phone-runtime/automated-probe-1792676133122137057`, and
`owned-phone-runtime/physical-window.private.json` beneath the NUC qualification root.
Private receipt SHA256 values: source-candidate `191f3831cbdc1893916545539b19e3b9d5b714040981773a8f5d6e2905e874af`;
artifact metadata `6b8ed1338d1658929ba5bd7d1b5a78dc0f29e3e919abc3c08534d857e8c9eb1e`;
automated owned-client result `28424121bc8333ab2bb5f2726d3e9cc1fa7052bd67b8d429d03a0c7f620b189e`.
Private transcripts, pairing records, QR/connection links, SDP, audio, TLS material and raw traces must stay private.

## Resume procedure

1. Read this file, both linked issues/PRs and the dated comments on #4406/#4408. Query each PR's current head,
   required checks, state and auto-merge request. Keep save-phase completion separate from client acceptance.
2. Verify delivery SSH identity and canonical GitHub origin; fetch current `main` and publication/recovery refs.
   Verify full original SHAs against the table and private bundle manifests. Preserve unrelated dirty work.
3. Choose one stream: native baseline for native registration/backend fixes, or WebRTC continuation for the owned
   Home Screen client. Create a fresh worktree from that publication branch. Inspect its diff against `main`
   and against the native baseline before editing. Do not mix client acceptance claims.
4. Bootstrap exact declared Bun and source-matched native addon; run pre-commit, repository and affected tests.
   Locate private evidence on the NUC and control workspace through the paths above; never upload raw records.
5. Read runtime/service/client manifests privately. Verify `/proc/<PID>/exe`, executable SHA256, source revision,
   service ownership, registered host, pairing, workspace and permissions independently. A default CLI symlink,
   source checkout, HTTP response or readiness event does not prove installed provenance or speech acceptance.
6. Continue only the selected development stream under fresh explicit scope. For a failed physical case,
   implement a changed hypothesis/candidate and validate it before arming fresh captures. Automate inventories,
   transcripts and backend receipts; ask humans only for phone hands, eyes and voice. Preserve all failure evidence.
7. For future owned-client acceptance, require two fresh captured read-only phone calls, second at least 20 minutes,
   with human identity/audio, pause/interrupt/filler/English/brief-reply/list/technology outcomes. Keep native
   startup-policy consumption and native acceptance separate, even if the owned client passes.

No CE/KVM deployment, approval-policy relaxation, managed-Mac Xcode installation, live runtime replacement,
or pairing revocation is authorized by this checkpoint. Historical append-only private checkpoint prose is
context, not a current instruction source.
