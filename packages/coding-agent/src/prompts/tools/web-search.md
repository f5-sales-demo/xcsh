Searches the web for up-to-date information beyond Claude's knowledge cutoff.

<instruction>
- You **SHOULD** prefer primary sources (papers, official docs) and corroborate key claims with multiple sources
- Location fields are optional: omit unknown fields or use null. Empty or whitespace-only fields are ignored; usable fields are retained.
- You **MUST** include links for cited sources in the final response
</instruction>

<caution>
Searches are performed automatically within a single API call—no pagination or follow-up requests needed.
</caution>
