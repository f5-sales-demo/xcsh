## Benchmark

- command: bash autoresearch-crud.sh
- primary metric: crud_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - create_pass_rate
  - read_pass_rate
  - update_pass_rate
  - delete_pass_rate

## Files in Scope

- .xcsh/skills/terraform-provider/

## Off Limits

- packages/coding-agent/src/autoresearch/

## Constraints

- always clean up ar-test-* resources in namespace r-mordasiewicz after each run
- do not modify constraint_prober.py or validate_curl_examples.py directly
- when checks fail, stop and fix the upstream repo indicated in triage report
- requires F5XC_API_URL and F5XC_API_TOKEN in environment
- after upstream fix: run `bun --cwd=packages/coding-agent run generate-terraform-index`, then restart
