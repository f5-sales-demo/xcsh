#!/usr/bin/env bash
# score-run.sh — classify a `bun dev --mode json` transcript by whether the agent reached the
# meddpicc plugin, and how deep it climbed.
#
# The ONLY trustworthy signal is the tool-call transcript: a correct final answer proves nothing
# because the deal file already contains 65.6/Yellow. So we inspect tool_execution_start events.
#
# CRUCIAL: the agent reaches the engine by MORE than the `xcsh://plugin/meddpicc` URL. A typical
# ladder climb is: read `xcsh://plugin/meddpicc` (summary) → read `xcsh://plugin/meddpicc/engine`
# (which returns the RESOLVED ABSOLUTE entry path) → then run the engine by that absolute path:
#   bun /…/f5-sales-demo-marketplace___meddpicc___2.1.0/engine/cli.ts next deal.json
# That bash command contains NO `xcsh://` string. So we must detect the engine run by the
# `…/engine/cli.ts <subcommand>` shape (any path form), and detect plugin "touch" by any
# meddpicc-path reference. Tool inputs live under different keys per tool: bash → .args.command,
# read → .args.path (also .url/.filePath on some tools). We scan all of them.
#
# Tiers (most → least):
#   INVOKED  ran the meddpicc engine CLI (score|next|hint|validate|check-mappings), any path form
#   READ     referenced a meddpicc plugin resource (summary/schema/engine/contract) but no run
#   BYPASS   never touched the plugin
#
# Usage:   score-run.sh <run.jsonl>       (or `... | score-run.sh -`)
# Output:  one TSV line: "<tier>\t<engine_cmds>\t<touch_count>"
# Exit:    0 INVOKED, 2 READ, 1 BYPASS
set -euo pipefail

input="${1:-/dev/stdin}"
[ "$input" = "-" ] && input=/dev/stdin

# All candidate command/path strings from tool_execution_start events (any tool). Parse
# line-by-line with `-R … fromjson?` so a malformed line can't abort the stream.
strings="$(
  jq -Rrc 'fromjson? // empty
           | select(.type=="tool_execution_start")
           | [.args.command, .args.path, .args.url, .args.filePath]
           | map(select(type=="string")) | .[]' "$input" 2>/dev/null || true
)"

# Restrict to strings that reference the meddpicc plugin (URL form OR install-path form OR a
# plugin-relative path). Matching tool INPUTS (not results) keeps this precise — a path/command
# that names meddpicc is a real reference, not deal content.
med="$(printf '%s\n' "$strings" | grep -E 'xcsh://plugin/meddpicc|meddpicc___|/meddpicc/' || true)"

touch_count=0
[ -n "$med" ] && touch_count="$(printf '%s\n' "$med" | grep -c . || true)"

if [ "$touch_count" -eq 0 ]; then
  printf 'BYPASS\t-\t0\n'; exit 1
fi

# Engine run = a meddpicc string that executes `…/engine/cli.ts <subcommand>` (covers both the
# xcsh:// URL form `…/file/engine/cli.ts score` and the resolved absolute-path form).
engine_cmds="$(
  printf '%s\n' "$med" \
    | grep -oE 'engine/cli\.ts[[:space:]]+(score|next|hint|validate|check-mappings)' \
    | awk '{print $2}' | sort -u | paste -sd, - || true
)"

if [ -n "$engine_cmds" ]; then
  printf 'INVOKED\t%s\t%s\n' "$engine_cmds" "$touch_count"; exit 0
fi

printf 'READ\t-\t%s\n' "$touch_count"; exit 2
