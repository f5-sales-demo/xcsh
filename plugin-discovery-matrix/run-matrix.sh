#!/usr/bin/env bash
# run-matrix.sh — orchestrate the plugin-discovery experiment.
#
# Crosses surfacing technique (control/A/C/B) × artifact form (self-describing/thin) ×
# prompt (phrases.yaml) × N trials, dispatching each cell to run-cell.sh, then aggregates
# results/*.tsv into report.md via analyze.sh.
#
# Flags:
#   --dry-run              print the planned cell list and exit (no agent runs)
#   --only <c,a,p>         restrict to matching cond,artifact,prompt (use * for any field)
#   -n <N>                 trials per cell (default 3)
#   -j <JOBS>              concurrent cells per batch (default 1; higher = faster, more API load)
#   --keep                 do not clear prior runs/results before starting
#
# Env: TIMEOUT (per-run seconds, passed through to run-cell.sh).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

N="${N:-3}"; JOBS="${JOBS:-1}"; DRY=0; ONLY=""; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --only) ONLY="${2:?}"; shift ;;
    -n) N="${2:?}"; shift ;;
    -j) JOBS="${2:?}"; shift ;;
    --keep) KEEP=1 ;;
    *) echo "run-matrix: unknown arg $1" >&2; exit 2 ;;
  esac; shift
done

# ── Preflight ────────────────────────────────────────────────────────────────
command -v bun >/dev/null || { echo "PRE: bun not found" >&2; exit 1; }
command -v jq  >/dev/null || { echo "PRE: jq not found"  >&2; exit 1; }
reg="$HOME/.xcsh/plugins/installed_plugins.json"
grep -q '"meddpicc@' "$reg" 2>/dev/null || {
  echo "PRE: meddpicc not installed (checked $reg). Install via: xcsh plugin install meddpicc@<marketplace>" >&2; exit 1; }
[ -f "$HERE/fixtures/deal-self-describing.json" ] && [ -f "$HERE/fixtures/deal-thin.json" ] || {
  echo "PRE: fixtures missing — run fixtures/make-thin.sh first" >&2; exit 1; }
[ -f "$HERE/../packages/coding-agent/src/cli.ts" ] || { echo "PRE: cli.ts not found (run from xcsh repo)" >&2; exit 1; }

CONDS="control A C B"
ARTIFACTS="self-describing thin"
PROMPTS="$(awk '/^#/{next} {i=index($0,": "); if(i>0)print substr($0,1,i-1)}' "$HERE/phrases.yaml")"

if [ "$DRY" = 0 ] && [ "$KEEP" = 0 ]; then
  rm -rf "$HERE/runs" "$HERE/results"
fi
mkdir -p "$HERE/runs" "$HERE/results"

# ── Build cell list (honoring --only) ────────────────────────────────────────
oc="*"; oa="*"; op="*"
if [ -n "$ONLY" ]; then IFS=',' read -r oc oa op <<< "$ONLY"; : "${oc:=*}" "${oa:=*}" "${op:=*}"; fi

cells=""
for c in $CONDS; do
  [ "$oc" = "*" ] || [ "$oc" = "$c" ] || continue
  for a in $ARTIFACTS; do
    [ "$oa" = "*" ] || [ "$oa" = "$a" ] || continue
    for p in $PROMPTS; do
      [ "$op" = "*" ] || [ "$op" = "$p" ] || continue
      t=1; while [ "$t" -le "$N" ]; do cells="$cells$c $a $p $t"$'\n'; t=$((t+1)); done
    done
  done
done
cells="$(printf '%s' "$cells" | sed '/^$/d')"
count="$(printf '%s\n' "$cells" | grep -c . || true)"

echo "planned cells: $count  (N=$N, JOBS=$JOBS)"
if [ "$DRY" = 1 ]; then printf '%s\n' "$cells"; exit 0; fi

# ── Dispatch in batches of JOBS (bash 3.2-safe: no `wait -n`) ─────────────────
i=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # shellcheck disable=SC2086
  set -- $line
  "$HERE/run-cell.sh" "$1" "$2" "$3" "$4" &
  i=$((i+1))
  [ $((i % JOBS)) -eq 0 ] && wait
done <<< "$cells"
wait

# ── Aggregate ────────────────────────────────────────────────────────────────
"$HERE/analyze.sh" > "$HERE/report.md"
echo "report -> $HERE/report.md"
tail -n 30 "$HERE/report.md"
