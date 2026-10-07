# Issue 4750 delivery ledger

Candidate base: `9bebb2ecc9763c343cf21162b5f1198ade67d003` (`origin/main`, v22.13.0).
Branch: `feature/issue-4750-native-blindfold`; fresh Ubuntu worktree under `.worktrees/feature/issue-4750-native-blindfold`.

## Planning and audit

Implement one Rust native input/encryption boundary, shared TypeScript service, CLI and assistant adapters. Follow the binary contract in `blindfold-protocol.md`; preserve complete public exponent and avoid the retired provider's OAEP format. Deploy only owned lab resources. Credentials and test CA/key/runtime evidence stay outside the checkout. Repository named rigor skills were unavailable; planning, TDD evidence and this completion ledger record the required process directly.

## Acceptance ledger

| Check | Command or operation | Expected | Actual | Evidence |
| --- | --- | --- | --- | --- |
| Bootstrap | `bash scripts/ci-bun-install.sh`; `bun scripts/ensure-dev-native.ts` | Source-matched addon | Passed | Private bootstrap logs; native receipts |
| TDD red | `bun test packages/natives/test/blindfold.test.ts` | Missing new native export | Failed on missing blindfoldPrepare | Session test transcript |
| Service TDD red | `bun test packages/coding-agent/test/blindfold-service.test.ts` | Missing shared service | Failed on absent module | Session test transcript |
| Native inputs/protocol | Focused three-file tests | Independent secret recovery; supported formats; failure boundaries | 27 passed, 118 assertions | Public native-live receipt |
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
| Full TS suite | `bun run test:ts` after prescribed optional-loader reset | Full pass | Unqualified: unrelated five-second test timeouts; isolated plugin/Office checks passed; hosted CI required | Private stable-suite log |
| Hosted native matrix | Existing CI full_native_matrix | All supported platforms | Pending | Future workflow receipts |
| Delivery | Commit/push/linked PR/CI/merge/release | Released installation and public docs | Commit d48ba1b2b, PR #4752; CI/release pending | Issue #4750 |

Completion requires the final delivery rows. Local packaging acceptance is distinct from released-installation acceptance. The retained demo expires 30 days after its private creation timestamp; ownership, CA and teardown commands are recorded privately. No provider function integration is included.
