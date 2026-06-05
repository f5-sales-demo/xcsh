## Benchmark

- command: F5XC_API_URL=https://f5-amer-ent.console.ves.volterra.io F5XC_API_TOKEN=OULzp2FaqP1FTmgygm1dn5BDfYA= bash autoresearch-crud.sh
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

## Known Failure Pattern

The primary remaining failure is `http_loadbalancer create` (phrase 22 in autoresearch-crud-phrases.yaml).
Root cause: xcsh routes "Create an HTTP load balancer ... routing to origin pool X" to the terraform-provider
skill instead of xcsh_api, generating terraform HCL rather than calling the API directly.

This is a routing non-determinism. The terraform-provider SKILL.md description pulls in resource creation
requests that should go to xcsh_api. Improvements should make xcsh prefer xcsh_api for direct CRUD
operations (phrases that say "create/read/update/delete a resource") while preserving terraform skill
routing for explicit terraform requests ("generate terraform", "write terraform code", "import to terraform").

Baseline: crud_score=96.7% (3 failures from http_loadbalancer cascade)
Target: crud_score=100% (http_loadbalancer create must use xcsh_api, not terraform skill)
