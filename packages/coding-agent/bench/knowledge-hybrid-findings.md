# Benchmark-gated QMD hybrid discovery finding

Date: 2026-09-27

## Decision

Retain the production QMD 2.8.3 BM25 implementation. Do not publish the Nomic embedding model, the
Qwen reranker, vector indexes, or additional native payloads.

The vector candidate failed seven sealed promotion gates. Because vector retrieval is a prerequisite
for reranking, the 639 MB reranker was not downloaded or evaluated.

## Frozen evaluation

The seeded fixture contains 240 API queries, 160 graded documentation queries, and 300 classifier
prompts. A SHA-256 family bucket assigns every API resource family and documentation family wholly
to tuning or sealed data; paraphrases of one target cannot cross that boundary. The sealed run
contained 55 API queries and 37 documentation queries.

| Metric | BM25 | BM25 + Nomic Q8 | Required gain | Result |
| --- | ---: | ---: | ---: | --- |
| API Recall@1 | 0.8000 | 0.8727 | +0.10 | fail (+0.0727) |
| API MRR | 0.8000 | 0.9121 | +0.08 | pass (+0.1121) |
| Documentation nDCG@5 | 0.9042 | 0.8990 | +0.05 | fail (-0.0052) |
| Documentation MRR | 0.8806 | 0.8919 | +0.05 | fail (+0.0113) |
| Warm retrieval p95 | 8.99 ms | 1328.33 ms | <250 ms | fail |

Exact operation IDs, paths, and names also regressed in at least one sealed family. The deterministic
classifier scored precision 1.0, recall 1.0, and zero false-positive sealed no-match cases.

The Nomic artifact is 146,146,432 bytes, below the conservative 250 MiB compressed-payload ceiling,
and matched SHA-256 `3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7`.
The experimental vector fingerprint was
`08449cf47a2d31a6e83558dc85f9e9032f28ff119946a96ae2b74e663dac6098`.

End-to-end model scenarios were not run after the retrieval candidate failed prerequisite relevance
and latency gates. Those gates remain explicitly failed rather than being inferred or waived.

## Reproduction

The benchmark uses the checksum-pinned local model and pinned offline documentation index:

```sh
QMD_EMBED_MODEL=/absolute/path/nomic-embed-text-v1.5.Q8_0.gguf \
  bun run bench:knowledge-hybrid \
  --model /absolute/path/nomic-embed-text-v1.5.Q8_0.gguf \
  --documentation-index /absolute/path/documentation-index.sqlite \
  --output /tmp/xcsh-qmd-hybrid-report.json
```

A non-qualifying run exits 2 by design. QMD receives caller-authored `lex`, `vec`, and `hyde`
queries, so its 1.1 GB query-expansion model is never invoked.
