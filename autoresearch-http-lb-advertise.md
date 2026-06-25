## Benchmark

- command: XCSH_API_URL=https://f5-amer-ent.console.ves.volterra.io XCSH_API_TOKEN=OULzp2FaqP1FTmgygm1dn5BDfYA= bash autoresearch-http-lb-advertise.sh
- primary metric: http_lb_advertise_payload_score
- metric unit: pct
- direction: higher
- secondary metrics: none

## Files in Scope

- .xcsh/skills/
- packages/coding-agent/src/prompts/tools/xcsh-api.md
- packages/coding-agent/src/internal-urls/api-catalog-resolve.ts

## Off Limits

- autoresearch-http-lb-advertise.sh
- autoresearch-http-lb-advertise-phrases.yaml
- autoresearch-http-lb-advertise.checks.sh
- packages/coding-agent/src/autoresearch/

## Constraints

- do not modify benchmark scripts
- all test resources prefixed ar-test-lb-adv-* or ar-test-vs-*
- test LBs in namespace r-mordasiewicz
- virtual sites in namespace r-mordasiewicz, type CUSTOMER_EDGE
- origin pool ar-test-lb-adv-pool must exist before T1 runs (created by setup)
- when xcsh uses wrong advertise field, fix_repo=xcsh
- when xcsh uses wrong network enum value, fix_repo=api-specs-enriched
- when API rejects payload (400/422), fix_repo=api-specs-enriched
- requires XCSH_API_URL and XCSH_API_TOKEN
