# Autoresearch

## Goal
CRUD-verify the http_loadbalancer resource against the live F5 XC API (tenant: nferreira, namespace: r-mordasiewicz). Document all server-applied defaults, validate oneOf group boundaries, and probe field constraints. This is the capstone of the HTTP LB dependency audit (#332).

## Benchmark
- command: bash autoresearch.sh
- primary metric: verified_items
- metric unit:
- direction: higher
- secondary metrics: defaults_found, crud_pass, oneof_pass, constraint_pass

## Files in Scope
- autoresearch.sh
- autoresearch.md

## Off Limits
- packages/

## Constraints
- xcsh_api calls must be sequential (one per turn, shared TLS connection)
- metadata.name must be DNS-1035: ^[a-z]([-a-z0-9]*[a-z0-9])?$
- Test names use xcsh-uat-* prefix
- PUT returns {} (empty body) on replace
- POST returns full created object with system_metadata
- Do not modify xcsh source code — only api-specs-enriched config files
- Origin pool must exist before HTTP LB can reference it

## Preflight
- F5XC_API_URL, F5XC_API_TOKEN, F5XC_NAMESPACE env vars must be set
- jq must be available for JSON parsing
- curl must be available for API calls
- Comparability invariant: same API tenant (nferreira), same namespace (r-mordasiewicz)

## Baseline
- metric: 25
- notes: Full CRUD cycle passes. 19/28 originally-expected defaults found.

## Current best
- metric: 32
- why it won: 20 defaults + 6 oneOf + 6 CRUD. All corrections applied.

## What's Been Tried
- Phase 1: All 13 dependency resources CRUD-verified. 3 catalog bugs fixed (#350, #351, #352).
- Run 4 (baseline): Full CRUD passes. 19/28 expected defaults found.
- Run 5 (keep): Corrected defaults list — 20/20 verified. 6 expected defaults proven wrong.
- Run 6 (keep): Added 6 oneOf boundary tests. All strictly-enforced groups reject with 400.
- Run 7 (keep): Config files updated with all corrections. PR #359 created.

## Findings: Server-Applied Defaults

### Confirmed defaults (20):
- Top-level spec: disable_waf, disable_rate_limit, disable_api_discovery, disable_api_testing,
  disable_api_definition, disable_malware_protection, disable_threat_mesh,
  disable_malicious_user_detection, disable_trust_client_ip_headers,
  round_robin, no_challenge, user_id_client_ip, service_policies_from_namespace,
  default_sensitive_data_policy, l7_ddos_protection (empty {})
- https_auto_cert: no_mtls, enable_path_normalize, http_redirect=false, add_hsts=false,
  connection_idle_timeout=0

### NOT server-applied (correcting minimum_configs.yaml comments):
- disable_bot_defense: NOT present in response
- disable_client_side_defense: NOT present in response
- disable_ip_reputation: NOT present in response
- system_default_timeouts: NOT present (only appears when explicitly sent)
- https_auto_cert.default_header: field does not exist
- https_auto_cert.default_loadbalancer: field does not exist
- add_location: server returns false, not true (minimum_configs.yaml had true)
- connection_idle_timeout: server returns 0, not 120000
- header_transformation_type: null (not legacy_header_transformation)
- http_protocol_options: null (not http_protocol_enable_v1_v2)
- coalescing_options: null (not default_coalescing)

## Findings: OneOf Group Enforcement

### Strictly enforced (400 on conflict):
1. lb_type (spec): http, https, https_auto_cert
2. advertising (spec): advertise_custom, advertise_on_public, advertise_on_public_default_vip, do_not_advertise
3. challenge (spec): captcha_challenge, enable_challenge, js_challenge, no_challenge, policy_based_challenge
4. tls_config (spec.https_auto_cert.tls_config): custom_security, default_security, low_security, medium_security
5. mtls (spec.https_auto_cert): no_mtls, use_mtls
6. user_identification (spec): user_id_client_ip, user_identification
7. service_policies_source (spec): active_service_policies, no_service_policies, service_policies_from_namespace
8. path_normalize (spec.https_auto_cert): disable_path_normalize, enable_path_normalize
9. ddos_mitigation (spec.l7_ddos_protection): mitigation_block, mitigation_captcha_challenge, mitigation_js_challenge, mitigation_none

### Silently resolved (200, server chooses one):
10. waf: disable_waf wins over enable_waf (enable needs ref)
11. rate_limit: disable_rate_limit wins over enable_rate_limit
12. load_balancing_algorithm: round_robin wins over least_request
13. timeouts: system_default_timeouts wins over custom_timeouts

### minimum_configs.yaml corrections needed:
- challenge: add enable_challenge, policy_based_challenge variants
- service_policies_source: add no_service_policies variant
- ddos_mitigation: rename mitigation_challenge to mitigation_captcha_challenge + mitigation_js_challenge

## Findings: Field Constraints

### Confirmed constraints:
- port: uint32, accepts 0 (means default=443), upper limit 65535 (API constraint)
- domains: min_items=1 (empty array rejected)
- metadata.name: DNS-1035 enforced (lowercase, alphanumeric + hyphens)
- connection_idle_timeout: uint32, max 600000 (NOT 3600000 as documented in minimum_configs.yaml)

### minimum_configs.yaml corrections needed:
- connection_idle_timeout range should be [0, 600000] not [1000, 3600000]
- port range should be [0, 65535] not [1, 65535] (0 = default)

## Findings: Routes Sub-Schema

### Catalog min config routes format is WRONG:
Current catalog min config:
```json
"routes": [{"prefix": "/", "origin_pool": {"pool_name": "backend-pool"}}]
```
This format returns 400: "spec.routes.choice should be not nil"

### Correct route formats:
1. **default_route_pools** (simplest, recommended for min config):
```json
"default_route_pools": [{"pool": {"tenant": "...", "namespace": "...", "name": "..."}}]
```

2. **routes with simple_route** (for path-based routing):
```json
"routes": [{"simple_route": {"path": {"prefix": "/"}, "origin_pools": [{"pool": {"tenant": "...", "namespace": "...", "name": "..."}}]}}]
```

### Server-applied route defaults (inside simple_route):
- http_method: "ANY"
- auto_host_rewrite: {}
- weight: 0, priority: 0, endpoint_subsets: {}
- route_state_enabled: {}