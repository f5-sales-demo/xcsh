#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"
: "${KEYCHAIN_PATH:?KEYCHAIN_PATH is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
case "$RELEASE_ARCH" in arm64 | x64) ;; *) exit 2 ;; esac
if [ "${GITHUB_REF_TYPE:-}" = tag ]; then
  version="${GITHUB_REF_NAME#v}"
else
  version=$(bun -p 'require("./packages/coding-agent/package.json").version')
fi
if [ "$(bun -e 'import {usesStapledHomebrew} from "./scripts/ci-release-homebrew.ts"; console.log(usesStapledHomebrew(process.argv[1]));' "$version")" != true ]; then
  exit 0
fi
binaries=packages/coding-agent/binaries
root="$RUNNER_TEMP/xcsh-homebrew-app-$RELEASE_ARCH"
app="$root/xcsh.app"
dmg="$binaries/xcsh-darwin-$RELEASE_ARCH.dmg"
identity=$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/')
test -n "$identity"
notarize() {
  local artifact=$1 attempt result status
  for attempt in 1 2 3; do
    status=0
    result=$(xcrun notarytool submit "$artifact" --keychain-profile xcsh-ci-notary --keychain "$KEYCHAIN_PATH" --wait) || status=$?
    printf '%s\n' "$result"
    if [ "$status" -eq 0 ] && grep -q 'status: Accepted' <<<"$result"; then
      return 0
    fi
    [ "$attempt" -eq 3 ] || sleep $((attempt * 30))
  done
  echo "Notarization was not accepted" >&2
  return 1
}
bun scripts/ci-release-macos-app.ts stage --arch "$RELEASE_ARCH" --version "$version" --binaries-dir "$binaries" --root "$root"
codesign --force --options runtime --entitlements scripts/entitlements.plist --sign "$identity" --timestamp "$app"
codesign --verify --deep --strict --verbose=2 "$app"
app_submission="$RUNNER_TEMP/xcsh-homebrew-app-$RELEASE_ARCH.notary.zip"
ditto -c -k --keepParent "$app" "$app_submission"
notarize "$app_submission"
bash .controller/scripts/ci-staple-macos-pkg.sh "$app"
spctl --assess --verbose=4 --type execute "$app"
bun scripts/ci-release-macos-app.ts manifest --arch "$RELEASE_ARCH" --version "$version" --binaries-dir "$binaries" --root "$root"
hdiutil create -fs HFS+ -format UDZO -volname "xcsh $version" -srcfolder "$root" "$dmg"
codesign --sign "$identity" --timestamp "$dmg"
notarize "$dmg"
bash .controller/scripts/ci-staple-macos-pkg.sh "$dmg"
spctl --assess --verbose=4 --type open --context context:primary-signature "$dmg"
