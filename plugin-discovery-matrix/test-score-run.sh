#!/usr/bin/env bash
# test-score-run.sh — locks the measurement contract for score-run.sh.
set -uo pipefail
cd "$(dirname "$0")"

pass=0 fail=0
check() { # <label> <expected-tier> <expected-exit> <actual-out> <actual-exit>
  local label="$1" xtier="$2" xrc="$3" out="$4" rc="$5"
  local tier="${out%%$'\t'*}"
  if [ "$tier" = "$xtier" ] && [ "$rc" = "$xrc" ]; then
    printf 'PASS  %-24s -> %s (rc=%s)\n' "$label" "$out" "$rc"; pass=$((pass+1))
  else
    printf 'FAIL  %-24s expected %s/rc%s got %s/rc%s\n' "$label" "$xtier" "$xrc" "$out" "$rc"; fail=$((fail+1))
  fi
}

run() { local f="$1"; local o; o="$(./score-run.sh "$f")"; echo "$o|$?"; }

for t in invoked:INVOKED:0 read:READ:2 bypass:BYPASS:1; do
  name="${t%%:*}"; rest="${t#*:}"; tier="${rest%%:*}"; rc="${rest#*:}"
  o="$(./score-run.sh "fixtures/transcripts/$name.jsonl")"; a=$?
  check "$name.jsonl" "$tier" "$rc" "$o" "$a"
done

# stdin path
o="$(./score-run.sh - < fixtures/transcripts/invoked.jsonl)"; a=$?
check "stdin invoked" INVOKED 0 "$o" "$a"

# absolute-path engine run (read the engine block, then ran the resolved abs path — no xcsh:// in
# the bash command). This is the form that nearly went undetected; lock it.
o="$(./score-run.sh fixtures/transcripts/invoked-abspath.jsonl)"; a=$?
check "invoked via abspath" INVOKED 0 "$o" "$a"
[ "${o#*$'\t'}" = "next"$'\t'3 ] && echo "PASS  abspath cmd=next" || { echo "FAIL  abspath got: ${o#*$'\t'}"; fail=$((fail+1)); }

# multiple distinct engine commands → comma list, still INVOKED
tmp="$(mktemp)"
cat > "$tmp" <<'EOF'
{"type":"tool_execution_start","toolName":"bash","args":{"command":"bun xcsh://plugin/meddpicc/file/engine/cli.ts next d.json"}}
{"type":"tool_execution_start","toolName":"bash","args":{"command":"bun xcsh://plugin/meddpicc/file/engine/cli.ts score d.json"}}
EOF
o="$(./score-run.sh "$tmp")"; a=$?
check "multi-cmd" INVOKED 0 "$o" "$a"
[ "${o#*$'\t'}" = "next,score"$'\t'2 ] && echo "PASS  multi-cmd list=next,score" || { echo "FAIL  multi-cmd list got: ${o#*$'\t'}"; fail=$((fail+1)); }

# real captured transcript (110-line live `bun dev --mode json` run) must classify INVOKED —
# guards the scorer against drift in real AgentEvent shape, not just synthetic lines.
if [ -f fixtures/transcripts/real-invoked.jsonl ]; then
  o="$(./score-run.sh fixtures/transcripts/real-invoked.jsonl)"; a=$?
  check "real-invoked capture" INVOKED 0 "$o" "$a"
fi

# malformed line must not crash; still classifies from the good line
printf 'not json\n%s\n' '{"type":"tool_execution_start","toolName":"read","args":{"url":"xcsh://plugin/meddpicc"}}' > "$tmp"
o="$(./score-run.sh "$tmp")"; a=$?
check "malformed+read" READ 2 "$o" "$a"
rm -f "$tmp"

echo "-----"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
