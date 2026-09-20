# Native QMD API-discovery qualification finding

Date: 2026-09-20

## Candidate

- Package: `@tobilu/qmd@2.8.3`
- Registry integrity: `sha512-zjfVwrObPB618B6x8SdhlGv/tX9OxRHsbQnr5DUtBvqPK6HGQ27lM+9/BAY5okpjrHVnW56hLyDkqoTcsrVLzA==`
- License: MIT
- Upstream commit: `04e4dbd8245c527a88f1a8f0bda547aef9ca81fb`

## Reproducible result

The model-free SDK probe (`createStore`, `update`, and `searchLex`) ran in-process under Bun 1.4.2 with lifecycle scripts suppressed. It performed no vector embedding, reranking, MCP, CLI subprocess, or model download.

The release compile gate failed before an executable could be produced. `bun build --compile packages/coding-agent/src/cli.ts` resolves QMD's transitive `node-llama-cpp` imports and fails on unavailable optional platform modules, including `@node-llama-cpp/mac-arm64-metal`, `@node-llama-cpp/mac-x64`, `@node-llama-cpp/linux-riscv64`, and Windows variants. The compile also requires generated internal-url inputs, which were absent from the direct probe invocation; the QMD native-module failures are independent of those generated inputs.

## Decision

QMD is unqualified for this release because compilation/package coverage cannot be proven on supported Linux/macOS targets. Per the clean-break experiment rule, the package, adapter, generated index, cache handling, experimental switch, and runtime path are removed. The deterministic corpus and byte-equivalent baseline seam remain available for the reusable API-awareness benchmark.
