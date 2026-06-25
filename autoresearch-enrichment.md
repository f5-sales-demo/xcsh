## Benchmark

- command: bash autoresearch-enrichment.sh
- primary metric: enrichment_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - constraint_accuracy
  - field_coverage
  - oneof_accuracy

## Files in Scope

- packages/coding-agent/src/internal-urls/terraform-index.generated.ts
- packages/coding-agent/scripts/generate-terraform-index.ts

## Off Limits

- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify constraint_prober.py directly
- requires XCSH_API_URL and XCSH_API_TOKEN in environment (namespace: r-mordasiewicz)
- when checks fail, route to the correct upstream repo per triage report
- after upstream fix: run `bun --cwd=packages/coding-agent run generate-terraform-index`, then restart
