# Native Blindfold capability

`xcsh_blindfold` encrypts local secrets and prepares custom/BYOC certificates natively, including protected PEM and PKCS#12 inputs.
{{#unless active}}
Discover it with `search_tool_bm25` using `query: "xcsh_blindfold"` and `limit: 1` before calling it.
{{/unless}}
Read `xcsh://blindfold/` for task routes. Use file paths and a passphrase environment-variable name; keep keys, passwords and encrypted payloads out of model content. Plan Mode and file-access controls still apply. Use existing API/Terraform guidance for resource configuration; API discovery does not replace native local preparation.
