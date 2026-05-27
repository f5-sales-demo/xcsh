Execute an F5 Distributed Cloud API call directly.

**Required**: provide either `path` (single-resource operations) or `paths` (batch/discovery). Omitting both returns an error.

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
