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
printf '%s\n' "$CANARY" >"$SIBLING/secret.txt"
printf 'mine\n' >"$WORKSPACE/own.txt"
printf '[user]\n' >"$HOME_DIR/.gitconfig"

# The shape a real fence has: the home tree and the workspace's parent denied, the workspace carved back
# out, plus one read-only and one write-only root.
FENCE=$(printf '{"allow":["%s"],"allowReadOnly":["%s"],"allowWriteOnly":["%s"],"deny":["%s","%s"]}' \
  "$WORKSPACE" "$HOME_DIR/.gitconfig" "$DROP" "$HOME_DIR" "$HOME_DIR/GIT")

pass=0 fail=0

# expect <label> <want: ok|refused> <command...>
expect() {
  local label="$1" want="$2"
  shift 2
  local out rc
  out=$("$BIN" run --fence "$FENCE" --cwd "$WORKSPACE" "$*" 2>&1)
  rc=$?
  local got=ok
  [ "$rc" -eq 0 ] || got=refused
  if [ "$got" = "$want" ] && ! grep -q "$CANARY" <<<"$out"; then
    printf 'PASS  %-52s (%s)\n' "$label" "$got"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-52s want=%s got=%s\n      %s\n' "$label" "$want" "$got" "${out//$'\n'/ | }"
    fail=$((fail + 1))
  fi
}

printf '=== backend ===\n'
"$BIN" status || {
  printf 'no OS backend here; these results would prove nothing\n'
  exit 1
}

printf '\n=== the boundary holds ===\n'
# The control first. If this does NOT leak, the fixture is wrong and every refusal below is meaningless.
control=$("$BIN" run --cwd "$WORKSPACE" "cat $SIBLING/secret.txt" 2>&1)
if grep -q "$CANARY" <<<"$control"; then
  printf 'PASS  %-52s (leaks unfenced, as it must)\n' "control: unfenced read of the sibling"
  pass=$((pass + 1))
else
  printf 'FAIL  %-52s the control did not leak: %s\n' "control: unfenced read of the sibling" "$control"
  fail=$((fail + 1))
fi
expect "fenced read of the sibling checkout" refused "cat $SIBLING/secret.txt"
expect "fenced read via a runtime-assembled path" refused "T=$SIBLING/secret.txt; cat \"\$T\""
expect "fenced write into the sibling checkout" refused "printf x > $SIBLING/planted.txt"
expect "fenced read of the denied home" refused "cat $HOME_DIR/.bash_history"

# A Landlock rule attaches to the inode behind the descriptor, so a symlink enumerated as an ordinary
# child of a split directory used to grant whatever it pointed at. Measured: this made the denied file
# readable *directly*, not merely through the link — the whole deny was gone. Both forms are asserted,
# because fixing only the link-shaped one would leave the real hole open.
ln -sfn "$HOME_DIR" "$ROOT/pivot" 2>/dev/null
expect "no escape through a symlink into the denied tree" refused "cat $ROOT/pivot/GIT/custB/secret.txt"
expect "the denied tree stays denied directly" refused "cat $SIBLING/secret.txt"

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

printf '\n=== exact parent enumeration courtesy ===\n'
BASE_FENCE="$FENCE"
FENCE=$(printf '{"allow":["%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":[],"denyEnumerate":["%s"]}' \
  "$WORKSPACE" "$HOME_DIR/GIT")
expect "listing the protected parent" refused "ls $HOME_DIR/GIT > /dev/null"
expect "read a named sibling file" ok "cat $SIBLING/secret.txt > /dev/null && echo named-ok"
expect "write a named sibling file" ok "printf named > $SIBLING/named.txt && test -f $SIBLING/named.txt"
expect "list below a named sibling" ok "ls $SIBLING > /dev/null && echo child-ok"
FENCE="$BASE_FENCE"

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

printf '\n=== a fresh home can create its granted config dirs (#2588) ===\n'
# A Landlock rule attaches to an inode, so a granted directory that does not exist yet cannot carry one:
# `open` fails, the grant is dropped, and the home deny stays. Creating it needs write on the *parent*,
# which is the denied home — so on a fresh machine `~/.aws` and `~/.config/gh` were unreachable AND
# uncreatable, and every first-run or login flow failed with a bare EACCES.
#
# Measured before the fix, on ABI 9: `mkdir ~/.aws` inside the fence gave "Permission denied".
FRESH="$ROOT/fresh"
mkdir -p "$FRESH/w"
FRESH_FENCE=$(printf '{"allow":["%s","%s","%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s"]}' \
  "$FRESH/w" "$FRESH/.aws" "$FRESH/.config/gh" "$FRESH")

fresh_expect() {
  local label="$1" want="$2"
  shift 2
  local out rc
  out=$("$BIN" run --fence "$FRESH_FENCE" --cwd "$FRESH/w" "$*" 2>&1)
  rc=$?
  local got=ok
  [ "$rc" -eq 0 ] || got=refused
  if [ "$got" = "$want" ]; then
    printf 'PASS  %-52s (%s)\n' "$label" "$got"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-52s want=%s got=%s\n      %s\n' "$label" "$want" "$got" "${out//$'\n'/ | }"
    fail=$((fail + 1))
  fi
}

# An external command, which is what a CLI is — the grant is prepared while composing it.
fresh_expect "write into an absent granted dir" ok \
  "/bin/sh -c 'printf x > $FRESH/.aws/config'"
fresh_expect "write into an absent nested granted dir" ok \
  "/bin/sh -c 'printf y > $FRESH/.config/gh/hosts.yml'"

if [ -d "$FRESH/.aws" ] && [ -d "$FRESH/.config/gh" ]; then
  printf 'PASS  %-52s (created)\n' "the dirs themselves now exist"
  pass=$((pass + 1))
else
  printf 'FAIL  %-52s the granted dirs were not created\n' "the dirs themselves now exist"
  fail=$((fail + 1))
fi

# Creation must not follow a symlinked ancestor out of the tree: `create_dir_all` would happily do it,
# which would make a directory appear somewhere the operator never granted.
LINKED="$ROOT/linked"
mkdir -p "$LINKED/w" "$ROOT/elsewhere"
ln -s "$ROOT/elsewhere" "$LINKED/.config"
LINK_FENCE=$(printf '{"allow":["%s","%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s"]}' \
  "$LINKED/w" "$LINKED/.config/gh" "$LINKED")
"$BIN" run --fence "$LINK_FENCE" --cwd "$LINKED/w" "/bin/sh -c 'echo probe'" >/dev/null 2>&1 || true
if [ -e "$ROOT/elsewhere/gh" ]; then
  printf 'FAIL  %-52s created through the symlink\n' "creation refuses a symlinked ancestor"
  fail=$((fail + 1))
else
  printf 'PASS  %-52s (refused)\n' "creation refuses a symlinked ancestor"
  pass=$((pass + 1))
fi

# The guard must inspect EVERY component, not just the deepest existing one. With `.config` a link and
# `.config/gh` existing through it, the deepest existing ancestor is an ordinary directory and the link
# would go unnoticed — so this plants exactly that shape.
DEEP="$ROOT/deep"
mkdir -p "$DEEP/w" "$ROOT/target/gh"
ln -s "$ROOT/target" "$DEEP/.config"
DEEP_FENCE=$(printf '{"allow":["%s","%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s"]}' \
  "$DEEP/w" "$DEEP/.config/gh/sub" "$DEEP")
"$BIN" run --fence "$DEEP_FENCE" --cwd "$DEEP/w" "/bin/sh -c 'echo probe'" >/dev/null 2>&1 || true
if [ -e "$ROOT/target/gh/sub" ]; then
  printf 'FAIL  %-52s created through a deeper symlink\n' "every component is checked, not just the last"
  fail=$((fail + 1))
else
  printf 'PASS  %-52s (refused)\n' "every component is checked, not just the last"
  pass=$((pass + 1))
fi

# Brush has a `umask` builtin, so the process mask is attacker-influenced from inside the session. A
# created credential directory must not inherit it.
MODE_HOME="$ROOT/mode"
mkdir -p "$MODE_HOME/w"
MODE_FENCE=$(printf '{"allow":["%s","%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s"]}' \
  "$MODE_HOME/w" "$MODE_HOME/.aws" "$MODE_HOME")
"$BIN" run --fence "$MODE_FENCE" --cwd "$MODE_HOME/w" "umask 000; /bin/sh -c 'echo probe'" >/dev/null 2>&1 || true
if [ -d "$MODE_HOME/.aws" ]; then
  mode=$(stat -c '%a' "$MODE_HOME/.aws" 2>/dev/null || stat -f '%Lp' "$MODE_HOME/.aws")
  if [ "$mode" = "700" ]; then
    printf 'PASS  %-52s (0%s)\n' "created dirs ignore the process umask" "$mode"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-52s mode=0%s want=0700\n' "created dirs ignore the process umask" "$mode"
    fail=$((fail + 1))
  fi
else
  printf 'FAIL  %-52s the dir was not created at all\n' "created dirs ignore the process umask"
  fail=$((fail + 1))
fi

# A path the compiler merely *discovered* while enumerating a split directory must never be recreated —
# it may be the wrong object type, or mid atomic-replace. Only roots the fence names are eligible.
ENUM_HOME="$ROOT/enum"
mkdir -p "$ENUM_HOME/w" "$ENUM_HOME/keep"
printf 'x' >"$ENUM_HOME/keep/probe-file"
ENUM_FENCE=$(printf '{"allow":["%s","%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s"]}' \
  "$ENUM_HOME/w" "$ENUM_HOME/keep" "$ENUM_HOME")
rm -f "$ENUM_HOME/keep/probe-file" # disappears between compilation and use
"$BIN" run --fence "$ENUM_FENCE" --cwd "$ENUM_HOME/w" "/bin/sh -c 'echo probe'" >/dev/null 2>&1 || true
if [ -d "$ENUM_HOME/keep/probe-file" ]; then
  printf 'FAIL  %-52s recreated a discovered entry as a directory\n' "only fence-named roots are created"
  fail=$((fail + 1))
else
  printf 'PASS  %-52s (not recreated)\n' "only fence-named roots are created"
  pass=$((pass + 1))
fi

# The production fence shape since #2624: the data roots at depth 1 are denied by name, which makes `/`
# itself a split directory. That is a materially different plan from the one above — every case so far
# denies only a deep subtree, so `/` was granted wholesale — and the risk it carries is that the
# complement collapses and nothing can run at all. The empty-grant guard would then refuse to build a
# ruleset, which is safe but would silently turn every fleet host into scanner-only.
printf '\n=== top-level data roots denied, as production does (#2624) ===\n'
TOP_FENCE=$(printf '{"allow":["%s"],"allowReadOnly":[],"allowWriteOnly":[],"deny":["%s","%s","/home","/root","/srv","/mnt","/media","/export"]}' \
  "$WORKSPACE" "$HOME_DIR" "$HOME_DIR/GIT")

top_expect() {
  local label="$1" want="$2"
  shift 2
  local out rc
  out=$("$BIN" run --fence "$TOP_FENCE" --cwd "$WORKSPACE" "$*" 2>&1)
  rc=$?
  local got=ok
  [ "$rc" -ne 0 ] && got=refused
  if [ "$got" = "$want" ]; then
    printf 'PASS  %-52s (%s)\n' "$label" "$got"
    pass=$((pass + 1))
  else
    printf 'FAIL  %-52s want=%s got=%s\n      %s\n' "$label" "$want" "$got" "${out//$'\n'/ | }"
    fail=$((fail + 1))
  fi
}

# The positive controls come first and are the point of this block: if the plan collapsed, these fail and
# the refusals below would be passing for the wrong reason.
top_expect "ordinary work still runs with / split" ok "printf hi > split.txt && cat split.txt"
top_expect "a system binary still runs" ok "/bin/sh -c 'echo ok'"
top_expect "a system path is still readable" ok "head -1 /usr/bin/env > /dev/null && echo ok"
top_expect "the OS temp dir is still writable" ok "printf x > /tmp/ll-e2e-top && echo ok"
top_expect "cross-directory mv still works (REFER)" ok "mkdir -p m1 m2 && touch m1/x && mv m1/x m2/x && test -f m2/x"
# …and the new coverage itself. `/home` holds other operators' accounts on a Linux fleet host.
top_expect "the home container is refused" refused "ls /home"
top_expect "the sibling checkout is still refused" refused "cat $SIBLING/secret.txt"

printf '\n=== %d passed, %d failed ===\n' "$pass" "$fail"
rm -rf "$ROOT" /tmp/ll-e2e-probe /tmp/ll-e2e-top
[ "$fail" -eq 0 ]
