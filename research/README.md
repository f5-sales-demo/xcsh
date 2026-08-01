# Research and Benchmarks

This directory separates maintained release-validation assets from historical experiments.

## Maintained

- `benchmarks/uat-matrix/` contains the reviewed natural-language corpora used by the coding-agent UAT harness.
- `packages/typescript-edit-benchmark/` remains the canonical executable edit benchmark. It stays in the workspace because it has code, tests, and root commands.

Maintained assets must use environment-provided credentials. Reports, screenshots, generated fixtures, and customer data must never be committed.

## Archived

- `archive/autoresearch/` preserves completed autoresearch campaigns.
- `archive/plugin-discovery/` preserves the completed plugin-discovery experiment.
- `archive/edit-benchmark/` preserves sanitized benchmark summaries when they are useful for comparison.

Archive contents are evidence, not supported tooling. Scripts are stored without executable permissions and are not invoked by package scripts or CI. Before retaining transcripts or reports, remove credentials, authorization material, customer identifiers, user data, and machine-specific paths.
