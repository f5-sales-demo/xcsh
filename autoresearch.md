## Benchmark

- command: F5XC_API_URL=https://f5-amer-ent.console.ves.volterra.io F5XC_API_TOKEN=OULzp2FaqP1FTmgygm1dn5BDfYA= bash autoresearch-smsv2.sh
- primary metric: smsv2_payload_score
- metric unit: pct
- direction: higher
- secondary metrics:
  - smsv2_deployment_score
  - smsv2_mesh_score

## Files in Scope

- .xcsh/skills/
- packages/coding-agent/src/prompts/tools/xcsh-api.md
- packages/coding-agent/src/internal-urls/api-catalog-resolve.ts

## Off Limits

- autoresearch-smsv2.sh
- autoresearch-smsv2-phrases.yaml
- autoresearch-smsv2.checks.sh
- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify the benchmark scripts
- each option test must result in HTTP 200 from F5 XC API
- all test resources are prefixed ar-test-smsv2-*
- SMSv2 sites always created in system namespace
- prerequisite objects (firewall policies, log receivers, cluster groups) created in r-mordasiewicz namespace
- dc_cluster_group and site_mesh_group prerequisites created in system namespace
- when T2 or T3 fail, stop and fix the deployment/mesh issue first
- requires F5XC_API_URL and F5XC_API_TOKEN in environment
- requires Azure CLI (az) authenticated for T2 and T3
