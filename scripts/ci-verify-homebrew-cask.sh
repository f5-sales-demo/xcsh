#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"

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

sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

verify_developer_id() {
  local file=$1
  local details assessment

  codesign --verify --deep --strict --verbose=2 "$file"
  details=$(codesign --display --verbose=4 "$file" 2>&1)
  grep -F "Authority=Developer ID Application" <<<"$details"
  grep -F "TeamIdentifier=97ZYL78T5F" <<<"$details"

  assessment=$(spctl --assess --verbose=4 --type install "$file" 2>&1)
  grep -F "source=Notarized Developer ID" <<<"$assessment"
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
printf '%s\n' preserve >"$data_marker"

# A release runner starts clean. If it does not, stop: the historical package
# must be removed through MDM before this unprivileged cask is used.
brew uninstall --formula --force xcsh >/dev/null 2>&1 || true
brew uninstall --cask --force xcsh >/dev/null 2>&1 || true
assert_no_legacy_package

curl --proto '=https' --tlsv1.2 -fsSLo "$archive" \
  "https://github.com/f5-sales-demo/xcsh/releases/download/${EXPECTED_VERSION}/xcsh-darwin-${RELEASE_ARCH}.zip"
rm -rf "$source_root"
mkdir -p "$source_root"
unzip -q "$archive" -d "$source_root"
test -x "$source_root/bin/xcsh"
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

  brew uninstall --cask --force xcsh >/dev/null 2>&1 || true
  if [[ "$attempt" -eq "$max_attempts" ]]; then
    echo "::error::Homebrew cask installation failed after ${max_attempts} attempts"
    exit 1
  fi
  sleep "$delay"
  if [[ "$delay" -lt 60 ]]; then delay=$((delay * 2)); fi
done

test -L "$installed_link"
resolved_binary=$(realpath "$installed_link")
test "$resolved_binary" = "$installed_root/bin/xcsh"
test "$(sha256 "$source_root/bin/xcsh")" = "$(sha256 "$resolved_binary")"
verify_developer_id "$resolved_binary"

for source_native in "${source_natives[@]}"; do
  installed_native="$installed_root/libexec/$(basename "$source_native")"
  test -f "$installed_native"
  test "$(sha256 "$source_native")" = "$(sha256 "$installed_native")"
  verify_developer_id "$installed_native"
done

"$installed_link" --version
"$installed_link" --help >/dev/null
PI_DEV=1 "$installed_link" sandbox check 2>&1 | tee "${TMPDIR:-/tmp}/xcsh-cask-native-load.log"
grep -F "Loaded native addon from ${installed_root}/libexec/" "${TMPDIR:-/tmp}/xcsh-cask-native-load.log"
brew upgrade --cask xcsh

assert_no_legacy_package
brew uninstall --cask xcsh
test ! -e "$installed_link"
test ! -e "$installed_root"
test -f "$data_marker"
assert_no_legacy_package

echo "No-sudo Homebrew cask verification passed for ${RELEASE_ARCH}"
