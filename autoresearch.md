# Autoresearch

## Goal

- Minimize the system prompt profile hint character count (token efficiency) while preserving all UAT acceptance criteria.
- Secondary: reduce UAT test suite wall time by reducing per-file Bun startup overhead.

## Benchmark

- command: bash autoresearch.sh
- primary metric: hint_chars
- metric unit: chars
- direction: lower
- secondary metrics: test_time_ms, test_pass_count

## Files in Scope

Preliminary (crash fix — replaceTabs undefined guard):
- packages/coding-agent/src/autoresearch/tools/init-experiment.ts
- packages/coding-agent/src/autoresearch/tools/run-experiment.ts
- packages/coding-agent/src/autoresearch/tools/log-experiment.ts

Phase A (hint wording — starts after crash fix segment):
- packages/coding-agent/src/prompts/system/system-prompt.md

Phase B (test consolidation — after Phase A converges):
- packages/coding-agent/test/system-prompt-profile.test.ts
- packages/coding-agent/test/welcome-checks-profile.test.ts

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
- All 122 tests MUST pass across 9 files
- hint_chars MUST remain below 600 to stay under ~160 tokens

## Preflight

- Repo is a Bun monorepo; run from repo root
- bun and python3 must be in PATH
- No node_modules install needed (already present)
- Comparability invariant: same 9 test files, same extraction method for hint_chars

## Baseline

- metric: 581 chars (~153 tokens estimated at 3.8 chars/token)
- notes: initial implementation; 4-bullet trigger taxonomy; full prose SHOULD NOT line

## Current Best

- metric: (pending first run)
- why it won: (pending)

## What's Been Tried

- (none yet — starting fresh)
