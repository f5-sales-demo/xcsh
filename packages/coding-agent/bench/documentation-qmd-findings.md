# Offline documentation QMD qualification

The pinned `content-20260926T214508Z` snapshot was qualified with deterministic, in-process QMD BM25 search. Raw responses and timing samples remain outside the repository under `~/.xcsh/benchmarks`.

## Retrieval and integrity

Five matched runs covered two docs-cloud queries, two MyF5 queries, a cross-source ambiguity query, and a no-match query. All expected documents ranked within their fixed bound, both sources appeared for the ambiguity case, the no-match query returned no documents, and every selected exact document was readable from the verified index.

| Gate | Result |
| --- | ---: |
| Relevance and integrity | 100% |
| Candidate median authoritative-evidence time | 1.764 ms |
| Live-document median authoritative-evidence time | 260.427 ms |
| Median improvement | 99.3% |
| Candidate p95 | 2.965 ms |
| Live-document p95 | 365.519 ms |
| Peak host-memory ratio | 0.36% |

The independent frozen API-catalog benchmark retained QMD recall@1/3/5 of 0.467/0.533/0.567 and MRR 0.507, so the new documentation index did not regress API discovery.

## Routing behavior

GPT-6 Sol at low reasoning completed five measured runs for each documentation scenario. All 20 samples and all 25 turns passed their exact contracts:

- docs-cloud search followed by the exact Markdown resource;
- a missing-content response without invented or live evidence;
- tools-disabled disclosure without a fabricated answer; and
- a two-turn DNS documentation flow that re-read the exact pinned document on follow-up.

A live probe initially found that an explicit documentation URL containing a `limit` query parameter could trigger API-catalog preflight. The classifier now treats `xcsh://documentation/` as an explicit documentation route, and its regression test passes while the frozen API benchmark remains unchanged.
