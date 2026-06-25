## Benchmark

- command: XCSH_API_URL=https://f5-amer-ent.console.ves.volterra.io XCSH_API_TOKEN=OULzp2FaqP1FTmgygm1dn5BDfYA= bash autoresearch-smsv2-terraform.sh
- primary metric: smsv2_tf_validate_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - smsv2_tf_plan_score
  - smsv2_tf_deployment_score
  - smsv2_tf_mesh_score

## Files in Scope

- .xcsh/skills/
- packages/coding-agent/src/prompts/tools/xcsh-api.md
- packages/coding-agent/src/internal-urls/api-catalog-resolve.ts

## Off Limits

- autoresearch-smsv2-terraform.sh
- autoresearch-smsv2-terraform-phrases.yaml
- autoresearch-smsv2-terraform.checks.sh
- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify the benchmark scripts
- each option test must produce valid Terraform HCL that passes terraform validate
- all test resources are prefixed ar-test-smsv2-*
- xcsh_securemesh_site_v2 resources always in system namespace
- prerequisite policy objects (enhanced_firewall_policy, forward_proxy_policy) must be in system namespace
- dc_cluster_group and site_mesh_group must also be in system namespace
- when schema validation errors appear (UNSUPPORTED_ARGUMENT), the fix goes to terraform-provider-xcsh
- when API payload errors appear during plan, the fix goes to api-specs-enriched or terraform-provider-xcsh
- requires XCSH_API_URL and XCSH_API_TOKEN for terraform plan stage
- requires Azure CLI (az) authenticated for T2 and T3
