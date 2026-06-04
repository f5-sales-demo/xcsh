## Benchmark

- command: F5XC_API_URL=https://nferreira.staging.volterra.us F5XC_API_TOKEN=UKYwInouPVFHEjmjGBbj3/A4jiY= bash autoresearch-crud.sh
- primary metric: crud_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - create_pass_rate
  - read_pass_rate
  - update_pass_rate
  - delete_pass_rate

## Files in Scope

- packages/coding-agent/src/prompts/tools/xcsh-api.md
- packages/coding-agent/src/internal-urls/api-catalog-resolve.ts
- .xcsh/skills/

## Off Limits

- packages/coding-agent/src/autoresearch/
- autoresearch-crud.sh
- autoresearch-crud-phrases.yaml
- autoresearch-crud.checks.sh

## Constraints

- do not modify the autoresearch framework itself
- do not reduce the number of test phrases
- do not modify the benchmark script or phrases YAML
- each phrase must result in the resource existing (create/update) or being absent (delete) as verified by direct API call
- test namespace is r-mordasiewicz, all test resources are prefixed ar-test-*
- when autoresearch-crud.checks.sh fails with cross-repo issues, stop and address the upstream dependency before continuing
- fixes to api-specs-enriched or terraform-provider-f5xc go in those repos, not xcsh
