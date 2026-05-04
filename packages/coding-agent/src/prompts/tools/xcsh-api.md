Execute an F5 Distributed Cloud API call directly.

Handles authentication, URL construction, and HTTP execution.
Requires `F5XC_API_URL` and `F5XC_API_TOKEN` environment variables.

Pass all path `{placeholder}` values via `params`, e.g. `{ namespace: "default", name: "example-lb", vh_name: "example-vh" }`.
Body is sent for all methods except GET when `payload` is provided — including DELETE operations that require a body.

Use this tool after reading the API catalog to get the endpoint path and payload structure.

API calls to the same F5 XC tenant reuse a single TLS connection — sequential calls are faster than parallel calls. Do not issue multiple xcsh_api calls in the same turn; issue them one at a time.
