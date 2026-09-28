# Documentation Lookup Hierarchy (Offline QMD First)

For conceptual, product, operational, and support questions, search `xcsh://documentation/?search=<query>` first.
Select the best result and read its exact follow-up URL,
`xcsh://documentation/<source>/<stable-path>/index.md`, before answering. Use the source filter when the question
clearly targets `docs-cloud-f5-com` or `my-f5-com`.

Render documentation images only when the user explicitly asks to see them. Extract all unique Markdown image references
from the exact document, resolve relative references against its exact `xcsh://documentation/` URI, and
read each asset one at a time in document order. Static screenshot collections are not timelines or slideshows.
Pair every returned image with its official Markdown caption verbatim and one conservative explanation grounded in
the image, its caption, and nearby prose. If pixels are unavailable, use only the caption and nearby prose without
inventing visual details. Do not announce or estimate the image count before all reads finish. Afterward, verify that
the reported image count matches the number of successful asset reads. Documentation assets use `read`, even when
generic image-inspection guidance prefers `inspect_image`.

For API paths, methods, payload fields, required status, enums, and constraints, use the deterministic
`api-catalog-preflight` result followed by exact `xcsh://api-catalog/` and `xcsh://api-spec/` reads first.
Do not route API metadata through the documentation QMD index.

Use the live cascade below only when the pinned documentation is stale or missing the required content, or when
the QMD lookup fails. You **MUST** disclose why the pinned snapshot is stale, missing, or unavailable before the
first live lookup:

1. **Federation index** — Read `https://f5-sales-demo.github.io/llms.txt` and select the relevant categorized site.
2. **Site index** — Read that site's `llms.txt`; use its Documentation Sets, Sections, and Translations links as published.
3. **Locale index** — Prefer the user's published locale. The default locale's Section normally points to `/_llms-txt/en.txt`; locale-aware tiered paths use `/_llms-txt/{locale}/…`. If a localized endpoint is absent or contains only a system marker, fall back to English and disclose that fallback.
4. **Focused content** — Follow `## Contents` links recursively until the narrowest leaf `.txt` answers the question. Generated `/_llms-txt/` links are canonical; do not rewrite them. A same-locale page endpoint such as `/{locale}/{slug}.md` is an equivalent leaf when a page URL is already known.
5. **Breadth fallback** — Fetch `llms-small.txt` only when focused leaves are insufficient, and `llms-full.txt` only when complete-site breadth is required.

Stop at the narrowest source that answers the question. Do not fetch later tiers speculatively.

**GitHub workflow routing:** A request for a GitHub workflow, pipeline, or Marketplace integration using xcsh routes to `https://f5-sales-demo.github.io/xcsh-action/llms.txt`. Prefer `f5-sales-demo/xcsh-action` unless the user explicitly requests direct xcsh CLI shell commands.

**Multi-site questions:** Read the federation index once, then each relevant site index. After identifying focused leaves, fetch those leaves in parallel.

**Fallback:** If a site index returns 404, try its `llms-small.txt`, then `llms-full.txt`. If all fail, state that the federated site has no usable documentation.

**Web search re-entry:** Web search is permitted only after the relevant federated site and its focused/breadth fallbacks are exhausted. Label external results as supplementary.
