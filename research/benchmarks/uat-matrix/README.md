# Console-UI UAT Matrix

A comprehensive, **human-watchable** UAT matrix that feeds natural-language prompts to
`xcsh --print` and verifies outcomes across four modalities:

| Modality | Input corpus | What it tests | Verify |
|---|---|---|---|
| **console** | `corpora/console.yaml` (deep-nested) | NL → live console UI via `catalog_workflow_runner` (observable, watched in Chrome) | runner step-table + API GET |
| **json** | `corpora/crud.yaml` | NL → API CRUD | API GET (200/404) |
| **hcl** | `corpora/terraform.yaml` | NL → Terraform HCL | `terraform validate` (or keyword presence) |
| **i18n** | `corpora/i18n.yaml` | same configs in 12 languages → HCL | keyword presence |

The console modality drives your **real Chrome** (F5-red indicator + per-step delay) so you
can watch every create/read/delete, including deep-nested object creation
(origin-pool → app-firewall → http-load-balancer with cross-references, and the full
`waap-full-stack`). All console resources use the `uat-` prefix.

The corpora are maintained release-validation inputs. They do not modify the built-in autoresearch subsystem or the console catalogue.

## Prerequisites

- **Console modality**: build + load the extension (`chrome://extensions` → Load unpacked → `xcsh-chrome-extension/dist/`), run `xcsh chrome setup`, and have Chrome open. The harness logs in automatically with `XCSH_USERNAME`/`XCSH_CONSOLE_PASSWORD`; the session then persists across `xcsh` runs.
- **HCL modality** (optional authoritative check): `terraform` on `PATH`. Without it, HCL falls back to keyword-presence.
- `xcsh` on `PATH` (or set `XCSH_BIN`).

## Environment

```bash
export XCSH_API_URL="https://example.staging.volterra.us"
export XCSH_API_TOKEN="<set in environment>"     # API GET verification + cleanup
export XCSH_USERNAME="<set in environment>"      # console login
export XCSH_CONSOLE_PASSWORD="<set in environment>"
export XCSH_NAMESPACE="demo"
```

## Run

```bash
cd packages/coding-agent

# 0) Verify the harness itself FIRST (no side effects):
bun scripts/uat-matrix.ts --dry-run                       # corpus parse + router-trigger check
bun scripts/uat-matrix.ts --self-test-api                 # API token + GET plumbing

# 1) Watched single smoke (you watch Chrome):
bun scripts/uat-matrix.ts --modalities console --filter '^C-HC-01$' --observable
bun scripts/uat-matrix.ts --modalities console --filter '^C-HC-02$' --observable

# 2) One of each headless modality:
bun scripts/uat-matrix.ts --modalities json,hcl,i18n --limit 1

# Full console run, observable (watch the whole thing):
bun scripts/uat-matrix.ts --modalities console --observable

# Everything (console first/observable, then json,hcl,i18n):
bun scripts/uat-matrix.ts

# Cleanup only (delete leftover uat-* / ar-test-* resources):
bun scripts/uat-matrix.ts --cleanup-only
```

Flags: `--modalities`, `--observable/--no-observable`, `--delay-ms`, `--limit`, `--filter <regex over ids>`,
`--no-cleanup`, `--cleanup-only`, `--dry-run`, `--self-test-api`, `--strict-nl` (drop the console guardrail to
measure raw router accuracy), `--report-dir`.

## Output

`research/benchmarks/uat-matrix/reports/<timestamp>/` (ignored by Git):
- `report.md` — the matrix (modality × resource × operation × phrase-id → status, duration, HTTP, routed, detail), per-modality pass-rate `METRIC` lines, a router-determinism section, and an `ASI failures` block.
- `report.json` — machine-readable cells + summary.
- `screenshots/<phrase-id>/step-*.png` — per-step console screenshots.

Cleanup runs automatically on exit (unless `--no-cleanup`), deleting `uat-*` (in `demo`) and
`ar-test-*` (in `example-corp`) resources, parents before children.
