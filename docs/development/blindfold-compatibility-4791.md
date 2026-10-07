# Blindfold secrets compatibility

Historical v22.15.0 contract. Its selected interfaces did not prove executable-only
replacement in the BYOC article: location output, snake_case documents and policy
defaults differ from vesctl. [Issue 4803 acceptance](blindfold-interchangeability-4803.md)
corrects that scope and records the new container interchangeability qualification.


Frozen reference, before implementation: Docker Hub `kreynoldsf5/vesctl@sha256:6ef8dc145b53130273bca4d3400ff9349e057ae36ed8e36d943eb1465e7edd82`.
Version `0-2-24`, source `394fae804d196ebd18fa24b14e39c178f64485d7`, build timestamp `2021-08-24T17:39:03+00:00`.
Published image pulled on Ubuntu. All six help levels and version returned exit 0, help on stdout, empty stderr.
Reference gets only read-only synthetic fixtures and no tenant credentials. Retrieval cannot run without credentials; it fails before contacting a credential-free loopback fixture server.

| Interface | Pinned vesctl observation | xcsh selected contract |
| --- | --- | --- |
| Command paths | request secrets get-public-key, get-policy-document, encrypt | Same three paths, native service |
| Policy selection | --namespace, --name; namespace default default | --namespace/-n, --name; default shared/ves-io-allow-volterra |
| Namespace short flag | -n rejected, exit 1 | Supported for secret policy |
| Public material | Native data wrapper accepted in synthetic encryption | Single JSON/YAML data wrapper |
| Flat fields | Panics, exit 2 | Reject unsupported/ambiguous document |
| Encryption input | Exactly one positional filename | Positional, --input, -, redirected stdin |
| stdin | - treated as filename; missing positional rejected | Bounded native asynchronous read, cancellation |
| Encryption stdout | Banner then bare Base64; empty stderr, exit 0 | One string:/// value and newline |
| Usage errors | Exit 1; diagnostics duplicated on stdout and stderr | Exit 2, diagnostic only on stderr |
| Output selection | --outfmt global format, --output directory, --outfile artifact | `--output json` or `--output yaml` on retrieval only; native `--output-file`/`--result-file`/`--json` |
| Authentication | Requires legacy config or credential flags | Native xcsh context only |

Explicitly unsupported: request aliases req/r, general request/rpc/configuration commands, build-blindfold-bundle, --key-version, --policy-doc (stale help example), --outfile, --outfmt, -o, --config, --server-urls/-u, --p12-bundle, --cert/-c, --key/-k, --cacert/-a, --hw-key, --show-curl, --timeout, .vesconfig and VES credential variables.
The selected --output has xcsh format semantics. JSON remains the default. Random ciphertext is qualified by independent decryption/field checks.

## Delivery tasks

- Reference help and synthetic observations: recorded above; private observations outside checkout.
- Fresh Ubuntu worktree and prescribed dependency bootstrap: passed at base 02b803e90e409fdf421f86b2be41f145ae9a8983.
- Planning: named rigor skills unavailable in installed skill inventory; this contract and issue 4791 provide the explicit plan and completion ledger.
- CLI TDD red: missing blindfold-args module, exit 1; three tests awaiting implementation.
- Native TDD red: missing asynchronous export; service TDD red: supplied files rejected for absent credentials. Both corrected.
- Focused verification: 48 tests across eight files, 226 assertions, zero failures (including assistant offline containment). Independent recovery of pinned vesctl and native envelopes validates tenant/version/policy/exponent/modulus and all binary plaintext bytes.
- Process acceptance: file and explicit/implicit stdin, legacy configuration isolation, invalid usage before input, SIGINT 130, oversized stdin, stdout separation and broken pipe passed. Offline startup bypasses context and resource modules.
- TypeScript: full check:ts passed. Rust: check:rs passed; test:rs passed (328 tests across the component runs).
- Bootstrap environment: first full TypeScript run lacked the pinned generated Terraform asset. Sequential generator produced reviewed v15.2.0 SQLite and gzip hashes; package suite rerun completed: 10,080 passed, 562 skipped, one stale audit failure corrected by regeneration. An overlapping build/generator attempt failed and was stopped; no implementation claim relies on it.
- Standalone source build: passed with verified documentation/native assets; compatibility help and file/stdin offline encryption passed. This is candidate validation, not released installation acceptance.
- Source-boundary audit: regenerated after CLI changes; two tests and 1445 assertions passed. Refreshed 87 dependent authority digests; docs-quality contract passed.
- Candidate native-context acceptance: isolated saved context and project link, real public JSON/policy YAML retrieval and exact-document offline encryption passed with empty stderr.
- PR #4794: synced to current main, auto-merge enabled; hosted check and shell tests, Linux modern/macOS ARM64 native builds and container tests passed. Prose lint corrected by fencing literal format flags.
- Remaining: green PR CI and merge, immutable release, Ubuntu then Mac installed/live/assistant acceptance, public guide and cleanup.

## Released acceptance

Immutable [v22.15.0](https://github.com/f5-sales-demo/xcsh/releases/tag/v22.15.0), source `785fcc49cfabf4d097525639643fd3438a644412`, release workflow `37653536435`. Feature PR
PR #4794 and release PR #4798 merged; full feature and release code/native matrices passed. Intel native notarization verification passed on rerun after Apple had accepted the
submission.

Ubuntu standalone acceptance ran first, then an independent Mac Homebrew installation. Both created fresh private test CA/protected keys, retrieved JSON/YAML through a saved native
context, encrypted offline via file and stdin, supplied the exact location to existing `xcsh create`, attached a fresh fixed-response HTTP-LB, and verified strict CA trust,
intended SNI, matching fingerprint and HTTPS 200. Existing `xcsh update` rotated the certificate; changed fingerprint and HTTPS 200 passed. Generic resource CLI received the
matching native credential snapshot through its existing environment interface.

Each installed host ran two assistant prompts with file paths and required artifacts. Private provider requests, tool results, stdout/stderr were scanned for
key/password/token/ciphertext markers; zero leaks. Mac CLI and native hashes match published provenance, strict codesign passes, and both are accepted as Notarized Developer ID.
Ubuntu binary/provenance checksums and embedded native digests match immutable GitHub assets.

Linux x64 binary SHA-256: `0e64b0ac0975168e03d867d7d6629fa88f2e5506d789dbc161caa3be50fe06a6`. Mac ARM64 binary: `f97008269551ad7ebb84dfa23dc3048da2bc464cc9683e39dc6c6a5d43acc9ca`; native: `312b82bde28eac6dc9fac4fd3a20f9d37d611a641bda6d12f83e319a4dfa8596`.

Private per-host ownership/expiry/teardown records retain the released demos. Candidate auxiliary resources are removed during cleanup. Guide publication and task worktree retirement are tracked in #4799.
