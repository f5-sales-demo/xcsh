# Native QMD API-discovery qualification finding

Date: 2026-09-20

## Candidate

- Package: `@tobilu/qmd@2.8.3`
- Registry integrity: `sha512-zjfVwrObPB618B6x8SdhlGv/tX9OxRHsbQnr5DUtBvqPK6HGQ27lM+9/BAY5okpjrHVnW56hLyDkqoTcsrVLzA==`
- License: MIT
- Upstream commit: `04e4dbd8245c527a88f1a8f0bda547aef9ca81fb`

## Reproducible result

The production candidate uses QMD's in-process, model-free BM25 `createStore` and `searchLex` path under Bun 1.4.2. It performs no vector embedding, reranking, MCP, CLI subprocess, or model download. QMD ranks only natural-language `xcsh://api-catalog/?search=` candidates; existing catalog/spec resolvers remain authoritative for content and schemas.

## macOS SQLite patch

QMD 2.8.3 unconditionally attempts a macOS `Database.setCustomSQLite()` switch to
Homebrew SQLite during Bun module initialization. That process-global override is
unnecessary for xcsh's BM25-only use and can prevent the subsequently opened xcsh
agent database from using Bun's embedded SQLite in a signed, clean installation.
The override originated from upstream issue
[`tobi/qmd#238`](https://github.com/tobi/qmd/issues/238), which addressed vector
extension loading rather than BM25-only embedded use.
The pinned dependency patch `patches/@tobilu%2Fqmd@2.8.3.patch` removes only that
override. QMD continues to probe sqlite-vec as an optional capability, but xcsh
does not call vector APIs, package an extension dylib, or download a model. The
patch also keeps an unavailable optional extension silent during BM25 startup;
an actual vector caller still receives QMD's stored diagnostic.

Upstream source provenance remains commit
`04e4dbd8245c527a88f1a8f0bda547aef9ca81fb`. Retire the patch only after a later
QMD release passes xcsh's clean-runtime dependency contract and compiled-binary
smoke: embedded BM25 rank 1 for the frozen DNS-clone query, followed by a fresh
xcsh agent database open on both macOS architectures.

The deterministic corpus has 925 documents and fingerprint `f672936520235ab57544e861b9d8f49d0841d60791218be93001a59e40c85c6d`. Two independent generator runs produced the same generated-source SHA-256: `bb577b7972e1b793b56463079813ee19aa38b6e550e06209186dd3d625790b55`.

On the frozen 60-query benchmark, QMD improved recall@1/3/5 from 0.300/0.350/0.350 to
0.467/0.533/0.567 and MRR from 0.329 to 0.507. The current local retrieval run took 160 ms
for QMD and 201 ms for baseline. In the five-measured-sample Sol/high UAT matrix,
discovery-only median end-to-end time was 6812 ms for QMD vs 8000 ms for baseline (14.8%
faster), with no per-model p95 regression in TTFT, first-tool time, or response time. The full
mixed-route matrix was 9.9% faster; it is informational because it includes routes QMD cannot
affect.

`bun run --cwd packages/coding-agent build` completed and the generated Linux binary passed `--help`. The build externalizes QMD's unused optional `node-llama-cpp` platform modules, preserving the model-free runtime while allowing package compilation.

## Decision

Promote the clean-break QMD BM25 candidate under the revised policy: its discovery-specific
speed improvement exceeds 10% and relevance is materially stronger. The generated index is
checksum-verified, extracted atomically, and has a focused cold/warm/corrupt-cache repair test.
Raw UAT responses remain outside the repository in the local benchmark directory; this finding
contains no credentials, tenant data, or raw responses.
