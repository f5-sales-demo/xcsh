#!/usr/bin/env bash
# Behaviour tests for scripts/pii-baseline-gate.py.
#
# The gate's whole value is the direction of its asymmetry: growth fails, parity and improvement
# pass. Each case below fixes one of those directions, plus the failure modes that would make the
# gate silently useless (missing baseline, empty input, malformed JSON).
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
GATE="${REPO_ROOT}/scripts/pii-baseline-gate.py"
WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT

PASS=0
FAIL=0

# run <expected-exit> <name> <findings-file> [extra args...]
run() {
  local expected=$1 name=$2 findings=$3
  shift 3
  local actual=0
  python3 "${GATE}" --findings "${findings}" "$@" >"${WORK}/out.txt" 2>&1 || actual=$?
  if [ "${actual}" = "${expected}" ]; then
    PASS=$((PASS + 1))
    echo "  ok    ${name} (exit ${actual})"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  ${name}: expected exit ${expected}, got ${actual}"
    sed 's/^/          /' "${WORK}/out.txt"
  fi
}

finding() { # path category [line]
  printf '{"category":"%s","line":%s,"message":"m","path":"%s","severity":"high"}' "$2" "${3:-1}" "$1"
}

cat >"${WORK}/two.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 1),$(finding a.ts email 9)]}
EOF
cat >"${WORK}/three.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 1),$(finding a.ts email 9),$(finding a.ts email 12)]}
EOF
cat >"${WORK}/one.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 1)]}
EOF
cat >"${WORK}/newpath.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 1),$(finding a.ts email 9),$(finding b.ts email 3)]}
EOF
cat >"${WORK}/newcat.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 1),$(finding a.ts email 9),$(finding a.ts home-path 4)]}
EOF
cat >"${WORK}/moved.json" <<EOF
{"mode":"enforce","scope":"head","findings":[$(finding a.ts email 400),$(finding a.ts email 900)]}
EOF
echo -n "" >"${WORK}/empty.json"
echo "{not json" >"${WORK}/bad.json"

echo "pii-baseline-gate:"

# Baseline of two email findings in a.ts.
python3 "${GATE}" --findings "${WORK}/two.json" --baseline "${WORK}/base.json" --update >/dev/null

run 0 "same counts pass" "${WORK}/two.json" --baseline "${WORK}/base.json"
run 0 "fewer findings pass, and are reported as an improvement" "${WORK}/one.json" --baseline "${WORK}/base.json"
run 0 "same counts on different lines pass (baseline is not line-keyed)" "${WORK}/moved.json" --baseline "${WORK}/base.json"
run 1 "more findings of a known category fail" "${WORK}/three.json" --baseline "${WORK}/base.json"
run 1 "a finding in a new path fails" "${WORK}/newpath.json" --baseline "${WORK}/base.json"
run 1 "a new category in a known path fails" "${WORK}/newcat.json" --baseline "${WORK}/base.json"
run 2 "a missing baseline is an error, not a pass" "${WORK}/two.json" --baseline "${WORK}/absent.json"
run 2 "empty scanner output is an error, not a pass" "${WORK}/empty.json" --baseline "${WORK}/base.json"
run 2 "malformed scanner output is an error, not a pass" "${WORK}/bad.json" --baseline "${WORK}/base.json"

# An improvement must be reported so the ceiling can be lowered deliberately.
python3 "${GATE}" --findings "${WORK}/one.json" --baseline "${WORK}/base.json" >"${WORK}/imp.txt" 2>&1 || true
if grep -q 'fixed since the baseline' "${WORK}/imp.txt"; then
  PASS=$((PASS + 1))
  echo "  ok    an improvement is reported, not silently accepted"
else
  FAIL=$((FAIL + 1))
  echo "  FAIL  an improvement was not reported"
fi

# A failure must name the offending path so it is actionable.
python3 "${GATE}" --findings "${WORK}/newpath.json" --baseline "${WORK}/base.json" >"${WORK}/f.txt" 2>&1 || true
if grep -q 'b.ts' "${WORK}/f.txt" && grep -q '::error' "${WORK}/f.txt"; then
  PASS=$((PASS + 1))
  echo "  ok    a failure names the offending path and annotates it"
else
  FAIL=$((FAIL + 1))
  echo "  FAIL  a failure did not name the offending path"
fi

echo "  ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
