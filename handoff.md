# api-specs-enriched Enrichment Pipeline — Resume Point

**Status:** Dependency audit complete. 6 issues filed. Ready to begin Tier 1 enrichment work (certificate, service_policy) once pipeline bugs are fixed.

## Active Repos

- **api-specs-enriched**: `f5xc-salesdemos/api-specs-enriched` — enrichment pipeline, config YAML, catalog compiler
- **xcsh**: `f5xc-salesdemos/xcsh` — CLI tool consuming enriched specs via `xcsh://api-catalog/`
- Latest release: api-specs-enriched **v2.1.75**, xcsh **v18.49.1**

## What's Complete

| Resource | Status | Notes |
|----------|--------|-------|
| healthcheck | COMPLETE | 11 gaps found and closed. Verified CRUD. |
| origin_pool | COMPLETE | 10 gaps found and closed. Verified CRUD. |
| app_firewall | PARTIAL | Min config + 7 oneOf fixed (#325/#326). Residual: 3 conditional-required false positives from #321, `staging_period` [1,20] constraint missing, no nested oneOf for detection_settings (8 groups). Tenant quota at 115 limit — must delete `xcsh-uat-*` objects before POST testing. |

## Open Issues

### Systemic / Pipeline Bugs

| Issue | Title | Impact |
|-------|-------|--------|
| [#321](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/321) | `required_fields` path comparison dead for sub-schemas | Affects every resource with oneOf — falsely marks oneOf variant fields as unconditionally required. Hit app_firewall, will hit service_policy, rate_limiter, certificate. |
| [#336](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/336) | DELETE min config leaks query params as request body | All unenriched resources show `fail_if_referred`, `name`, `namespace` in DELETE spec body. DELETE body should be `{}`. Root cause in `scripts/compile_catalog.py`. |
| [#337](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/337) | Placeholder min config `spec: value` for unenriched resources | 9 resources emit `"spec": {"spec": "value"}` instead of `"spec": {}`. Root cause in `scripts/utils/minimum_configuration_enricher.py` fallback path. |

### Per-Tier Enrichment

| Issue | Tier | Resources | Blocks |
|-------|------|-----------|--------|
| [#332](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/332) | Umbrella | All 14 LB dependencies | Full scorecard matrix and dependency graph |
| [#333](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/333) | Tier 1 | certificate, service_policy | Basic HTTPS LB demo |
| [#334](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/334) | Tier 2 | api_definition, api_discovery, rate_limiter_policy | API protection demos |
| [#335](https://github.com/f5xc-salesdemos/api-specs-enriched/issues/335) | Tier 3 | waf_exclusion_policy, user_identification, malicious_user_mitigation, sensitive_data_policy, protocol_inspection | Advanced security features |

## LB Dependency Tree

```
http_loadbalancer (FUTURE — blocked until all deps enriched)
├── origin_pool ............ COMPLETE
│   └── healthcheck ........ COMPLETE
├── app_firewall ........... PARTIAL (#321 residual)
├── certificate ............ PARTIAL — plausible min config, unverified CRUD (#333)
├── service_policy ......... PARTIAL — plausible min config, unverified CRUD (#333)
│                            2 oneOf (rule_choice: 5 branches, server_choice: 4 branches)
├── rate_limiter_policy .... BROKEN — placeholder min config (#334)
│                            Catalog name: "policers". 4 oneOf groups.
├── api_definition ......... BROKEN — placeholder min config (#334)
│                            1 oneOf (schema_updates_strategy). swagger_specs array (maxItems 20).
├── api_discovery .......... BROKEN — placeholder min config (#334)
│                            0 oneOf. custom_auth_types (maxItems 10). Minimal.
├── waf_exclusion_policy ... BROKEN — placeholder min config (#335)
├── user_identification .... BROKEN — placeholder min config (#335)
├── malicious_user_mitigation BROKEN — placeholder min config (#335)
├── sensitive_data_policy .. BROKEN — placeholder min config (#335)
└── routes ................. Inline in LB spec, not a separate resource for LB
```

## Key Findings from Audit

1. **Most resources accept empty spec.** True minimum for 9+ resources is `{"metadata": {"name": "...", "namespace": "..."}, "spec": {}}`. The API applies server defaults.

2. **Routes are NOT standalone for the LB.** The `/routes` endpoint is for `virtual_host`, not `http_loadbalancer`. LB routes are inline in the LB create request. The standalone `route` resource is a separate concept.

3. **No OneOf recommendations** exist for any resource except `app_firewall` and `http_loadbalancer`. The pipeline needs to generate these for: service_policy (2 groups), rate_limiter_policy (4 groups), certificate (2 groups), api_definition (1 group).

4. **Spec complexity tiers:**
   - Complex: service_policy (9 branches), rate_limiter_policy (4 oneOf + rules array)
   - Medium: certificate (2 oneOf), api_definition (1 oneOf)
   - Simple: api_discovery, waf_exclusion, user_identification, malicious_user_mitigation, sensitive_data_policy, protocol_inspection

## Implementation Order

1. Fix pipeline bugs #336 and #337 first (cross-cutting, fixes symptoms in all 9 resources)
2. Fix #321 (systemic required_fields — prevents correct oneOf handling everywhere)
3. Tier 1: certificate + service_policy (#333)
4. Tier 2: api_definition + api_discovery + rate_limiter_policy (#334)
5. Tier 3: 5 security resources (#335)
6. Then: http_loadbalancer itself (composes all of the above)

## API Behavioral Notes (carried forward)

- PUT returns empty body `{}`
- DELETE requires `Content-Type: application/json` and body `"{}"`
- `metadata.name`: DNS-1035 `^[a-z]([-a-z0-9]*[a-z0-9])?$`
- Test object prefix: `xcsh-uat-*`
- `xcsh_api` tool: sequential calls only (shared TLS connection)
- POST ~490ms, GET ~250ms, DEL ~225ms
- app_firewall quota: 115 limit on tenant f5-amer-ent

## How to Resume

1. Read issues #332 (umbrella), #336, #337 (pipeline bugs) for full context
2. Check if any issues have been closed since this handoff was written
3. Check latest api-specs-enriched release version — if newer than v2.1.75, re-audit affected resources
4. Next action depends on what's been fixed:
   - If #337 fixed → re-check catalog for all 9 broken resources, verify `spec: value` is gone
   - If #336 fixed → re-check DELETE min configs
   - If neither fixed → begin work on #337 (pipeline fix in `minimum_configuration_enricher.py`)
   - If both fixed → begin Tier 1 CRUD verification for certificate and service_policy
