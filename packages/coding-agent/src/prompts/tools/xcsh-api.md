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
