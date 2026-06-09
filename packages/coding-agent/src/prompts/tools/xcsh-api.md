Execute an F5 Distributed Cloud API call directly.

Handles authentication, URL construction, and HTTP execution.
Credentials are resolved from the active context profile (`/context`). Environment variables
`F5XC_API_URL` and `F5XC_API_TOKEN` override context values when set.
Path parameters like `{namespace}` are auto-resolved from the active context when not
explicitly provided in `params`. For example, `{namespace}` resolves to the context's
default namespace (`F5XC_NAMESPACE`).
Pass all path `{placeholder}` values via `params`, e.g. `{ namespace: "default", name: "example-lb", vh_name: "example-vh" }`.
Body is sent for all methods except GET when `payload` is provided — including DELETE operations that require a body.
Payload values like `$F5XC_NAMESPACE` are auto-expanded from the active context.
Use this tool after reading the API catalog to get the endpoint path and payload structure.
Response format:
- **List**: `{"items": […], "errors": []}` — each item has `name`, `namespace`, `uid`.
- **Single resource**: `{"metadata": {"name", "namespace"}, "system_metadata": {"uid", "creation_timestamp"}, "spec": {…}}` — noise-reduced in TUI (nulls/empties stripped).
- **Create/Update**: Returns the full resource object. TUI shows a Created/Updated summary with name, uid, timestamp.
- **Delete**: Returns `{}`. TUI shows contextual confirmation.
- **Error**: `{"code": <int>, "message": "…"}` — codes: 3=INVALID_ARGUMENT, 5=NOT_FOUND, 6=ALREADY_EXISTS, 7=PERMISSION_DENIED, 13=INTERNAL.
GET requests auto-retry once on transient errors (429/503) after 1s backoff. POST/PUT/DELETE are never retried.
API calls to the same F5 XC tenant reuse a single TLS connection — sequential calls are faster than parallel calls.
**Namespace discovery**: When asked about resources in a namespace, you **MUST** use `paths: ["*"]` to auto-discover and batch all namespace resource types in ONE call. Do NOT enumerate types individually.

**Relationship queries**: When the batch response says "Inventory complete" and includes a `Resource relationships:` section, the specs and relationships are already fully fetched. Answer directly from that data. Do NOT make additional GET calls to read individual resources you already have from the batch.
**Tenant-wide queries**: When asked about resources across ALL namespaces (e.g. "show all LBs in the entire tenant"), use `paths: ["*"]` with `params: {namespace: "*"}` to batch every namespace in ONE call. Do NOT list namespaces first — the wildcard handles discovery automatically.

**Deleting resources** — when asked to delete, remove, or destroy an F5 XC resource, you **MUST** call `xcsh_api` with `method: "DELETE"` and `path` set to the resource's API endpoint including the resource name, e.g. `DELETE /api/config/namespaces/{namespace}/http_loadbalancers/{name}`. Pass `namespace` and `name` via `params`. No `payload` is needed for standard deletes. Do NOT respond with explanatory text instead of making the DELETE call — execute the deletion directly.

**HTTP load balancer with origin pool** — when asked to create an LB routing to a named pool, use this exact payload structure (POST to `http_loadbalancers`):

```json
{
  "metadata": { "name": "<lb-name>", "namespace": "<ns>" },
  "spec": {
    "domains": ["<domain>"],
    "advertise_on_public_default_vip": {},
    "http": { "port": 80 },
    "default_route_pools": [
      { "pool": { "namespace": "<ns>", "name": "<pool-name>" }, "weight": 1, "priority": 1 }
    ]
  }
}
```

For HTTPS: replace `"http": {"port": 80}` with `"https_auto_cert": {"http_redirect": true, "default_header": {}, "tls_config": {"default_security": {}}, "no_mtls": {}}`. For no pool (advertise only): omit `default_route_pools`.

**Resource disambiguation**: Several F5 XC resource types have similar names but different API paths. When the user's intent maps to one of these, use the exact API path shown:

|User says|Catalog category|API path segment|NOT|
|---|---|---|---|
|"rate limiter policy"|`rate-limiter-policys`|`rate_limiter_policys`|`policers`, `rate_limiters`|
|"policer"|`policers`|`policers`|`rate_limiter_policys`|
|"rate limiter"|`rate-limiters`|`rate_limiters`|`rate_limiter_policys`, `policers`|

**payload schemas for rate-limiting resources:**
- `policers` / "policer": `{"metadata":{"name":"<n>","namespace":"<ns>"},"spec":{"burst_size":<int>,"committed_information_rate":<int>}}` — network-level byte/Mbps limiting
- `rate_limiters` / "rate limiter": `{"metadata":{"name":"<n>","namespace":"<ns>"},"spec":{"burst_size":<int>,"committed_information_rate":<int>}}` — HTTP request-level limiting (rps)
- `rate_limiter_policys` / "rate limiter policy": requires existing `rate_limiter` reference; use `{"metadata":{"name":"<n>","namespace":"<ns>"},"spec":{"any_server":{},"rules":[{"metadata":{"name":"r"},"spec":{"any_client":{},"any_ip":{},"rate_limiter":{"namespace":"<ns>","name":"<rl-name>"}}}]}}`

**SecureMesh Site v2 (`securemesh_site_v2s`) — system namespace only** — POST to `/api/config/namespaces/system/securemesh_site_v2s`. Base payload with all 12 oneOf groups set to defaults:

```json
{"metadata":{"name":"<n>","namespace":"system"},"spec":{"azure":{"not_managed":{"node_list":[]}},"disable_ha":{},"block_all_services":{},"no_network_policy":{},"no_forward_proxy":{},"f5_proxy":{},"no_proxy_bypass":{},"logs_streaming_disabled":{},"no_s2s_connectivity_sli":{},"no_s2s_connectivity_slo":{},"disable_url_categorization":{},"disable_management_network":{}}}
```

Each of the 12 oneOf groups has two or three mutually exclusive choices — pick exactly one per group:

|Group|Options (pick one)|Notes|
|---|---|---|
|node_ha|`"disable_ha":{}` OR `"enable_ha":{}`||
|blocked_services|`"block_all_services":{}` OR `"blocked_services":{"service_list":[{"service":"HTTP"}]}`||
|network_policy|`"no_network_policy":{}` OR `"active_enhanced_firewall_policies":{"enhanced_firewall_policies":[{"name":"<n>","namespace":"system"}]}`|prereq: create `enhanced_firewall_policys` in **system** namespace with `spec:{}` — inner field is `enhanced_firewall_policies` (no "active_" prefix), policy **MUST** be in system namespace|
|forward_proxy|`"no_forward_proxy":{}` OR `"active_forward_proxy_policies":{"forward_proxy_policies":[{"name":"<n>","namespace":"system"}]}`|prereq: create `forward_proxy_policys` in **system** namespace with `spec:{"allow_all":{}}` — inner field is `forward_proxy_policies` (no "active_" prefix), policy **MUST** be in system namespace, do NOT add drp_http_connect in system namespace|
|enterprise_proxy|`"f5_proxy":{}` OR `"custom_proxy":{"http_proxy":"http://proxy:8080","https_proxy":"http://proxy:8080"}`||
|proxy_bypass|`"no_proxy_bypass":{}` OR `"custom_proxy_bypass":{"bypass_list":["10.0.0.0/8"]}`||
|logs_receiver|`"logs_streaming_disabled":{}` OR `"log_receiver":{"name":"<n>","namespace":"<ns>"}`|prereq: create `global_log_receivers` with `spec:{"request_logs":{},"http_receiver":{"uri":"http://logs:8080","no_tls":{},"disable_authentication":{}}}`|
|s2s_sli|`"no_s2s_connectivity_sli":{}` OR `"dc_cluster_group_sli":{"name":"<n>","namespace":"system"}`|prereq: create `dc_cluster_groups` in system ns with `spec:{}`|
|s2s_slo|`"no_s2s_connectivity_slo":{}` OR `"dc_cluster_group_slo":{"name":"<n>","namespace":"system"}` OR `"site_mesh_group_on_slo":{"name":"<n>","namespace":"system"}`|dc_cluster_group prereq same as above; site_mesh_group prereq: `spec:{"type":"SITE_MESH_GROUP_TYPE_FULL_MESH","tunnel_type":"SITE_TO_SITE_TUNNEL_IPSEC","full_mesh":{"data_plane_mesh":{}},"bfd_disabled":{}}` — bfd_disabled **REQUIRED**|
|url_categorization|`"disable_url_categorization":{}` OR `"enable_url_categorization":{}`||
|management_network|`"disable_management_network":{}` OR `"enable_management_network":{}`||

**SMSv2 routing rule**: When asked to create a SecureMesh site v2 that *uses* or *applies* a policy (forward proxy, firewall, log receiver, cluster group), the target resource is always `securemesh_site_v2s` — POST the site payload with the policy reference in the appropriate spec field. Do NOT create the policy resource as the action; the policy already exists as a prerequisite. For example, "Create a SecureMesh site v2 with forward proxy policy X" → POST to `securemesh_site_v2s` with `"active_forward_proxy_policies":{"active_forward_proxy_policies":[{"name":"X","namespace":"<ns>"}]}` in the spec.

**SecureMesh Site v2 Terraform HCL (`f5xc_securemesh_site_v2`)** — When asked to write Terraform for f5xc_securemesh_site_v2, use `resource "f5xc_securemesh_site_v2"` in system namespace. Each of the 12 oneOf groups maps directly to a Terraform block. Base HCL:

```hcl
resource "f5xc_securemesh_site_v2" "site" {
  name      = "<name>"
  namespace = "system"

  azure {
    not_managed {}
  }

  disable_ha {}
  block_all_services {}
  no_network_policy {}
  no_forward_proxy {}
  f5_proxy {}
  no_proxy_bypass {}
  logs_streaming_disabled {}
  no_s2s_connectivity_sli {}
  no_s2s_connectivity_slo {}
  disable_url_categorization {}
  disable_management_network {}
}
```

Swap exactly one block per oneOf group — e.g. `enable_ha {}` replaces `disable_ha {}`. For reference-type options, use nested blocks:
- `active_enhanced_firewall_policies { enhanced_firewall_policies { name = "<n>", namespace = "system" } }`
- `active_forward_proxy_policies { forward_proxy_policies { name = "<n>", namespace = "system" } }`
- `log_receiver { name = "<n>", namespace = "<ns>" }`
- `dc_cluster_group_sli { name = "<n>", namespace = "system" }` (same for `dc_cluster_group_slo`)
- `site_mesh_group_on_slo { site_mesh_group { name = "<n>", namespace = "system" } }` ← note the nested `site_mesh_group` wrapper
- `custom_proxy { proxy_ip_address = "proxy.example.com", proxy_port = 8080 }` ← use `proxy_ip_address`/`proxy_port` (NOT `http_proxy`/`https_proxy`)
- `custom_proxy_bypass { proxy_bypass = ["10.0.0.0/8"] }` ← use `proxy_bypass` (NOT `bypass_list`)
- `blocked_services { blocked_service { network_type = "VIRTUAL_NETWORK_SITE_LOCAL" } }` ← use `blocked_service` with `network_type` (NOT `service_list`)

**CRITICAL — Terraform file write rule**: When asked to "Write Terraform HCL for f5xc_securemesh_site_v2", you **MUST** use the `xcsh_write_file` tool to write the complete `.tf` file to disk. Always name the file after the resource name in the request (e.g., `ar-test-smsv2-1a.tf`). Do NOT just return a coverage table — always write the actual HCL file. The file must include a `terraform { required_providers { f5xc = { source = "f5xc-salesdemos/f5xc" } } }` block and the complete `resource "f5xc_securemesh_site_v2"` block with all 12 oneOf groups.
