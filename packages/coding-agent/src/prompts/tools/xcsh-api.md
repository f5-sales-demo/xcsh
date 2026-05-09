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

API calls to the same F5 XC tenant reuse a single TLS connection — sequential calls are faster than parallel calls. Do not issue multiple xcsh_api calls in the same turn; issue them one at a time.
