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
- Remaining delivery: CI/review/merge,
  breaking immutable release, released Ubuntu then independent Mac Homebrew
  live/assistant acceptance, sanitized receipts, guide publication and cleanup.
