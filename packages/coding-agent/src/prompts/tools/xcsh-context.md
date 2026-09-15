Select or inspect an existing F5 Distributed Cloud tenant context in this xcsh session.

- `list`: saved names, endpoints and default namespaces; no credentials or network calls.
- `status`: current effective context and cached connection status.
- `activate` with `name`: same runtime selection as `/context <name>`, followed by connectivity validation. Saved files are unchanged.

Use this tool for spoken or typed requests to apply, load, use, or switch contexts. Select the exact name in the current request. If missing or ambiguous, list available names and ask one concise clarification. Never substitute a remembered context, search files for credentials, send slash commands to bash, or ask the user to switch manually when this tool is available.

For combined requests, activate and await a matching target with `authStatus: connected`, then answer the resource question in the same turn. Set `xcsh_api.contextName` to the requested name. Stop on missing context, failed authentication, declined approval, or cancellation; never query the previous tenant as a fallback. Follow-ups retain this selection.

Respect Ask approvals, Plan mode, and existing `XCSH_*` environment precedence. Report effective state without credentials. Resource questions authorize reads only. Briefly confirm selection and answer with relevant scope and limitations; omit tool narration and redundant verification.
