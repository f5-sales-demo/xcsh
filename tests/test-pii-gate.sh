#!/usr/bin/env bash
# Behaviour tests for the zero-finding PII gate. The fake scanner exercises the gate's public shell
# contract without coupling these tests to the managed scanner's detection rules.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/repo/scripts"
cp "${REPO_ROOT}/scripts/pii-gate.sh" "${WORK}/repo/scripts/pii-gate.sh"
cat >"${WORK}/repo/scripts/check-pii.sh" <<'SCANNER'
#!/usr/bin/env bash
set -euo pipefail

scope=""
mode=""
format=""
while [ "$#" -gt 0 ]; do
  case "$1" in
  --scope | --mode | --format)
    name=${1#--}
    [ "$#" -ge 2 ] || exit 2
    printf -v "${name}" '%s' "$2"
    shift 2
    ;;
  *) exit 2 ;;
  esac
done

[ "${mode}" = "enforce" ] && [ "${format}" = "json" ] || exit 2

case "${PII_GATE_TEST_SCENARIO}" in
clean)
  printf '{"scope":"%s","mode":"enforce","findings":[]}\n' "${scope}"
  ;;
finding)
  printf '%s\n' '{"scope":"head","mode":"enforce","findings":[{"path":"fixtures/synthetic-record.yaml","line":7,"category":"email","message":"do-not-print-this-marker","severity":"high"}]}'
  exit 1
  ;;
empty) ;;
malformed) printf '{not-json\n' ;;
failure) exit 2 ;;
inconsistent)
  printf '{"scope":"%s","mode":"enforce","findings":[]}\n' "${scope}"
  exit 1
  ;;
staged)
  [ "${scope}" = "staged" ] || exit 2
  printf '%s\n' '{"scope":"staged","mode":"enforce","findings":[]}'
  ;;
*) exit 2 ;;
esac
SCANNER

PASS=0
FAIL=0

run() {
  local expected=$1 name=$2 scenario=$3
  shift 3
  local actual=0
  PII_GATE_TEST_SCENARIO="${scenario}" bash "${WORK}/repo/scripts/pii-gate.sh" "$@" \
    >"${WORK}/out.txt" 2>&1 || actual=$?
  if [ "${actual}" = "${expected}" ]; then
    PASS=$((PASS + 1))
    echo "  ok    ${name} (exit ${actual})"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  ${name}: expected exit ${expected}, got ${actual}"
    sed 's/^/          /' "${WORK}/out.txt"
  fi
}

echo "pii-gate:"
run 0 "zero findings pass" clean
run 1 "any finding fails" finding
if grep -q 'fixtures/synthetic-record.yaml' "${WORK}/out.txt" &&
  grep -q '\[email\]' "${WORK}/out.txt" &&
  ! grep -q 'do-not-print-this-marker' "${WORK}/out.txt"; then
  PASS=$((PASS + 1))
  echo "  ok    findings name the path and category without reproducing scanner messages"
else
  FAIL=$((FAIL + 1))
  echo "  FAIL  finding output was not actionable and redacted"
fi
run 2 "empty scanner output fails closed" empty
run 2 "malformed scanner output fails closed" malformed
run 2 "scanner failure remains an operational failure" failure
run 2 "scanner status and output must agree" inconsistent
run 0 "staged scope remains supported" staged --scope staged
run 2 "removed baseline arguments are rejected" clean --baseline absent.json
run 2 "removed update argument is rejected" clean --update

echo "  ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ]
