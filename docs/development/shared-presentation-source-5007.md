# Shared presentation source receipt

Source implementation: [issue #5007](https://github.com/f5-sales-demo/xcsh/issues/5007),
delivered through [PR #5010](https://github.com/f5-sales-demo/xcsh/pull/5010).
The runtime adoption parent [#5000](https://github.com/f5-sales-demo/xcsh/issues/5000)
and marketplace Salesforce [#1591](https://github.com/f5-sales-demo/marketplace/issues/1591)
retain publication, installed acceptance and adapter migration gates.

## Provenance

Introducing source: `f7f6c0109f6e59666ad6b76f117fdc49b4bb693b`.
Reviewed branch after the documentation-only main update:
`6cf0608dd4c5c3a48af4bfb5b8e9946e675ddd21`.
The renderer and test sources are identical between these commits.
Package base: 23.6.9; this feature was verified as unreleased source, not as the
published 23.6.9 binary. Host: corporate MDM MacBook. Bun: 1.4.2.
Dependency bootstrap and source-matched native readiness passed.

Private evidence identifier: `private:shared-runtime-5007-source-20261018`.
Raw frames, terminal reads, images and execution logs remain private.
The Salesforce 2.3.11 / installed xcsh 23.6.8 baseline remains separate and
preserved in [marketplace PR #1613](https://github.com/f5-sales-demo/marketplace/pull/1613).

## Verified source behavior

Command sections retain copied argv. The renderer resolves Bash/Zsh continuations
at its actual inner width; empty arguments, quotes, shell-sensitive literals,
Unicode and control characters reconstruct exactly. Plain code remains literal
evidence. Declared table minimum widths trigger labeled-field fallback, maximum
widths wrap without dropping contents, and collapsed row limits remain explicit.

Registered descriptors receive actual inner width and spinner frame. Progress
advances while executing or streaming and stops on completion. Abort, context
replacement and UI teardown retire animation without discarding partial evidence;
late argument updates cannot restart a retired component.

TDD first demonstrated missing argv retention, readable table fallback, extension
progress, teardown cleanup and completed-frame reset. The corresponding source
regressions then passed. Existing presentation and controller checks also passed.

The final coding-agent package run completed with 10,272 passing tests, 565
skipped tests and zero failures in 555.67 seconds. It used GNU checksum tools in
the task PATH and `--timeout=15000` for slower child-process startup. No tests or
behavioral assertions were disabled. Earlier failures were reproduced and
resolved through required audit regeneration, the task PATH, and removal of this
task's finished build cache to satisfy the unchanged disk-capacity guard.

`bun run check:ts` passed, including workspace types and the readability audit.
Documentation quality passed after its canonical generator refreshed 17 source
authority locators; documentation claims remained unchanged. Source inventory
adds the helper as unverified, and affected renderer acceptance is reopened with
historical receipts preserved. Source completion does not complete those live gates.

## Automated capture findings

The injected source extension API and registered-tool wrapper produced 48
synthetic renderer frames: 40/76/120/153 columns, collapsed/expanded, both themes,
and Unicode/ASCII/Nerd presets. Each frame passed individual width, data and
warning checks. All 96 Bash/Zsh command reconstructions preserved exact argv.
Synthetic monetary grouping, zero, negative amounts, currency and returned
records remained readable; separate regressions preserve false and empty text.

A task-owned Herdr pane replayed all 48 frames. Every viewport end marker was
observed, with zero missing markers. Its available layout was 153 columns;
viewport reads are distinct from the complete renderer buffers. The pane was
retired and the original caller layout restored. Generated ANSI images were
previews only; desktop compositor and terminal-font raster fidelity are unqualified.

This receipt records source-module rendering and synthetic scenarios. It does
not establish a newly published immutable runtime, a matching installed binary,
Salesforce adapter adoption, service acceptance or model tool selection. Live
Salesforce acceptance uses the corporate MDM MacBook; Ubuntu and NUC service
access are unavailable by policy. Ubuntu remains the GitHub delivery route.
