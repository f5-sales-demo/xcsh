#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ] && [ "$#" -ne 4 ]; then
  echo 'usage: ci-verify-homebrew-dmg.sh DMG ARCH MOUNT_DIRECTORY [STATIC_COPY_DIRECTORY]' >&2
  exit 2
fi
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
dmg=$1
arch=$2
mount=$3
case "$arch" in arm64 | x64) ;; *) exit 2 ;; esac
test -f "$dmg"
test ! -e "$mount"
codesign --verify --strict --verbose=2 "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --verbose=4 --type open --context context:primary-signature "$dmg"
mkdir "$mount"
attached=false
cleanup() {
  status=$?
  if [ "$attached" = true ]; then hdiutil detach "$mount"; fi
  exit "$status"
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg"
attached=true
test -d "$mount/xcsh.app"
codesign --verify --deep --strict --verbose=2 "$mount/xcsh.app"
xcrun stapler validate "$mount/xcsh.app"
spctl --assess --verbose=4 --type execute "$mount/xcsh.app"
/usr/bin/python3 "$script_dir/verify_macos_app_payload.py" --root "$mount" --arch "$arch"
if [ "$#" -eq 4 ]; then
  destination=$4
  test -d "$destination"
  test -z "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit)"
  ditto "$mount/xcsh.app" "$destination/xcsh.app"
  ditto "$mount/provenance" "$destination/provenance"
fi
