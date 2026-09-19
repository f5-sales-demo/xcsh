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
if id "$uat_user" >/dev/null 2>&1; then
  echo "::error::MDM UAT account already exists"
  exit 1
fi
# Hosted macOS can create the account record while sysadminctl exits nonzero
# after reporting that its requested home was merely assigned. Capture this
# command explicitly outside errexit, then accept a partial status only after
# proving that the new account exists.
set +e
sudo sysadminctl -addUser "$uat_user" -fullName "xcsh MDM UAT" -home "$uat_home" -password "$(uuidgen)"
sysadminctl_status=$?
set -e
if [[ "$sysadminctl_status" -ne 0 ]]; then
  if ! id "$uat_user" >/dev/null 2>&1; then
    echo "::error::sysadminctl failed to create the MDM UAT account"
    exit 1
  fi
fi
# sysadminctl records the requested home path but does not materialize it on
# hosted macOS. The clean standard account must own a real home before xcsh
# creates its ordinary logs/configuration there.
sudo mkdir -p "$uat_home"
sudo chown "$uat_user":staff "$uat_home"
sudo chmod 700 "$uat_home"
test -d "$uat_home"
test "$(stat -f '%Su' "$uat_home")" = "$uat_user"
uat_workspace="$uat_home/workspace"
sudo mkdir -p "$uat_workspace"
sudo chown "$uat_user":staff "$uat_workspace"
sudo chmod 700 "$uat_workspace"
test -d "$uat_workspace"
test "$(stat -f '%Su' "$uat_workspace")" = "$uat_user"
if id -Gn "$uat_user" | tr ' ' '\n' | grep -qx admin; then
  echo "::error::MDM UAT account is an administrator"
  exit 1
fi

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
