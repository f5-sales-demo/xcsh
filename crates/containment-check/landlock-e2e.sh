#!/usr/bin/env bash
# Does Landlock confinement actually hold, through the shipped code path?
#
# `containment-check run` builds a real brush shell and sets `params.containment` the way the host does,
# so every case below goes through `compose_std_command` → a real ruleset → a real forked child. Nothing
# here reimplements the mechanism, which is the point: a test that models the sandbox instead of using it
# proves only that the model agrees with itself.
#
# Usage: landlock-e2e.sh /path/to/containment-check
set -uo pipefail

BIN="${1:?usage: landlock-e2e.sh /path/to/containment-check}"
ROOT="$(mktemp -d)"
HOME_DIR="$ROOT/home"
WORKSPACE="$HOME_DIR/GIT/custA"
SIBLING="$HOME_DIR/GIT/custB"
DROP="$HOME_DIR/drop"
CANARY="LANDLOCK-CANARY-8801"

mkdir -p "$WORKSPACE/sub" "$SIBLING" "$DROP"
printf '%s\n' "$CANARY" > "$SIBLING/secret.txt"
printf 'mine\n' > "$WORKSPACE/own.txt"
printf '[user]\n' > "$HOME_DIR/.gitconfig"

# The shape a real fence has: the home tree and the workspace's parent denied, the workspace carved back
# out, plus one read-only and one write-only root.
FENCE=$(printf '{"allow":["%s"],"allowReadOnly":["%s"],"allowWriteOnly":["%s"],"deny":["%s","%s"]}' \
	"$WORKSPACE" "$HOME_DIR/.gitconfig" "$DROP" "$HOME_DIR" "$HOME_DIR/GIT")

pass=0 fail=0

# expect <label> <want: ok|refused> <command...>
expect() {
	local label="$1" want="$2"; shift 2
	local out rc
	out=$("$BIN" run --fence "$FENCE" --cwd "$WORKSPACE" "$*" 2>&1); rc=$?
	local got=ok; [ "$rc" -eq 0 ] || got=refused
	if [ "$got" = "$want" ] && ! grep -q "$CANARY" <<<"$out"; then
		printf 'PASS  %-52s (%s)\n' "$label" "$got"; pass=$((pass+1))
	else
		printf 'FAIL  %-52s want=%s got=%s\n      %s\n' "$label" "$want" "$got" "${out//$'\n'/ | }"
		fail=$((fail+1))
	fi
}

printf '=== backend ===\n'
"$BIN" status || { printf 'no OS backend here; these results would prove nothing\n'; exit 1; }

printf '\n=== the boundary holds ===\n'
# The control first. If this does NOT leak, the fixture is wrong and every refusal below is meaningless.
control=$("$BIN" run --cwd "$WORKSPACE" "cat $SIBLING/secret.txt" 2>&1)
if grep -q "$CANARY" <<<"$control"; then
	printf 'PASS  %-52s (leaks unfenced, as it must)\n' "control: unfenced read of the sibling"
	pass=$((pass+1))
else
	printf 'FAIL  %-52s the control did not leak: %s\n' "control: unfenced read of the sibling" "$control"
	fail=$((fail+1))
fi
expect "fenced read of the sibling checkout" refused "cat $SIBLING/secret.txt"
expect "fenced read via a runtime-assembled path" refused "T=$SIBLING/secret.txt; cat \"\$T\""
expect "fenced write into the sibling checkout" refused "printf x > $SIBLING/planted.txt"
expect "fenced read of the denied home" refused "cat $HOME_DIR/.bash_history"

printf '\n=== ordinary work is untouched ===\n'
expect "read a file in the workspace" ok "cat own.txt"
expect "create and read a new file" ok "printf hi > new.txt && cat new.txt"
expect "create a file in a subdirectory" ok "printf hi > sub/deep.txt && cat sub/deep.txt"
expect "mkdir then write" ok "mkdir -p made && printf hi > made/f && cat made/f"
# The only case that catches a missing REFER bit. Without it every cross-directory mv fails, and nothing
# else here would notice.
expect "cross-directory mv (REFER)" ok "mkdir -p a b && touch a/x && mv a/x b/x && test -f b/x"
expect "redirect to /dev/null" ok "echo noise > /dev/null && echo ok"
expect "read a system path" ok "head -1 /usr/bin/env > /dev/null && echo ok"
expect "read /etc" ok "cat /etc/hostname > /dev/null && echo ok"
expect "write in the OS temp dir" ok "printf x > /tmp/ll-e2e-probe && echo ok"
expect "truncate a file in the workspace" ok ": > own.txt && test ! -s own.txt"
expect "pipeline with grep and sed" ok "printf 'a\\nb\\n' > p.txt && sed -n 2p p.txt | grep b"
expect "tar roundtrip" ok "mkdir -p t && echo x > t/f && tar czf t.tgz t && rm -rf t && tar xzf t.tgz && cat t/f"

printf '\n=== directional roots keep their direction ===\n'
expect "read the read-only root" ok "cat $HOME_DIR/.gitconfig > /dev/null && echo ok"
expect "write the read-only root" refused "printf x >> $HOME_DIR/.gitconfig"
expect "write the write-only root" ok "printf x > $DROP/out.log"
expect "read the write-only root" refused "cat $DROP/out.log"

printf '\n=== the accepted costs, asserted so they stay known ===\n'
# A recursive-only rule model cannot grant a directory holding both granted and denied children, so `/`
# and the home's parent lose READ_DIR. Documented in the plan; asserted here so it is a property.
expect "ls / fails (split directory)" refused "ls / > /dev/null"
# `landlock_restrict_self` requires PR_SET_NO_NEW_PRIVS, which disables setuid binaries in the child.
expect "NO_NEW_PRIVS is set in the child" ok \
	"grep -q 'NoNewPrivs:.*1' /proc/self/status"

printf '\n=== %d passed, %d failed ===\n' "$pass" "$fail"
rm -rf "$ROOT" /tmp/ll-e2e-probe
[ "$fail" -eq 0 ]
