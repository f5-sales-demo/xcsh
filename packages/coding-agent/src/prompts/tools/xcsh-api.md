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

**HTTP LB advertising (`advertise_where`)** — Four mutually exclusive top-level choices:
- `"advertise_on_public_default_vip": {}` — default public VIP on Regional Edges
- `"advertise_on_public": {}` — public VIP (optionally specify `public_ip` ref); use when asked for "public VIP" WITHOUT "default"
- `"do_not_advertise": {}` — disabled
- `"advertise_custom": {"advertise_where": […]}` — custom CE/virtual site targeting (see below)

**CRITICAL**: "public VIP" = `advertise_on_public`, "public default VIP" = `advertise_on_public_default_vip`. Do NOT conflate these.

To advertise on **Customer Edge (CE) sites or virtual sites**, use `"advertise_custom"` with an `advertise_where` array. Each entry requires ONE site-targeting choice AND ONE port choice:

|Site-targeting field|Required sub-fields|Notes|
|---|---|---|
|`virtual_site`|`virtual_site: {name, namespace}`, `network`|Ref NOT validated — use for CE virtual sites|
|`site`|`site: {name, namespace}`, `network`|Ref IS validated (400 if site doesn't exist)|
|`virtual_site_with_vip`|`virtual_site: {name, namespace}`, `ip` (required), `network`|Custom VIP address|
|`vk8s_service`|oneOf: `site: {name, namespace}` OR `virtual_site: {name, namespace}`|vK8s service network|
|`advertise_on_public`|`public_ip?: {name, namespace}`|RE public VIP|

`network` values — map natural language precisely (6 valid for HTTP LB advertising):
- "inside and outside" → `SITE_NETWORK_INSIDE_AND_OUTSIDE`
- "inside only" or "inside network" (without "and outside") → `SITE_NETWORK_INSIDE`
- "outside only" or "outside network" (without "and inside") → `SITE_NETWORK_OUTSIDE`
- "outside with internet VIP" → `SITE_NETWORK_OUTSIDE_WITH_INTERNET_VIP`
- "inside and outside with internet VIP" → `SITE_NETWORK_INSIDE_AND_OUTSIDE_WITH_INTERNET_VIP`
- "service network" → `SITE_NETWORK_SERVICE`
- **NOT valid for LB advertising**: `SITE_NETWORK_IP_FABRIC` (API rejects with 400)

**CRITICAL**: "inside and outside" = `SITE_NETWORK_INSIDE_AND_OUTSIDE` (not `SITE_NETWORK_INSIDE`). Always check whether the phrase says both "inside AND outside" or just one.

Port choices (orthogonal): `"use_default_port": {}` (default) | `"port": <int>` | `"port_ranges": "80,443,8080-8191"`

**CRITICAL — "virtual site with VIP" or "using VIP address X"** → must use `virtual_site_with_vip` (NOT `virtual_site`). This requires `ip` field. Example: `{"virtual_site_with_vip": {"virtual_site": {"name": "<n>", "namespace": "<ns>"}, "ip": "10.0.0.100", "network": "SITE_NETWORK_SPECIFIED_VIP_OUTSIDE"}, "use_default_port": {}}`. Network options: `SITE_NETWORK_SPECIFIED_VIP_OUTSIDE` or `SITE_NETWORK_SPECIFIED_VIP_INSIDE`.

**CRITICAL — port field**: The `advertise_where` port is a SEPARATE concept from the LB protocol port (`http.port` or `https_auto_cert.port`). When the phrase says "advertise on port X" or "on port X" or "using port X" in the context of custom advertising, set `"port": X` inside the `advertise_where` entry. Do NOT use `use_default_port`. Do NOT change the LB type to HTTPS because the advertise port is 8443.

Example — port 8443 in advertise_where: `{"virtual_site": {…, "network": "SITE_NETWORK_INSIDE_AND_OUTSIDE"}, "port": 8443}`

**CRITICAL — all 7 SiteNetwork values work with BOTH `virtual_site` AND `site`**. "IP fabric network" = `SITE_NETWORK_IP_FABRIC` — valid for `virtual_site` too. Do NOT ask for alternatives; immediately use the matching enum.

Example — advertise on a Customer Edge virtual site, inside and outside:
```json
{
  "metadata": {"name": "<lb-name>", "namespace": "<ns>"},
  "spec": {
    "domains": ["<domain>"],
    "advertise_custom": {
      "advertise_where": [
        {
          "virtual_site": {
            "virtual_site": {"name": "<vsite-name>", "namespace": "<ns>"},
            "network": "SITE_NETWORK_INSIDE_AND_OUTSIDE"
          },
          "use_default_port": {}
        }
      ]
    },
    "http": {"port": 80},
    "default_route_pools": [
      {"pool": {"namespace": "<ns>", "name": "<pool-name>"}, "weight": 1, "priority": 1}
    ]
  }
}
```

**Virtual site resource** — When asked to create a virtual site targeting CE sites, POST to `/api/config/namespaces/{namespace}/virtual_sites`:
```json
{
  "metadata": {"name": "<vsite-name>", "namespace": "<ns>"},
  "spec": {
    "site_type": "CUSTOMER_EDGE",
    "site_selector": {"expressions": ["ves.io/siteName in (<ce-site-name>)"]}
  }
}
```
`site_type`: `CUSTOMER_EDGE` for CE/SMSv2 sites · `REGIONAL_EDGE` for PoPs · `NGINX_ONE` for NGINX One nodes. The `ves.io/siteName` label is automatically applied to all sites — use it in expressions to target specific CE sites by name.

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
- `site_mesh_group_on_slo { site_mesh_group { name = "<n>", namespace = "system" } }` ← CRITICAL: requires nested `site_mesh_group {}` wrapper block (not direct name/namespace attributes on site_mesh_group_on_slo)
- `custom_proxy { proxy_ip_address = "proxy.example.com", proxy_port = 8080 }` ← use `proxy_ip_address`/`proxy_port` (NOT `http_proxy`/`https_proxy`)
- `custom_proxy_bypass { proxy_bypass = ["10.0.0.0/8"] }` ← use `proxy_bypass` (NOT `bypass_list`)
- `blocked_services { blocked_service { network_type = "VIRTUAL_NETWORK_SITE_LOCAL" } }` ← use `blocked_service` with `network_type` (NOT `service_list`). In Terraform, "blocking HTTP services" = blocking `VIRTUAL_NETWORK_SITE_LOCAL` network type. Always write the file even when the phrase mentions "HTTP service in blocked services list" — map it to `blocked_service { network_type = "VIRTUAL_NETWORK_SITE_LOCAL" }`

**CRITICAL — Terraform file write rule**: When asked to "Write Terraform HCL for f5xc_securemesh_site_v2", you **MUST** use the `xcsh_write_file` tool to write the complete `.tf` file to disk. Always name the file after the resource name in the request (e.g., `ar-test-smsv2-1a.tf`). Do NOT just return a coverage table — always write the actual HCL file. The file must include a `terraform { required_providers { f5xc = { source = "f5xc-salesdemos/f5xc" } } }` block, a `provider "f5xc" {}` block (**REQUIRED** — without it `terraform plan` fails with "Provider requires explicit configuration"), and the complete `resource "f5xc_securemesh_site_v2"` block with all 12 oneOf groups. After writing, verify without mutating: `terraform fmt` then `terraform init` (best-effort) + `terraform validate`; report the result. Do NOT run `terraform apply` (unless the user asks to create/CRUD) or auto-run `terraform plan`.

**HTTP/HTTPS Load Balancer Terraform HCL (`f5xc_http_loadbalancer`)** — Use `resource "f5xc_http_loadbalancer"` in any namespace. Must include `terraform { required_providers { f5xc = { source = "f5xc-salesdemos/f5xc" } } }` block AND a `provider "f5xc" {}` block (**REQUIRED** — without it `terraform plan` fails with "Provider requires explicit configuration"). Always write file with `xcsh_write_file`. Name the file after the resource name (e.g., `ar-test-lb-https-1.tf`). After writing, verify without mutating: `terraform fmt` then `terraform init` (best-effort) + `terraform validate`; report the result. Do NOT run `terraform apply` (unless the user asks to create/CRUD) or auto-run `terraform plan`.

**CRITICAL — Terraform HCL single-line block rule**: A block definition like `outer { inner {} }` is INVALID when `inner {}` is itself a block (not an attribute). Nested blocks **MUST** be on their own lines:
- WRONG: `tls_config { default_security {} }`
- CORRECT: `tls_config {\n  default_security {}\n}`
- WRONG: `full_mesh { data_plane_mesh {} }`
- CORRECT: `full_mesh {\n  data_plane_mesh {}\n}`
- WRONG: `virtual_site = { name = "x", namespace = "y" }` (object literal — NOT a nested block)
- CORRECT: `virtual_site {\n  name = "x"\n  namespace = "y"\n}` (nested block)

For HTTPS auto-cert: use `https_auto_cert {}` block (tls defaults apply). For HTTP: use `http { port = 80 }`. For HTTPS redirect: add `http_redirect = true` inside `https_auto_cert`.

For `advertise_custom` with CE virtual site (Terraform HCL):
```hcl
resource "f5xc_http_loadbalancer" "lb" {
  name      = "<name>"
  namespace = "<ns>"

  domains = ["<domain>"]

  https_auto_cert {
    http_redirect = false
    tls_config {
      default_security {}
    }
    no_mtls {}
  }

  advertise_custom {
    advertise_where {
      virtual_site {
        network = "SITE_NETWORK_INSIDE_AND_OUTSIDE"
        virtual_site {
          name      = "<vsite>"
          namespace = "<ns>"
        }
      }
      use_default_port {}
    }
  }

  default_route_pools {
    pool { name = "<pool>", namespace = "<ns>" }
    weight = 1
    priority = 1
  }
}
```

TLS config options (pick one): `default_security {}` · `medium_security {}` · `low_security {}`. mTLS: `no_mtls {}` (default) or `use_mtls { tls_certificates_ref { … } }`. Advertise options same as API — use Terraform attribute syntax (`network = "…"`, `virtual_site = { … }`).

**Site mesh group Terraform HCL (`f5xc_site_mesh_group`)** — system namespace only. Use blocks to select mesh type and BFD setting (no `type`/`tunnel_type` string attributes — the provider uses block-based selection):
```hcl
resource "f5xc_site_mesh_group" "smg" {
  name      = "<name>"
  namespace = "system"

  full_mesh {
    data_plane_mesh {}
  }

  bfd_disabled {}
}
```
For spoke mesh: use `spoke_mesh { … }` instead of `full_mesh`. For `data_plane_mesh` vs `control_and_data_plane_mesh`: use `data_plane_mesh {}` for data-plane only. **DO NOT add `type` or `tunnel_type` attributes** — these are API-level concepts, not Terraform provider attributes.

**Virtual site Terraform HCL (`f5xc_virtual_site`)** — any namespace:
```hcl
resource "f5xc_virtual_site" "vsite" {
  name      = "<name>"
  namespace = "<ns>"

  site_type = "CUSTOMER_EDGE"
  site_selector {
    expressions = ["ves.io/siteName in (<ce-site-name>)"]
  }
}
```
`site_type`: `CUSTOMER_EDGE` for CE/SMSv2 sites, `REGIONAL_EDGE` for vK8s_service (RE only).

**Terraform import** — To import existing F5 XC resources into Terraform state, use `terraform import <resource_type>.<label> <namespace>/<name>`:
- `terraform import f5xc_securemesh_site_v2.site system/<site-name>`
- `terraform import f5xc_http_loadbalancer.lb <namespace>/<lb-name>`
- `terraform import f5xc_virtual_site.vsite <namespace>/<vsite-name>`
- `terraform import f5xc_site_mesh_group.smg system/<smg-name>`
