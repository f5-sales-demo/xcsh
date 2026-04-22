# xcsh#173 UAT Handoff — Resume Point

**Status:** mid-UAT. 5 of 5 renderer scenarios pass. Theme swap not yet verified.

## Worktree / branch / PR

- Worktree: `/workspace/xcsh/.worktrees/fix-173-tool-icon-consolidation`
- Branch: `fix/173-tool-icon-consolidation`
- HEAD: `7d20d86af` (35 commits ahead of main)
- PR: [#207](https://github.com/f5xc-salesdemos/xcsh/pull/207) — open, `Closes #173`
- CI on last push: code-level checks all green; super-linter red on unrelated vendored `crates/tree-sitter-glimmer/` files (pre-existing, not this PR)

## What's done

All 23 planned tasks + 11 UAT-driven follow-ups are committed:

- **Foundation:** `isWarning` plumbing on `AgentToolResult` / `ToolResultMessage` / `tool_execution_end` / extension+hooks event types / cursor emitters / agent-session extension forwarder / event-controller three-way mapping.
- **Theme:** `gutterWarning` token (orange defaults + xcsh branded overrides); `gutterSuccess` added to xcsh-dark/light as cyan (`#00b4ff` / `#0090cc`) — was falling back to bright green.
- **Gutter component:** `GutterOutcome` union extended to `"warning"`; optional `activeFrames` and `activeIntervalMs` added to `GutterConfig` so tool calls use a `["●", " "]` pulse at 600ms/frame (muted color) instead of the braille thinking spinner.
- **Phase 5 tools** (warning-producing): grep, find, ast-grep, ast-edit, calculator, exa, ask, search-tool-bm25 — all strip terminal `icon:` and set `isWarning` on zero-result/fallback paths.
- **Phase 6 tools** (icon-strip-only): read, bash, write, edit/renderer, notebook, ssh, fetch, gh, vim, inspect-image, todo-write, web/search, task, code-cell header (cross-cutting), and the generic `tool-execution.ts:688` fallback.
- **Helpers:** `formatEmptyMessage` / `formatErrorMessage` in `render-utils.ts` no longer prepend glyphs (centralized).
- **Tests:** 32-test integration regression sweep + per-tool renderer smoke tests + event-controller three-way mapping contract + gutter-block warning outcome coverage. Glyph regex broadened to `[✓✔✗✘⚠ⓘ]`.
- **CHANGELOG entry** for the Unreleased section.

### UAT-surfaced bug fixes (notable)

- **Pre-existing bash exit-code propagation bug** (`588871e62`): persistent shell's CWD-capture printf overwrote the user command's exit code with its own 0. Subprocess failures (`false`, `ls /nonexistent`, subshells) all reported `exitCode: 0`, silently breaking the gutter-error signal. Fixed by emitting an `__XCSH_EXIT__` sentinel that captures `$?` directly as a printf argument (variable assignment like `_x=$?` resets `$?` in brush-core before the RHS is evaluated).
- **UAT design feedback** (`00fcd8132`, `f92d9c66f`, `7d20d86af`): tool-call spinner was reusing the thinking braille, and gutterSuccess was green not cyan. Fixed to pulsing `●`/blank at 600ms muted, cyan gutterSuccess in xcsh themes.
- **Color-depth portable tests** (`9e656588c`): CI runs in 256-color, was asserting truecolor ANSI.

## UAT progress

Already verified ✅:

1. **Scenario 1 — grep with matches**: cyan gutter ball, no inline glyph, `truncated` text is plain orange (legitimate body content).
2. **Scenario 2 — grep 0 matches**: orange gutter ball, no inline `⚠`.
3. **Scenario 3 — `bash: false`**: red gutter ball (after bash executor fix), no inline `✗`.
4. **Scenario 4 — `bash sleep 4 && echo done`**: breathing pulse during streaming (at correct cadence after 600ms fix), cyan ball on completion, no inline `✓`.
5. **Scenario 5 — `find` with 0 results**: orange gutter ball, no inline `⚠`.

All in the default theme (xcsh-dark — the worktree launches with that).

## UAT remaining

Theme-swap verification — the user had just started this when the handoff was requested.

### Step 7 (next to run)

At the xcsh prompt:

```
/theme
```

Pick `xcsh-light`. Background turns light.

```
grep for "import" in packages/coding-agent/src
```

```
grep for "zzzz-xcsh173-uat-xyz-light" anywhere in the repo
```

Ask the user:
1. Is the cyan success ball readable on the light background?
2. Is the warning orange ball clear on the light background?
3. Any inline glyphs?

### Step 8

Pick a community theme (e.g. `dark-ocean`) via `/theme` and re-run the same two greps. Expect:
- Cyan success ball may look slightly different (community themes don't override `gutterSuccess`, falls back to `success` token)
- Warning ball should be yellow (inherits `warning` via fallback chain; community themes typically use yellow for warning)
- No inline glyphs

### Step 9

`/quit` the session. Report back final pass/fail and any anomalies.

## How to resume

1. Open terminal in `/workspace/xcsh/.worktrees/fix-173-tool-icon-consolidation`
2. User's prior xcsh session was killed by session restart. Restart with: `bun run dev`
3. Continue from **Step 7** above.
4. After Steps 7-9 complete, if everything passes, the PR (#207) is fully UAT-verified and ready for human code review.

## Known deferred scopes (documented in the integration test, NOT UAT blockers)

- `task/render.ts renderAgentResult` still emits `theme.status.*` for per-sub-agent verdicts inside a task tool call (intentionally scoped out — inner verdicts, not outer tool outcome).
- `debug.ts:565` and `lsp/render.ts:111,180` use `formatStatusIcon(...)` directly in template literals — separate refactor to route through `renderStatusLine({icon})`.
- `resolve.ts:163` full-inverse Accept/Discard banner and `review.ts:179` per-finding glyph — architectural UI elements, not status indicators.

These are called out inline in `test/boxed-gutter-integration.test.ts` with grep-able `DEFERRED` comments and source line numbers.

## Relevant plan/spec artifacts

- Spec: `docs/superpowers/specs/2026-04-21-tool-icon-consolidation-design.md` (gitignored, local working doc)
- Plan: `docs/superpowers/plans/2026-04-21-tool-icon-consolidation.md` (gitignored, local working doc)
- Both survive worktree restart.

## Memory written during this session

The following persistent memories were saved at `/home/vscode/.claude/projects/-workspace-xcsh/memory/`:
- `feedback_public_interface_symmetry.md` — outcome fields go on the public interface, not derived downstream
- `feedback_accuracy_over_cost.md` — dispatch subagents with `model: "opus"` on this project
- `feedback_biome_preformat.md` — run `bunx biome check --write` on staged files before invoking github-ops (avoids pre-commit round-trip)

These are auto-loaded on session start.

## Last commit SHAs (for reference)

```
7d20d86af  fix(coding-agent): slow tool-call pulse to 600ms/frame breathing cadence
f92d9c66f  fix(coding-agent): inline gutterSuccess hex for xcsh themes (color-resolver only follows vars)
00fcd8132  feat(coding-agent): tool-call pulse spinner + cyan gutterSuccess in xcsh themes
588871e62  fix(coding-agent): propagate subprocess exit codes through persistent shell
9e656588c  test(coding-agent): make gutterWarning assertions color-depth portable
b2dcb82ce  docs(coding-agent): changelog entry for tool-call outcome consolidation
977f80489  test(coding-agent): tighten lsp integration test, document deferred renderers
975cadbda  test(coding-agent): xcsh#173 integration regression — gutter-only outcome invariant
4cceab815  feat(coding-agent): drop inline status icons in generic tool-execution fallback
52e2e1234  feat(coding-agent): drop inline status icons in web-search and task renderers
10e7e0b99  feat(coding-agent): drop inline status icons in vim, inspect-image, todo-write renderers
614c9a303  feat(coding-agent): drop inline status icons in ssh, fetch, gh renderers
b3a52a78b  feat(coding-agent): drop inline status icons in edit renderer and notebook
574eabb8e  refactor(coding-agent): drop terminal status icons in code-cell header
5d3c92e54  feat(coding-agent): drop inline status icons in read, bash, write renderers
41b6cbdce  feat(coding-agent): drop inline status icons in search-tool-bm25; set isWarning
eab7709b3  test(coding-agent): broaden terminal-glyph regex in Phase 5 tool tests
ee1e108a3  feat(coding-agent): drop inline status icons in ask; set isWarning on fallback
f3bfd1ad9  feat(coding-agent): drop inline status icons in exa; set isWarning on 0 results
236bca1f2  feat(coding-agent): drop inline status icon in calc tool; set isWarning
6c21fd26f  feat(coding-agent): drop inline ast-edit status icon; warn on 0 replacements
be413ef28  fix(tools/ast-grep): drop inline status icon; set isWarning on 0 matches
dc7c4304e  feat(tools/find): drop inline status icon; set isWarning on 0 results
5cd7e4d03  refactor(render-utils): drop leading glyph from formatEmptyMessage and formatErrorMessage
5b3f96b77  feat(tools/grep): drop inline status icon; set isWarning on 0 matches
03ed10102  feat(tui): wire three-way outcome mapping in event controller
c33917a5f  test(gutter-block): assert state=done in warning fallback test
c26ece8d3  feat(tui): add warning outcome to GutterBlock
bc9e1ee7f  fix(theme): darken light-mode gutterWarning to WCAG AA
ebc66d276  feat(theme): add gutterWarning token with orange defaults
830a952f2  fix(agent-session): forward isWarning when rebuilding extension tool_execution_end event
80758c741  feat(cursor): forward isWarning on tool_execution_end emissions
35258cd64  feat(extensibility): expose isWarning on tool result events
e1dc16a4f  feat(agent): forward isWarning through emitToolResult
ddf756fe1  feat(agent): add isWarning field to AgentToolResult and ToolResultMessage
```

**35 commits total.**
