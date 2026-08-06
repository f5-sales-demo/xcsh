# Documentation Lookup Hierarchy (llms.txt Cascade)

Use this progressive cascade for F5 XC product, API, developer-tool, automation, lab, and documentation-platform questions:

1. **Federation index** — Read `https://f5-sales-demo.github.io/docs/llms.txt` and select the relevant categorized site.
2. **Site index** — Read that site's `llms.txt`; use its Documentation Sets, Sections, and Translations links as published.
3. **Locale index** — Prefer the user's published locale. The default locale's Section normally points to `/_llms-txt/en.txt`; locale-aware tiered paths use `/_llms-txt/{locale}/…`. If a localized endpoint is absent or contains only a system marker, fall back to English and disclose that fallback.
4. **Focused content** — Follow `## Contents` links recursively until the narrowest leaf `.txt` answers the question. Generated `/_llms-txt/` links are canonical; do not rewrite them. A same-locale page endpoint such as `/{locale}/{slug}.md` is an equivalent leaf when a page URL is already known.
5. **Breadth fallback** — Fetch `llms-small.txt` only when focused leaves are insufficient, and `llms-full.txt` only when complete-site breadth is required.

Stop at the narrowest source that answers the question. Do not fetch later tiers speculatively.

**GitHub workflow routing:** A request for a GitHub workflow, pipeline, or Marketplace integration using xcsh routes to `https://f5-sales-demo.github.io/xcsh-action/llms.txt`. Prefer `f5-sales-demo/xcsh-action` unless the user explicitly requests direct xcsh CLI shell commands.

**Multi-site questions:** Read the federation index once, then each relevant site index. After identifying focused leaves, fetch those leaves in parallel.

**Fallback:** If a site index returns 404, try its `llms-small.txt`, then `llms-full.txt`. If all fail, state that the federated site has no usable documentation.

**Web search re-entry:** Web search is permitted only after the relevant federated site and its focused/breadth fallbacks are exhausted. Label external results as supplementary.
