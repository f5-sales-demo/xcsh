# Blindfold interchangeability acceptance

Issue [#4803](https://github.com/f5-sales-demo/xcsh/issues/4803) corrects the
v22.15.0 compatibility contract. The earlier #4791 acceptance proves native
certificate/TLS behavior with xcsh's selected interfaces; it does not prove
executable-only replacement in the BYOC article. Its location output, snake_case
documents and policy defaults differ from container vesctl.

The reference is frozen at article revision
`e7acf7fd53b2f19d9aca7ca43f23e47c2187ab9e`. Relevant commands and the consumer
expression are in `packages/coding-agent/test/fixtures/blindfold/article.json`.
The README says the file contains a location; the actual consumer prepends
`string:///` to bare base64. No upstream files or deployment stack were changed.
The article uses deprecated `volterra`; the unreleased next-generation
`f5-sales-demo/terraform-provider-xcsh` remains under feature iteration. Future
Blindfold provider development is separate from this CLI acceptance.

## Frozen container reference

All vesctl probes ran inside Ubuntu Docker containers using
`kreynoldsf5/vesctl@sha256:6ef8dc145b53130273bca4d3400ff9349e057ae36ed8e36d943eb1465e7edd82`.
Historical version: `0-2-24`, source
`394fae804d196ebd18fa24b14e39c178f64485d7`. Downloaded `0.2.47` was run exclusively
inside that container after verifying binary SHA-256
`35d29e517498feff9f12a41ff702e90f10a1cc8a20c589c3e524474dbfe53801`.

Synthetic HTTPS serves read-only public documents under `/api`, with synthetic
certificate credentials. Offline encryption containers use `--network none`.
Frozen pre-implementation help, requests, formats, stdout/stderr, exits and raw
artifact observations are in `container-reference-before.json` beside the
sanitized public fixtures. Ciphertext is represented by lengths and hashes in
that public observation file.

| Observation | Both container versions |
| --- | --- |
| Public key path | `/api/secret_management/get_public_key?key_version=0` by default; explicit positive version sent unchanged |
| Policy path | `/api/secret_management/namespaces/{namespace}/secret_policys/{name}/get_policy_document` with name/namespace query parameters |
| Retrieval | camelCase YAML; observed `--outfmt json` and `yaml` both return YAML |
| Policy selectors | required name; namespace defaults to `default` |
| Encryption stdout | banner plus bare base64; empty stderr, exit 0 |
| Binary outfile | raw envelope, 2622 bytes for synthetic 2048-byte input; empty stdout/stderr, exit 0 |
| Encryption outfmt | does not alter ciphertext encoding |

xcsh supports explicit JSON/YAML selection for public documents. It checks a
positive requested version against the returned version instead of accepting
the fixture's deliberately mismatched response. Zero selects server default.

## Repeatable automated acceptance

```bash
bun test packages/coding-agent/test/blindfold-producer-matrix.test.ts \
  packages/coding-agent/test/blindfold-interchangeability.test.ts --max-concurrency 2
python3 scripts/uat-blindfold-reference.py --run-dir /private/new-reference-run
```

The reference command requires Docker-capable Ubuntu, Python cryptography, Bun
and a successfully bootstrapped source/native build. It downloads only the
verified reference binary. It never executes vesctl on the host and never gives
a container tenant credentials. Ordinary CI runs deterministic checked-in
fixtures without Docker or network access.

The deterministic matrix covers reference/native producers, camelCase,
snake_case, agreeing mixed aliases, JSON/YAML, independent binary plaintext
recovery and raw output. Conflict, duplicate-key, multi-document, malformed
field, version, format/output conflict, symlink, existing file, cancellation,
size and assistant boundary tests complete the focused regression checks.
Random ciphertext is never compared byte-for-byte.

## Live acceptance command

```bash
python3 scripts/uat-blindfold-live.py --executable /absolute/installed/xcsh \
  --run-dir /private/new-live-run --context approved-context \
  --namespace approved-lab-namespace --timeout 300
```

The selected native context must already exist. Its private export supplies the
same credential snapshot to existing resource commands. The run uses a fresh
mode-0700 directory, fresh resource names and checked subprocess exits. It
qualifies public document retrieval, the bare-base64 consumer, canonical
location/stdin/YAML, mode-0600 binary artifacts, public reports, named certificate
readback, private CA trust, intended SNI, fingerprint/HTTPS 200, ready/valid state
and rotation. Cleanup deletes only run-owned objects and verifies absence.
Optional `--retain-hours` records private ownership, expiry and teardown.

## Delivery ledger

- Fresh Ubuntu worktree: based on `159909645`, prescribed frozen bootstrap and
  source-matched native readiness passed. Named rigor skills were unavailable;
  the accepted user plan, issue and this ledger provide planning/audit records.
- TDD red: four adapter tests failed on missing defaults, aliases, exact-version
  request and raw output; green after implementation.
- Focused baseline: 51 tests, 297 assertions, zero failures. Expanded matrix:
  64 document combinations and raw/integrity checks, 656 assertions, passed.
- Reusable container UAT passed three times: 16 producer/consumer matrix cases across
  both reference versions; independent recovery, integrity, raw artifacts and
  exact substituted article pipeline passed. Final run also passed twelve reference JSON/YAML and camel/snake/agreeing-alias cases; conflicting reference aliases were observed accepted while xcsh rejects conflicts.
- Full TypeScript check passed. Rust gate reports no Rust-affecting changes;
  native protocol/certificate tests passed. Full suite initially lacked the
  pinned generated Terraform asset; that run was stopped, the reviewed asset
  generated and verified, then the suite restarted.
- Source-boundary audit regenerated; two tests and 1445 assertions passed.
- Candidate live harness passed: trusted CA/SNI/fingerprint and HTTPS 200, ready/valid state, fresh rotation, exact consumer, canonical stdin/YAML, secure raw files, public-report containment and verified run-owned cleanup. Initial harness readback used a replace form that omitted runtime state; fixed and rerun fresh. Failed run resources were also removed and verified absent.
- Candidate assistant: two successful file-only preparations, secure location artifacts and private provider/tool/stdout/stderr scans passed.
- Full TypeScript suite passed: coding-agent 10,088 passed, 562 skipped, zero failures; other workspace suites passed. Full check:ts, docs-quality and 28 checker tests passed; Python harness lint, prose lint and final diff checks passed.
- Feature PR #4804 merged at `580901c517c95dd3c581066410501705d8dc2ad4`.
  Final head CI `37678176558`, lint `37678177309` and container `37678176588`
  all passed. Release freshness was repaired through #4807 after authoritative
  Claude Code version drift; the gate remains enforced.
- Release PR #4808 merged at `e2f2413e7bd7a48dcbe12727b3a81af80824b790`.
  [v23.0.0](https://github.com/f5-sales-demo/xcsh/releases/tag/v23.0.0) is immutable.
  Full release native/code/test/install matrix passed in `37683390178`.
  Intel modern-addon notarization assessment passed on attempt 3 after Apple
  had already accepted the prior signed bundle; signing policy was preserved.
- Released Ubuntu standalone verified immutable binary/provenance/native hashes.
  Sales Demo native-context article pipeline, trusted CA/SNI/fingerprints/HTTPS 200,
  ready/valid state, rotation, canonical stdin/YAML, raw artifacts, public reports,
  two assistant preparations and provider/tool containment passed. Run-owned LB
  and certificate were deleted and absence verified. A first tenant run hit the
  route quota and was cleaned up; the user authorized Sales Demo for the retry.
- Mac Homebrew `23.0.0` CLI/native immutable hashes and strict Developer ID /
  notarization checks passed. Python strict CA acceptance exposed missing CA
  key-usage metadata in the harness; add explicit keyCertSign/cRLSign and rerun
  fresh after cleanup. No trust checks were relaxed.
- Mac strict CA live rerun passed: intended SNI/private CA/fingerprint/HTTPS 200, ready/valid state, fresh rotation, native-context article pipeline and canonical/raw regressions. Both run-owned resources and the first failed run resources were deleted and absence verified.
- Released Mac assistant: two successful file-only preparations and secure location artifacts; private provider/tool/stdout/stderr scans found no key, token or ciphertext leakage. Complete release workflow `37683390178` is green, including npm, Homebrew and MDM installed channel checks.
- Sanitized released acceptance receipt: `blindfold-interchangeability-receipt-4803.json`. Public guide/evidence publication tracked in #4805.
- Remaining delivery: public guide and final
  sanitized receipts/cleanup. Implementation and repair worktrees were retired
  after ignored-file inspection; private evidence remains outside Git.
