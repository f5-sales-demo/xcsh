# Issue 4750 delivery ledger

Candidate base: `9bebb2ecc9763c343cf21162b5f1198ade67d003` (`origin/main`, v22.13.0).
Branch: `feature/issue-4750-native-blindfold`; fresh Ubuntu worktree under `.worktrees/feature/issue-4750-native-blindfold`.

## Planning and audit

Implement one Rust native input/encryption boundary, shared TypeScript service, CLI and assistant adapters. Follow the binary contract in `blindfold-protocol.md`; preserve complete
public exponent and avoid the retired provider's OAEP format. Deploy only owned lab resources. Credentials and test CA/key/runtime evidence stay outside the checkout. Repository
named rigor skills were unavailable; planning, TDD evidence and this completion ledger record the required process directly.

## Acceptance ledger

| Check | Command or operation | Expected | Actual | Evidence |
| --- | --- | --- | --- | --- |
| Bootstrap | `bash scripts/ci-bun-install.sh`; `bun scripts/ensure-dev-native.ts` | Source-matched addon | Passed | Private bootstrap logs; native receipts |
| TDD red | `bun test packages/natives/test/blindfold.test.ts` | Missing new native export | Failed on missing blindfoldPrepare | Session test transcript |
| Service TDD red | `bun test packages/coding-agent/test/blindfold-service.test.ts` | Missing shared service | Failed on absent module | Session test transcript |
| Native inputs/protocol | Focused three-file tests | Independent secret recovery; supported formats; failure boundaries | 28 passed, 119 assertions; later ABI regressions: 29 native tests passed | Public native-live receipt |
| TypeScript | `bun run check:ts` | All checks pass | Passed before temporary packaging loader reset | Private check logs |
| Rust | all-target Clippy, `bun run test:rs` | Pass | Passed | Private Rust logs |
| Package | `bun --cwd=packages/coding-agent run build` | Standalone CLI | Passed | Private build log |
| Package runtime | Compiled CLI help, dry-run, explicit replace | Native runtime and tenant readback | Passed | Public native-live receipt |
| Containment | Scan 29 captured requests/results/logs/reports | No plaintext keys/tokens | Zero leaks | Public native-live receipt |
| Live RSA | `bun run dev blindfold create`; fixed-response LB create; TLS | Trusted SNI/VIP TLS, matching fingerprint, HTTP 200 | TLS 1.3, matching RSA fingerprint, HTTP 200 | Public sanitized receipt; private runtime |
| Rotation | `bun run dev blindfold replace` second RSA pair; TLS | New fingerprint and HTTP 200 | Passed | Public sanitized receipt |
| Rejected rotation | RSA to EC on referenced resource | Existing certificate remains working | F5 HTTP 400; original RSA TLS intact | Public sanitized receipt |
| Live EC | Separate EC certificate, LB reference update; TLS | EC fingerprint and HTTPS | Passed | Public sanitized receipt |
| Retained demo | Restore rotated RSA LB reference; remove auxiliary EC | Final working demo; auxiliary absent | RSA TLS verified; EC GET 404 | Private ownership/expiry/teardown record |
| Docs | docs-quality, unittest, PII enforcement | Source-backed guide and safe evidence | Passed; 28 checker tests | docs/en guide and evidence manifest |
| Full TS suite | `bun run test:ts` after prescribed optional-loader reset | Full pass | Final feature CI passed: 9,996 passed, zero failures; bounded process checks repaired | Private stable-suite log |
| Hosted native matrix | Existing CI full_native_matrix | All supported platforms | Passed all eight variants | Release CI 37591704077 |
| Delivery | Commit/push/linked PR/CI/merge/release | Released installation and public docs | Merged #4752, #4770, #4774, #4780; v22.14.4 immutable; installed TLS passed | Issue #4750 |

The delivery rows are accepted against immutable v22.14.4. The retained demo expires 30 days after its private creation timestamp; ownership, CA and teardown commands are recorded privately. No provider function integration is included.

## Released installation acceptance

Release: https://github.com/f5-sales-demo/xcsh/releases/tag/v22.14.4
Source commit: `cd5b50251630100e05a402552a68814003abd8bd`; workflow run `37591704077`.
Linux x64 binary SHA-256: `385172b1652b899797ab927f7f651321bd0ebf8fb16a83ae7d8342c37f6e736e`.
The binary, checksum, provenance and baseline/modern addons match GitHub immutable asset digests. Both native variants load independently on Debian 12; the standalone binary reports `xcsh/22.14.4` and its Blindfold help works there.

Installed protected PEM replacement and PKCS#12 replacement passed. A fresh protected RSA key pair was then rotated into the retained demo; trusted SNI/VIP TLS served the matching
public fingerprint and returned HTTP 200 over TLS 1.3. Name collision and mismatched-key replacement failed without damaging the endpoint. Private ownership/expiry/teardown records
were updated to the final retained certificate.

The public guide at https://f5-sales-demo.github.io/xcsh/en/f5-distributed-cloud/blindfold-certificates/ returns HTTP 200. Auxiliary EC resource absence was confirmed by named HTTP
404. Actual tenant identities, private keys, passphrases, tokens and encrypted payloads stay outside this public ledger.

The installed Linux ABI failure in immutable v22.14.2 was reproduced on Debian 12 and repaired in #4780. Target-specific Clang wrappers bind vendored OpenSSL to napi's release sysroot; unsupported unversioned C23 libc symbols are rejected before publication. Prior immutable assets were preserved.
