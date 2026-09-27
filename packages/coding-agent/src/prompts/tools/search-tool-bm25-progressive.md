Search deferred tool metadata and activate matching capabilities.

Use this tool to discover registered tools that are not exposed by default.

{{#if discoverableToolCount}}Total discoverable tools loaded: {{discoverableToolCount}}.{{/if}}
Input:

- `query` — required natural-language or keyword query
- `limit` — optional maximum number of tools to return and activate (default `8`)

Behavior:

- Searches deferred tool metadata using BM25-style relevance ranking
- Matches against tool name, label, description, and input schema keys
- Activates the top matching tools for the rest of the current session
- Repeated searches add to the active tool set; they do not remove earlier selections
- Newly activated tools become available before the next model call in the same overall turn

Notes:

- If you are unsure, start with `limit` between 5 and 10 to see a broader set of tools.
- `query` is matched against tool metadata fields:
  - `name`
  - `label`
  - `description`
  - input schema property keys (`schema_keys`)

This is not repository search, file search, or code search. Use it only for capability discovery.

Returns JSON with:

- `query`
- `activated_tools` — tools activated by this search call
- `match_count` — number of ranked matches returned by the search
- `total_tools`
