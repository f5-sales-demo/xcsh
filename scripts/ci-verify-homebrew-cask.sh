#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if id -Gn | tr ' ' '\n' | grep -qx admin; then
  echo "::error::Homebrew cask UAT must run as a standard non-admin account"
  exit 1
fi
if sudo -n true >/dev/null 2>&1; then
  echo "::error::Homebrew cask UAT account unexpectedly has sudo access"
  exit 1
fi

expected="${EXPECTED_VERSION#v}"
tap="f5-sales-demo/tap"
cask="${tap}/xcsh"
brew_prefix=$(brew --prefix)
caskroom=$(brew --caskroom)
installed_link="${brew_prefix}/bin/xcsh"
installed_root="${caskroom}/xcsh/${expected}"
archive="${TMPDIR:-/tmp}/xcsh-darwin-${RELEASE_ARCH}.zip"
source_root="${TMPDIR:-/tmp}/xcsh-homebrew-source-${RELEASE_ARCH}"
data_marker="${HOME}/.xcsh/no-sudo-homebrew-uat"
uat_workspace="${HOME}/xcsh-homebrew-uat-workspace"
baseline_version=21.32.0
baseline_archive="${TMPDIR:-/tmp}/xcsh-darwin-${RELEASE_ARCH}-${baseline_version}.zip"

sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

verify_developer_id() {
  local file=$1
  local details

  codesign --verify --deep --strict --verbose=2 "$file"
  details=$(codesign --display --verbose=4 "$file" 2>&1)
  grep -F "Authority=Developer ID Application" <<<"$details"
  grep -F "TeamIdentifier=97ZYL78T5F" <<<"$details"
}

snapshot_installed() {
  find "$installed_root/bin" "$installed_root/libexec" -type f -exec shasum -a 256 {} + | LC_ALL=C sort
}

verify_manifest() {
  local root=$1 layout=$2 manifest=$3
  /usr/bin/python3 - "$root" "$layout" "$manifest" <<'PY'
import hashlib, json, pathlib, sys
root, layout, manifest_path = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
manifest = json.loads(manifest_path.read_text())
assert manifest["schemaVersion"] == 1
assert manifest["teamIdentifier"] == "97ZYL78T5F"
expected = set()
expected_architecture = "arm64" if manifest["arch"] == "arm64" else "x86_64"
cli_entitlements = {"com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory"}
for item in manifest["files"]:
    signature = item["signature"]
    assert signature["authority"] == "Developer ID Application", item
    assert signature["teamIdentifier"] == "97ZYL78T5F", item
    assert signature["hardenedRuntime"] is True, item
    assert signature["trustedTimestamp"] is True, item
    assert signature["notarized"] is True, item
    assert signature["architectures"] == [expected_architecture], item
    assert set(signature["entitlements"]) == (cli_entitlements if item["role"] == "cli" else set()), item
    relative = pathlib.Path("bin/xcsh" if item["role"] == "cli" else f"libexec/{item['name']}")
    expected.add(relative.as_posix())
    target = root / relative
    assert target.is_file(), target
    assert target.stat().st_size == item["size"], target
    assert hashlib.sha256(target.read_bytes()).hexdigest() == item["sha256"], target
actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
assert actual == expected | {"provenance/manifest.json"}, (actual, expected)
PY
}

verify_current_install() {
  test -L "$installed_link"
  resolved_binary=$(realpath "$installed_link")
  test "$resolved_binary" = "$installed_root/bin/xcsh"
  verify_manifest "$installed_root" homebrew "$installed_root/provenance/manifest.json"
  test "$(sha256 "$source_root/bin/xcsh")" = "$(sha256 "$resolved_binary")"
  verify_developer_id "$resolved_binary"

  for source_native in "${source_natives[@]}"; do
    installed_native="$installed_root/libexec/$(basename "$source_native")"
    test -f "$installed_native"
    test "$(sha256 "$source_native")" = "$(sha256 "$installed_native")"
    verify_developer_id "$installed_native"
  done

  before=$(snapshot_installed)
  "$installed_link" --version
  "$installed_link" --help >/dev/null
  qmd_home=$(mktemp -d "${TMPDIR:-/tmp}/xcsh-qmd-smoke.XXXXXX")
  qmd_stderr="${TMPDIR:-/tmp}/xcsh-qmd-smoke.stderr"
  qmd_output=$(HOME="$qmd_home" XCSH_SMOKE_TEST_QMD=1 "$installed_link" 2>"$qmd_stderr")
  test "$qmd_output" = "XCSH_QMD_SMOKE_OK"
  test ! -s "$qmd_stderr"
  rm -rf "$qmd_home" "$qmd_stderr"
  PI_DEV=1 "$installed_link" sandbox check 2>&1 | tee "${TMPDIR:-/tmp}/xcsh-cask-native-load.log"
  grep -F "Loaded native addon from ${installed_root}/libexec/" "${TMPDIR:-/tmp}/xcsh-cask-native-load.log"
  "$installed_link" chrome recycle
  "$installed_link" office recycle
  after=$(snapshot_installed)
  test "$before" = "$after"
}

assert_no_legacy_package() {
  if pkgutil --pkg-info com.f5.xcsh >/dev/null 2>&1; then
    echo "::error::Historical com.f5.xcsh receipt is present"
    exit 1
  fi
  if [[ -e "/Library/Application Support/xcsh" ]]; then
    echo "::error::Historical package payload is present"
    exit 1
  fi
}

mkdir -p "${HOME}/.xcsh" "$source_root"
mkdir -p "$uat_workspace"
chmod 700 "$uat_workspace"
test -d "$uat_workspace"
test "$(stat -f '%Su' "$uat_workspace")" = "$(id -un)"
cd "$uat_workspace"
printf '%s\n' preserve >"$data_marker"

# A release runner starts clean. If it does not, stop: the historical package
# must be removed through MDM before this unprivileged cask is used.
brew uninstall --formula --force xcsh >/dev/null 2>&1 || true
brew uninstall --cask --force "$cask" >/dev/null 2>&1 || true
assert_no_legacy_package

curl --proto '=https' --tlsv1.2 -fsSLo "$archive" \
  "https://github.com/f5-sales-demo/xcsh/releases/download/${EXPECTED_VERSION}/xcsh-darwin-${RELEASE_ARCH}.zip"
rm -rf "$source_root"
mkdir -p "$source_root"
unzip -q "$archive" -d "$source_root"
test -x "$source_root/bin/xcsh"
test -f "$source_root/provenance/manifest.json"
verify_manifest "$source_root" homebrew "$source_root/provenance/manifest.json"
shopt -s nullglob
source_natives=("$source_root"/libexec/pi_natives.darwin-"${RELEASE_ARCH}"*.node)
if [[ ${#source_natives[@]} -eq 0 ]]; then
  echo "::error::Released archive contains no darwin-${RELEASE_ARCH} native addon"
  exit 1
fi

max_attempts=8
delay=10
for attempt in $(seq 1 "$max_attempts"); do
  echo "=== Homebrew cask install attempt ${attempt}/${max_attempts} ==="
  brew untap "$tap" >/dev/null 2>&1 || true
  brew tap "$tap"
  if brew install --cask "$cask"; then
    installed=$("$installed_link" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
    if [[ "$installed" == "$expected" ]]; then
      break
    fi
  fi

  brew uninstall --cask --force "$cask" >/dev/null 2>&1 || true
  if [[ "$attempt" -eq "$max_attempts" ]]; then
    echo "::error::Homebrew cask installation failed after ${max_attempts} attempts"
    exit 1
  fi
  sleep "$delay"
  if [[ "$delay" -lt 60 ]]; then delay=$((delay * 2)); fi
done

verify_current_install

# Exercise a real immutable-baseline upgrade after the independent fresh-install gate.
brew uninstall --cask "$cask"
curl --proto '=https' --tlsv1.2 -fsSLo "$baseline_archive" \
  "https://github.com/f5-sales-demo/xcsh/releases/download/v${baseline_version}/xcsh-darwin-${RELEASE_ARCH}.zip"
baseline_sha=$(sha256 "$baseline_archive")
BASELINE_VERSION="$baseline_version" \
  BASELINE_SHA256="$baseline_sha" \
  RELEASE_ARCH="$RELEASE_ARCH" \
  /bin/bash "$script_dir/ci-homebrew-upgrade-fixture.sh"
verify_current_install

assert_no_legacy_package
brew uninstall --cask "$cask"
test ! -e "$installed_link"
test ! -e "$installed_root"
test -f "$data_marker"
assert_no_legacy_package

echo "No-sudo Homebrew cask verification passed for ${RELEASE_ARCH}"
