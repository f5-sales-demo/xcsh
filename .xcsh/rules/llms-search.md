# Documentation Lookup Hierarchy (llms.txt Cascade)

When researching F5 XC product documentation, follow this sequential 5-tier cascade:

1. **Tier 1** — Read `docs/llms.txt`. Identify which product answers the question.
2. **Tier 2** — Read that product's `llms.txt`. Read the `## Sections` list.
3. **Tier 4** — Pick the most specific page from Sections. To fetch its content, take the Sections URL, strip the trailing `/`, append `.md`.
   Example: `https://…/ddos/bigip-configuration/` → fetch `https://…/ddos/bigip-configuration.md`
   If 404, try appending `/index.md` instead. Nested paths follow the same rule at the leaf.
4. **Tier 3** — Only if no single page covers the question, fetch a custom set (`/_llms-txt/{topic}.txt`) for a topic-scoped bundle.
5. **Tier 5/6** — Only if the question requires breadth across the entire product, fetch `llms-small.txt` or `llms-full.txt`.

Stop at the lowest tier that answers the question. Most questions resolve at Tier 4.

**Multi-product questions:** Read T1, identify all relevant products, then fetch each product's T2 sequentially. Once you have the right pages identified, fetch T4 endpoints in parallel.

**Fallback:** If a product's `llms.txt` returns 404, try `llms-small.txt` directly. If that also 404s, the product has no documentation — acknowledge this to the user.

**Web search re-entry:** The hierarchy is exhausted when the relevant T4 page exists and answers the question, OR when T3 and T5 have been checked without resolution. Only then is web search permitted — label external results as supplementary.
