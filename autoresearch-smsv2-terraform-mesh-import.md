## Benchmark

- command: F5XC_API_URL=https://f5-amer-ent.console.ves.volterra.io F5XC_API_TOKEN=OULzp2FaqP1FTmgygm1dn5BDfYA= bash autoresearch-smsv2-terraform-mesh-import.sh
- primary metric: smsv2_tf_import_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - smsv2_tf_advanced_t1_score
  - smsv2_tf_advanced_t2_score
  - smsv2_tf_advanced_t3_score

## Files in Scope

- .xcsh/skills/
- packages/coding-agent/src/prompts/tools/xcsh-api.md
- packages/coding-agent/src/internal-urls/api-catalog-resolve.ts

## Off Limits

- autoresearch-smsv2-terraform-mesh-import.sh
- autoresearch-smsv2-terraform-mesh-import-phrases.yaml
- autoresearch-smsv2-terraform-mesh-import.checks.sh
- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify the benchmark scripts
- all test resources prefixed ar-test-mesh-*
- SMSv2 sites and site_mesh_group always in system namespace
- HTTPS auto-cert LB in r-mordasiewicz namespace
- virtual site in r-mordasiewicz namespace
- requires F5XC_API_URL and F5XC_API_TOKEN
- requires Azure CLI (az) authenticated for T2 and T3
- terraform import test: "No changes" after plan = PASS
- when Terraform HCL is wrong → fix_repo=xcsh
- when provider Read produces drift → fix_repo=terraform-provider-f5xc
