#!/usr/bin/env bash
set -euo pipefail

: "${EXPECTED_VERSION:?EXPECTED_VERSION is required}"
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"
: "${PKG_PATH:?PKG_PATH is required}"
: "${PROVENANCE_PATH:?PROVENANCE_PATH is required}"

version=${EXPECTED_VERSION#v}
uat_user=xcsh-mdm-uat
uat_home="/Users/${uat_user}"
expanded="${RUNNER_TEMP}/xcsh-mdm-expanded-${RELEASE_ARCH}"

pkgutil --check-signature "$PKG_PATH" | grep -F "Developer ID Installer" | grep -F "97ZYL78T5F"
spctl --assess --verbose=4 --type install "$PKG_PATH"
xcrun stapler validate "$PKG_PATH"
pkgutil --expand-full "$PKG_PATH" "$expanded"
bun scripts/macos-release-provenance.ts verify \
  --manifest "$PROVENANCE_PATH" --root "$expanded/Payload" --layout pkg

sudo installer -pkg "$PKG_PATH" -target /
UAT_USER="$uat_user" UAT_HOME="$uat_home" UAT_FULL_NAME="xcsh MDM UAT" \
  bash scripts/ci-macos-uat-user.sh
uat_workspace="$uat_home/workspace"
sudo mkdir -p "$uat_workspace"
sudo chown "$uat_user":staff "$uat_workspace"
sudo chmod 700 "$uat_workspace"
test -d "$uat_workspace"
test "$(stat -f '%Su' "$uat_workspace")" = "$uat_user"
binary=/usr/local/bin/xcsh
native_root="/Library/Application Support/xcsh/natives/${version}"
test -x "$binary"
test -f "$native_root/provenance.json"
bun scripts/macos-release-provenance.ts verify \
  --manifest "$native_root/provenance.json" --root / --layout pkg --installed-system-root

before=$(find "$binary" "$native_root" -type f -exec shasum -a 256 {} + | LC_ALL=C sort)
cd "$uat_workspace"
sudo -H -u "$uat_user" env HOME="$uat_home" PI_DEV=1 "$binary" --version
sudo -H -u "$uat_user" env HOME="$uat_home" "$binary" --help >/dev/null
sudo -H -u "$uat_user" env HOME="$uat_home" PI_DEV=1 "$binary" sandbox check 2>&1 |
  tee "$RUNNER_TEMP/xcsh-mdm-native-load.log"
grep -F "Loaded native addon from ${native_root}/" "$RUNNER_TEMP/xcsh-mdm-native-load.log"
sudo -H -u "$uat_user" env HOME="$uat_home" "$binary" chrome recycle
sudo -H -u "$uat_user" env HOME="$uat_home" "$binary" office recycle
after=$(find "$binary" "$native_root" -type f -exec shasum -a 256 {} + | LC_ALL=C sort)
test "$before" = "$after"
test ! -e "$uat_home/.xcsh/natives/$version"

echo "Direct MDM package verification passed for ${RELEASE_ARCH}"
