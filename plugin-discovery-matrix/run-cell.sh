#!/usr/bin/env bash
# run-cell.sh <cond> <artifact> <prompt-id> <trial> — execute ONE matrix cell end-to-end.
#
# Self-contained: builds its own scratch cwd (with the right deal.json) and its own isolated
# agent dir (PI_CODING_AGENT_DIR, with the right config.yml), runs the local dev agent in
# --mode json, scores the transcript, and writes results/<cell>.tsv. Re-runnable in isolation.
#
# Env: TIMEOUT (default 150s per run).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../packages/coding-agent/src/cli.ts"
TIMEOUT="${TIMEOUT:-150}"

cond="${1:?cond}"; artifact="${2:?artifact}"; pid="${3:?prompt-id}"; trial="${4:?trial}"
cell="${cond}__${artifact}__${pid}__t${trial}"

# Resolve the prompt text from phrases.yaml (split on the first ": ").
prompt="$(awk -v id="$pid" '
  /^#/ { next }
  { i=index($0,": "); if (i>0) { k=substr($0,1,i-1); if (k==id){ print substr($0,i+2); exit } } }
' "$HERE/phrases.yaml")"
[ -z "$prompt" ] && { echo "run-cell: no prompt id=$pid" >&2; exit 3; }

case "$artifact" in
  self-describing) deal="$HERE/fixtures/deal-self-describing.json" ;;
  thin)            deal="$HERE/fixtures/deal-thin.json" ;;
  *) echo "run-cell: bad artifact $artifact" >&2; exit 3 ;;
esac

case "$cond" in
  B) cfg="$HERE/variants/B-config.yml" ;;      # plugin skills in the "You MUST use" catalog
  *) cfg="$HERE/variants/base-config.yml" ;;    # clean baseline (enableXcshPlugins=false)
esac

append=()
case "$cond" in
  A) append=(--append-system-prompt "$HERE/variants/A-plugin-index.md") ;;
  C) append=(--append-system-prompt "$HERE/variants/C-directive.md") ;;
  control|B) : ;;
  *) echo "run-cell: bad cond $cond" >&2; exit 3 ;;
esac

SC="$(mktemp -d)"; ISO="$(mktemp -d)"
trap 'rm -rf "$SC" "$ISO"' EXIT
cp "$deal" "$SC/deal.json"
cp "$cfg" "$ISO/config.yml"

out="$HERE/runs/$cell.jsonl"; err="$HERE/runs/$cell.err"
mkdir -p "$HERE/runs" "$HERE/results"
# Note: ${append[@]+...} guards against bash 3.2's "unbound variable" on empty-array
# expansion under `set -u` (control/B carry no append flag).
( cd "$SC" && PI_CODING_AGENT_DIR="$ISO" timeout "$TIMEOUT" \
    bun "$CLI" --mode json ${append[@]+"${append[@]}"} "$prompt" ) > "$out" 2> "$err"
rc=$?

verdict="$("$HERE/score-run.sh" "$out" 2>/dev/null || true)"
tier="$(printf '%s' "$verdict" | cut -f1)"; [ -z "$tier" ] && tier="ERROR"
cmds="$(printf '%s' "$verdict" | cut -f2)"; [ -z "$cmds" ] && cmds="-"
refs="$(printf '%s' "$verdict" | cut -f3)"; [ -z "$refs" ] && refs="0"

printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$cond" "$artifact" "$pid" "$trial" "$tier" "$cmds" "$refs" "$rc" \
  > "$HERE/results/$cell.tsv"
echo "$cell -> $tier ($cmds) rc=$rc"
