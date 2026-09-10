# Vendored Rust validation repairs

The vendored crates retain their upstream package metadata, repository attribution,
and licenses. See each crate's `Cargo.toml` for its upstream source and version.

The #3765 consolidation and #3831 refresh make the following local source repairs:

- `brush-core` 0.5.0: retain XCSH's race-safe in-process file boundary, ordered
  Seatbelt and Landlock process confinement, enumeration-safe globbing, cancellation
  propagation, real background-process job tracking, and the Windows process/terminal
  adapters while adopting the upstream generic `ShellExtensions` interfaces.
- `brush-builtins` 0.2.0: retain cancellation-aware `read` polling and adapt the
  registration/implementation surface to the generic shell context. Standalone checks
  resolve the same local patched `brush-core` as the root workspace.
- `portable-pty` 0.9.0: apply reference and conversion corrections, and remove
  unreachable empty-input writing examples while retaining EOF timing.
- `tree-sitter-glimmer`: declare its standalone workspace boundary so a nested
  Git worktree does not accidentally adopt the enclosing checkout's workspace.

The local Rust gate discovers all standalone manifests and deduplicates workspace
members. Brush builtins carries one narrow `unused_async_trait_impl` allowance:
the shared generic builtin trait is asynchronous, while most shell builtins are
intentionally synchronous. All other repository lint levels remain enforced. Run
`bun run check:rs` and `bun run test:rs`.

## September 2026 upstream audit

The direct stack refresh completed the generic shell migration tracked in #3835.
Canonical crate archives were copied first, then the residual XCSH patch above was
ported onto their new execution, expansion, builtin, and platform interfaces. Lockfile
resolution excludes releases inside the audit's seven-day holdback: `console` is fixed
at 0.16.3 and the Pest family at 2.8.6.

| Source | Archive SHA-256 | Disposition |
| --- | --- | --- |
| brush-core 0.5.0, crates.io | `967a82f3b1bf090db686d5fb86424b19725073828532a42f960d5a13bff14ecb` | Adopted with the residual XCSH patch documented above |
| brush-builtins 0.2.0, crates.io | `6eb8b0b70385d3c49e28e0f951dd9986393ecdee404cd6166902e685f83e4cf0` | Adopted with cancellation-aware read and generic-shell integration |
| portable-pty 0.9.0, crates.io | `b4a596a2b3d2752d94f51fac2d4a96737b8705dddd311a32b9af47211f08671e` | Already current; retain the documented pre-exec hook and validation repairs |

Glimmer parser sources and headers now come from the canonical
`ember-tooling/tree-sitter-glimmer` tag `v1.6.0-tree-sitter-glimmer`, commit
`88af85568bde3b91acb5d4c352ed094d0c1f9d84`. Upstream now compiles the external
scanner. The local Rust wrapper retains its source layout, standalone workspace
boundary and suppression of upstream C compiler warnings. Parser/scanner sources,
node types and C headers are copied without local edits; the upstream MIT license
is retained alongside them.
