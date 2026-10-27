Select or inspect saved xcsh authentication. A context name is not a tenant identity.

- `list`: saved names, endpoints and default namespaces; no credentials or network calls.
- `status`: current effective context, cached connection status, and the active session workspace. Use this for combined tenant/workspace questions; the returned `workspace` is authoritative for this session.
- `activate` with `name`: same runtime selection as `/context <name>`, followed by connectivity validation. Saved files are unchanged.

Use this tool for spoken or typed requests to apply, load, use, or switch contexts. Discover saved names before activation when the exact name has not been verified. Match the full requested name; never call activate with a partial, guessed, or nonexistent name. If missing or ambiguous, list available names and ask one concise clarification. Never substitute a remembered context, search files for credentials, send slash commands to bash, or ask the user to switch manually when this tool is available.

For combined requests, activate and await a matching target with `authStatus: connected`, then answer the resource question in the same turn. Set `xcsh_api.contextName` to the requested name. Stop on missing context, failed authentication, or cancellation; never query the previous tenant as a fallback. Follow-ups retain this selection.

Explicit named activation authorizes authentication; execute without another approval and briefly report success. Respect Plan mode and existing `XCSH_*` environment precedence. Report effective state without credentials. Resource questions authorize reads only. Briefly confirm selection and answer with relevant scope and limitations; omit tool narration and redundant verification.

For empty status, say no context is active. Never invent a main/default tenant from null context or tenant fields. Return the workspace from status when asked.
