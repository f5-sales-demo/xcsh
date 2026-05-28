## Benchmark

- command: bash autoresearch-terraform.sh
- primary metric: composite_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - validate_pass_rate
  - keyword_match_rate
  - avg_turns
  - plan_pass_rate

## Files in Scope

- packages/coding-agent/src/internal-urls/terraform-resolve.ts
- packages/coding-agent/src/internal-urls/terraform-index.generated.ts
- .xcsh/skills/terraform-provider/

## Off Limits

- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify the autoresearch framework itself
- do not reduce the number of test phrases
- each phrase must produce valid terraform or be counted as a failure
- preserve existing xcsh:// protocol routes
- when autoresearch.checks.sh fails with cross-repo issues, stop and address the upstream dependency before continuing
- after upstream fix: run `bun --cwd=packages/coding-agent run generate-terraform-index` to refresh the embedded index, then restart autoresearch
