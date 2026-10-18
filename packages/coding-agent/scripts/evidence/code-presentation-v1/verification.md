# Code presentation verification

Issue: [#5012](https://github.com/f5-sales-demo/xcsh/issues/5012).
The initial reproduction used xcsh source v23.7.0 at `286213af0`.

Code fences now select syntax through normalized metadata without adding visible
language labels or line numbers. Terminal, shared web, tool views and generated
exports use code panels and marked visual continuations. JSON formatting emits
original lexical tokens, preserving duplicate keys, numeric spellings and string
escapes. YAML formatting uses document/CST data and checks types, scalar contents,
comments, tags, anchors, aliases and document boundaries before accepting a view.
Scripts, HCL and HTTP retain source layout. Streaming blocks format only after a
real closing fence. Source storage and embedded export Markdown remain unchanged.

## Regression evidence

Tests reproduced visible language metadata and missing continuation gutters before
repair. Native HCL returned uncolored source, while TOML's absent grammar was
reported as supported. Additional regressions reproduced stale symbols after a
live switch, an unstyled plain-code foreground, missing heredoc interpolation
colors, variable colors inside quoted Bash heredocs, lost continuation indentation and forged clipboard metadata in author
HTML. Each repair has a focused passing regression.

The browser adapter is generated from the utility, a pinned Highlight.js 11.11.1
core subset and an explicitly registered HCL grammar. Vendor manifests include
the adapter, declarations and dependency notices. Source-digest checks reject a
stale adapter. The Office bundle's existing 256 KB limit exposed an oversized
subset; reducing it restored the build below budget without changing the gate.

## Automated acceptance

- Terminal checks cover 40, 76, 120, 153, 200 and 240 columns, both themes, Unicode,
  ASCII and Nerd presets, resizing, live symbol changes and collapsed/expanded
  assistant and tool/help views. Wrapping reconstruction checks prevent repeated
  or lost source characters.
- Chromium checks cover shared web and actual generated exports at 320, 480,
  640 and 1200 pixels in both themes. They check escaping, original-source copy,
  actual semantic colors, contrast of at least 4.5:1, panel boundaries, marked
  continuations and retained indentation. Code selection retrieves the original
  complete block.
- Independent syntax checks parse JSON/YAML and HCL, run `bash -n`, parse Python
  ASTs and inspect HTTP structure. Examples are not executed or provisioned.
- The synthetic catalog includes compact/formatted JSON/YAML, duplicate keys,
  large numbers, escapes, comments, tags, anchors, aliases, document boundaries,
  multiline scalars, HCL interpolations/heredocs, shell quoting, Python tabs,
  typed HTTP bodies, unknown languages and incomplete syntax.

The full TypeScript and Rust suites passed. The first broad run exposed stale
generated audit receipts, the browser bundle limit and a marketplace subprocess
timeout. Receipts were regenerated, the bundle was repaired, and the marketplace
suite passed separately and in the subsequent full run. TypeScript, Rust and
documentation checks are required again for the final PR revision.

Native xterm captures were created on a task-owned Xvfb display. The shared Xorg
worker timed out at startup, so capture used the isolated display directly.
Raw captures stay private. Nerd and Unicode code-panel pixels match at every
tested width in both themes. Human visual acceptance was granted on October 18,
2026 for representative JSON, YAML, Terraform, Bash and Python panels.

## Schema-grounded assistant review

The configured installed assistant, xcsh v23.6.0 with
`openai-codex/gpt-6.1-sol:high`, generated six representations of the CSD TestJS
request. This tests the configured model route, not installation of this change.

The authoritative input was the published API-spec release `v2026.10.16-1`.
The downloaded archive SHA-256 is
`781a96d270c809067a70a7c327c52d7ec512a507b1d71a9b18b90ae1db50603a`.
The CSD specification SHA-256 is
`7045618bb819c739bdeaf01edbf1bc0bfabd95e06496bcf4c4e683110df0233f`.

The exact operation is `POST /api/shape/csd/namespaces/{namespace}/testjs`.
The request has `domain`, optional body `namespace`, and `pageURL` properties.
The operation requires the path namespace and a JSON body; the structural body
schema has no required-property array. Vendor annotations add domain and URI
validation rules. The user's versionless HTTP example retains its exact path,
header and JSON body and receives HTTP-specific presentation.

The first excerpt omitted the path key. The assistant correctly reported an
incomplete HTTP example. Adding the exact published path resolved that coverage
failure. All six returned examples then passed independent syntax, request-schema
and synthetic domain/URL consistency checks. No tenant request was sent.

Coverage failures remain explicit: optional-property omission, negative vendor
validation cases, response bodies/errors, and live authorization or JS-injection
behavior. Generic JSON Schema checks do not establish server-side enforcement.

## CI repair receipts

The first PR revision exposed a stale Terraform corpus pin during container and
installation builds. Normal immutable-source discovery and the Terraform index
generator refreshed provider/documentation `v15.12.1` and regenerated its reviewed
index attestation. The normal CLI build then succeeded with the freshness gate
intact. The API corpus remains `v12.1.3`; the schema review above remains bound to
its explicitly stated raw API release.

CI spelling checks treated generated minifier identifiers as prose. The compiled
browser adapter now uses the repository's existing `.min.js` asset convention;
no spelling exclusion or ignore word was added.

CI also found an offline math-export regression. Temml's UTF-16 regex ranges were
damaged by the minified inline-script path. The template generator preserves the
math script syntax and escapes inline-script Unicode code units before embedding.
Existing math-export and Markdown fidelity tests pass together with the code
presentation suite. The Office bundle remains below 256 KB.

The next CI revision caught public-citation provenance still naming the preceding
Terraform documentation release. The normal public-citation generator used
digest-verified current release manifests and saved live publication sitemaps.
The previously failing provenance test and citation qualification tests pass.

## Delivery gates

Human visual acceptance of representative YAML, JSON, Terraform, Bash and Python
was granted with authorization to continue after green CI. Immutable publication, corpus
freshness checks for release scheduling, downloaded Homebrew/npm executable
hashes and repeated installed acceptance follow that gate. A source check, tag,
build or historical installation does not establish those later receipts.

The privacy gate initially flagged an upstream license contact in bundled notices.
The notice is preserved in a license-only source module and composed into HTML
at runtime, using the existing legal-attribution policy. No scanner exception or
suppression was added. The follow-up is docs-control #2583.

Task-owned worktree and capture cleanup follows successful installed acceptance.
