# Vendored Rust validation repairs

The vendored crates retain their upstream package metadata, repository attribution,
and licenses. See each crate's `Cargo.toml` for its upstream source and version.

The #3765 consolidation makes the following local source repairs:

- `brush-core` 0.4.0: extract completion, expansion, assignment, and initialization
  helpers; remove unnecessary allocations and references; correct documentation.
  Seatbelt rule ordering and emitted policy remain unchanged. Mac containment
  behavior still requires validation under #3759.
- `brush-builtins` 0.1.0: use lazy futures for synchronous command implementations,
  preserving execution on polling; split option processing and factory registration.
  Standalone checks resolve the same local patched `brush-core` as the root workspace.
- `portable-pty` 0.9.0: apply reference and conversion corrections, and remove
  unreachable empty-input writing examples while retaining EOF timing.
- `tree-sitter-glimmer`: declare its standalone workspace boundary so a nested
  Git worktree does not accidentally adopt the enclosing checkout's workspace.

No lint levels are reduced. The local Rust gate discovers all standalone manifests
and deduplicates workspace members. Run `bun run check:rs` and `bun run test:rs`.

The #3717 dependency update pins `homedir` to 0.3.6. Its standalone lockfile patch
was applied exactly, after the baseline `brush-core` lint and test repairs passed.
Root and builtin lockfiles also resolve that patched dependency consistently.

## September 2026 upstream audit

The direct stack refresh retains the Brush behavioral patch until the generic
shell migration in #3835 preserves containment and cancellation. A formatted
three-way rebase against canonical releases conflicted in 22 core files and 42
builtin files, including the execution and file-access enforcement paths.

| Source | Archive SHA-256 | Disposition |
| --- | --- | --- |
| brush-core 0.5.0, crates.io | `967a82f3b1bf090db686d5fb86424b19725073828532a42f960d5a13bff14ecb` | Deferred; retain 0.4.0 |
| brush-builtins 0.2.0, crates.io | `6eb8b0b70385d3c49e28e0f951dd9986393ecdee404cd6166902e685f83e4cf0` | Deferred; retain 0.1.0 |
| portable-pty 0.9.0, crates.io | `b4a596a2b3d2752d94f51fac2d4a96737b8705dddd311a32b9af47211f08671e` | Already current; retain the documented pre-exec hook and validation repairs |

Glimmer parser sources and headers now come from the canonical
`ember-tooling/tree-sitter-glimmer` tag `v1.6.0-tree-sitter-glimmer`, commit
`88af85568bde3b91acb5d4c352ed094d0c1f9d84`. Upstream now compiles the external
scanner. The local Rust wrapper retains its source layout, standalone workspace
boundary and suppression of upstream C compiler warnings. Parser/scanner sources,
node types and C headers are copied without local edits; the upstream MIT license
is retained alongside them.
