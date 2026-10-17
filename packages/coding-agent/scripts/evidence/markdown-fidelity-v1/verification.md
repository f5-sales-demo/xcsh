# Markdown fidelity verification

This change extends the heading/fence-decoration fix in PR #4941. Raw Markdown remains the authority for session storage, copying and exporting. Examples and fixture captures use synthetic data; no examples were executed against a tenant.

## Scope and regression evidence

- Terminal: six new regressions failed before the structural list/wrapping fix. Checked/unchecked tasks, nested tables/quotes, bullet-color-independent hierarchy, ordered continuation alignment, original tabs passed to highlighting and narrow mixed blocks now pass. A further red-before-green regression verifies source indentation on wrapped code continuations.
- Web streaming: five regressions failed before lexer-based fence tracking. Tilde fences, longer fences containing literal backticks, inline backticks, nested fences and code containing partial table text now pass. A further minimized escaped-header-pipe regression failed before unescaped cell counting was added.
- Web ordered lists: the nine-family catalog reproduced loss of `start="9"`; validated integer start attributes now survive sanitization.
- Actual generated HTML: Chromium reproduced missing list emphasis/language labels, horizontal code scrolling, table overflow and loss of a relative link. The template sources now render inline child tokens, safe language chips, aligned cells, validated relative links and wrapping layouts. `bun packages/coding-agent/scripts/generate-template.ts` regenerated the template.

## Reusable verification

The catalog is `packages/chat-ui/test/markdown/fixtures/synthesized.catalog.json`. It pairs all nine requested prompt families with exact Markdown, minimum DOM structure and semantic text expectations. The exact fixtures guarantee coverage independently of model compliance.

- `bun run --filter @f5-sales-demo/pi-tui test`: 692 tests passed, including source-based JSON parsing and `bash -n` without execution.
- `bun run --filter @f5-sales-demo/xcsh-chat-ui test`: 186 component tests and 103 Markdown tests passed before the final escaped-pipe regression; the final Markdown suite has 104 passing tests.
- `bun run --filter @f5-sales-demo/xcsh test -- test/markdown-component-fidelity.test.ts test/html-markdown-fidelity.test.ts test/html-math-export.test.ts test/html-media-export.test.ts`: eight tests and 4,287 assertions passed on the final code and browser harness.
- Component matrix: direct Markdown, assistant messages and tool/help Markdown; widths 40/76/120/153 and resize back to 40; xcsh-dark/xcsh-light; unicode/nerd/ascii symbols; collapsed/expanded views. Source content and task state remain intact, and lines stay in bounds.
- Streaming catalog: chunks of 17 characters cross fences, links, emphasis, tables and math. Completed output converges to separately parsed and sanitized full source. Existing OSC8/ANSI, media, Mermaid and math regression suites pass.
- Chromium: all nine exact fixtures on shared web and actual SessionManager HTML exports at 320/480/640 pixels. DOM structure, code text and supported fallbacks pass. Dedicated long-code/table probes preserve code text and language labels, apply pre-wrap, and avoid horizontal overflow.

The required workspace checks use the repository-pinned Bun 1.4.2 in a task-local tool directory. Readability and source-boundary reports were regenerated through their repository scripts; only the corresponding docs-fidelity authority hashes were refreshed.

## Sequential visual review

Six synthetic screenshots were reviewed individually. Export 320/480/640: language label, list emphasis, literal fence text and wrapped long code are visible; the table remains within the content area and retains its zero value with right alignment. Shared 320/480/640: the same semantics appear using the actual shared theme tokens, with the code background, border, monospace font and language chip intact. Increasing width reduces wrapping without changing contents. An initial shared screenshot without host tokens was discarded and corrected in the fixture.

A task-owned sibling in the native Mac Herdr session displayed the candidate terminal renderer. Textual review confirmed task markers, nested child/grandchild blocks, table values, numbered continuation alignment and literal triple backticks inside code. Existing panes were preserved. This is source-renderer evidence, not installed-release acceptance.

## Configured assistant responses and outstanding acceptance

All nine catalog prompts were run through the installed Mac xcsh 23.5.2 with built-in tools, extensions, skills, rules, memory and session persistence disabled. The configured route was litellm/gpt-6.1-sol. Every response stopped normally without a tool call. Raw captures remain private.

Chromium inspection of the actual returned Markdown confirmed code preservation. The returned JSON code parsed, and the three Bash examples passed `bash -n`. Strict catalog coverage gaps remain: the CSD answer used numbered headings and fewer code blocks; the checklist omitted the exact three-unordered-level shape; the unknown-language example used a different label; the combined response omitted several required structures. These are model-output coverage gaps, covered by the exact fixtures, not proof of complete prompt compliance.

Open gates: explicit human acceptance of the visual result before merge (CONTRIBUTING.md), PR/CI repair and confirmed merge, immutable release verification, Homebrew/npm installation provenance, and repeated synthesized/native TUI acceptance in the published installation. The installed 23.5.2 baseline does not include this change. Do not report source tests or a preview as installed acceptance.

Workspace `check:ts` passed with Bun 1.4.2. `check:docs-quality` passed its contract and all 35 tests; the post-indentation source-boundary suite passed four tests with 5,705 assertions. `check:rs` explicitly skipped because no Rust-affecting changes exist. A full `test:ts` run reported a marketplace subprocess timeout; isolated reproduction and the refreshed-main repair loop remain active.
