# Autoresearch

## Goal

- Minimize the system prompt profile hint character count (token efficiency) while preserving all UAT acceptance criteria.
- Secondary: reduce UAT test suite wall time by reducing per-file Bun startup overhead.

## Benchmark

- command: bash autoresearch.sh
- primary metric: rendered_hint_chars (actual LLM overhead = render_with_profile.length - render_without_profile.length)
- metric unit: chars
- direction: lower
- secondary metrics: source_hint_chars, test_time_ms, test_pass_count
- how it works: bun executes TypeScript directly via `bun packages/coding-agent/autoresearch-measure.ts`; template changes take effect immediately, no binary compilation needed

## Files in Scope
Phase A (hint wording):
- packages/coding-agent/src/prompts/system/system-prompt.md

Phase B (test consolidation — after Phase A converges):
- packages/coding-agent/test/profile-hint-and-checks.test.ts (merged from system-prompt-profile + welcome-checks-profile)

## Off Limits

- packages/coding-agent/src/internal-urls/user-profile.ts
- packages/coding-agent/src/internal-urls/profile-collectors.ts
- packages/coding-agent/src/internal-urls/xcsh-protocol.ts
- packages/coding-agent/src/system-prompt.ts
- packages/coding-agent/src/sdk.ts
- packages/coding-agent/src/modes/components/welcome-checks.ts
- packages/coding-agent/src/modes/components/welcome.ts
- packages/coding-agent/src/modes/interactive-mode.ts
- packages/coding-agent/test/internal-urls/ (all existing files)
- packages/coding-agent/test/welcome-checks.test.ts
- packages/coding-agent/test/welcome-component.test.ts
- ~/.xcsh/user-profile.json

## Constraints

- The hint block MUST contain "Primary Human"
- The hint block MUST contain "xcsh://user"
- The hint block MUST contain a MUST/SHOULD NOT directive (trigger taxonomy)
- All 115 tests MUST pass across 8 files
- hint_chars MUST remain below 600 to stay under ~160 tokens
- autoresearch-measure.ts MUST remain in packages/coding-agent/ (module resolution)

## Preflight

- Repo is a Bun monorepo; run from repo root
- bun and python3 must be in PATH
- No node_modules install needed (already present)
- Comparability invariant: same 8 test files, same render context in autoresearch-measure.ts

## Baseline

- rendered_hint_chars: 276 (what the LLM actually sees after template expansion)
- source_hint_chars: 320 (raw template chars including Handlebars syntax)
- notes: initial implementation; 4-bullet trigger taxonomy; full prose SHOULD NOT line
- NOTE: earlier sessions tracked source chars (320); rendered chars are the correct primary metric

## Current Best

- rendered_hint_chars: 192 | source_hint_chars: 236
- why it won: colon-structured trigger list (identity, communications, personal identifiers); compact name format (no parens); dropped SHOULD NOT verb ("read for" → "for"); dropped "or product questions" ("routine technical work" covers it)

## What's Been Tried

- source 581 → 412 (rendered N/A): combined 4 bullets into 2; dropped verbose examples
- source 412 → 381 (rendered N/A): removed "Full profile at" prefix; removed "code changes" from SHOULD NOT
- source 381 → 320 / rendered 276: merged 2 bullets into single inline sentence; dropped identifier list in parenthetical
- rendered 276 → 264 (exp 1): drop "answering", semicolon join
- rendered 264 → 259 (exp 2): drop "read for" after SHOULD NOT → "**SHOULD NOT** for"
- rendered 259 → 250 (exp 3): "user communications" replaces "addressing/drafting for user"
- rendered 250 → 249 (exp 6): compact name format (commas, no parens), restore product questions
- rendered 249 → 222 (exp 9): tighter trigger wording: "communications, identity, or personal identifiers needed"
- rendered 222 → 201 (exp 10): drop "or product questions"
- rendered 201 → 192 (exp 12, WINNER): colon list syntax: "when: identity, communications, personal identifiers"
- rendered 192 → 183 (exp 14, rejected): "comms" too informal for system prompt
- Merged system-prompt-profile.test.ts + welcome-checks-profile.test.ts → profile-hint-and-checks.test.ts (8 files instead of 9)
