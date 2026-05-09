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
- metric: 65
- why it won: 20 defaults + 27 oneOf + 10 CRUD + 7 constraints.

## What's Been Tried
- Phase 1: All 13 dependency resources CRUD-verified. 3 catalog bugs fixed (#350, #351, #352).
- Runs 4-7: Baseline, corrected defaults, 6 oneOf, config PR #359.
- Runs 8-12: +constraints, port_0 fix, HTTP lb_type, http_https rejection.
- Runs 13-15: +nested oneOf (server_name, header_transform, protocol, coalescing, loadbalancer_choice) + feature toggles.
- Run 16: +do_not_advertise variant CRUD.
- All 27 minimum_configs.yaml oneOf groups verified as strictly enforced (400).
- Corrections applied: PR #359 (api-specs-enriched), pending merge.

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

### All 27 oneOf groups strictly enforce (400 on conflict):
**Top-level spec:**
1. lb_type: http, https, https_auto_cert (NOT http_https — removed in PR #359)
2. advertising: advertise_custom, advertise_on_public, advertise_on_public_default_vip, do_not_advertise
3. challenge: captcha_challenge, enable_challenge, js_challenge, no_challenge, policy_based_challenge
4. user_identification: user_id_client_ip, user_identification
5. service_policies_source: active_service_policies, no_service_policies, service_policies_from_namespace
6. waf: disable_waf, enable_waf
7. rate_limit: disable_rate_limit, enable_rate_limit
8. load_balancing_algorithm: round_robin, least_request, ring_hash, random
9. sensitive_data_policy: default_sensitive_data_policy, custom_sensitive_data_policy
10. client_ip_headers: disable_trust_client_ip_headers, enable_trust_client_ip_headers
11. bot_defense: disable_bot_defense, enable_bot_defense
12. api_discovery: disable_api_discovery, enable_api_discovery
13. malware_protection: disable_malware_protection, enable_malware_protection
14. threat_mesh: disable_threat_mesh, enable_threat_mesh
15. malicious_user_detection: disable_malicious_user_detection, enable_malicious_user_detection

**Inside https_auto_cert:**
16. tls_config: custom_security, default_security, low_security, medium_security
17. mtls: no_mtls, use_mtls
18. path_normalize: disable_path_normalize, enable_path_normalize
19. server_name_header: default_header, append_server_name_header, pass_through_server_name_header
20. header_transformation: legacy, proper, preserve_case
21. http_protocol: v1_only, v1_v2, v2_only
22. coalescing: default, disable, enable_for_same_origin
23. loadbalancer_choice: default_loadbalancer, non_default_loadbalancer

**Inside l7_ddos_protection:**
24. ddos_mitigation: mitigation_block, mitigation_captcha_challenge, mitigation_js_challenge, mitigation_none
25. ddos_rps_threshold: default_rps_threshold, custom_rps_threshold
26. ddos_clientside_action: clientside_action_none, clientside_action_javascript, clientside_action_captcha
27. ddos_policy: ddos_policy_none, ddos_policy_ref

### minimum_configs.yaml corrections (applied in PR #359):
- challenge: added enable_challenge, policy_based_challenge
- service_policies_source: added no_service_policies
- ddos_mitigation: split mitigation_challenge into captcha/js variants
- lb_type: removed http_https (not a valid API variant)

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