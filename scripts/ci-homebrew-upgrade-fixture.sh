#!/usr/bin/env bash
set -euo pipefail

: "${BASELINE_VERSION:?BASELINE_VERSION is required}"
: "${BASELINE_SHA256:?BASELINE_SHA256 is required}"
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"

baseline_tap="xcsh-uat/baseline"
target_tap="f5-sales-demo/tap"
minimum_available_kib=2097152
available_kib=$(df -Pk "${TMPDIR:-/tmp}" | awk 'NR == 2 { print $4 }')
echo "Homebrew UAT disk capacity: ${available_kib} KiB available; ${minimum_available_kib} KiB required"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || ((available_kib < minimum_available_kib)); then
  echo "Insufficient disk capacity for Homebrew upgrade UAT" >&2
  exit 1
fi

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if ((status != 0)); then
    brew uninstall --cask --force "${target_tap}/xcsh" >/dev/null 2>&1 || true
    brew uninstall --cask --force "${baseline_tap}/xcsh" >/dev/null 2>&1 || true
  fi
  brew untap "$baseline_tap" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

brew untap "$baseline_tap" >/dev/null 2>&1 || true
brew tap-new --no-git "$baseline_tap"
baseline_tap_dir=$(brew --repository "$baseline_tap")
baseline_cask="${baseline_tap_dir}/Casks/xcsh.rb"
mkdir -p "${baseline_tap_dir}/Casks"
cat >"$baseline_cask" <<RUBY
cask "xcsh" do
  version "${BASELINE_VERSION}"
  sha256 "${BASELINE_SHA256}"
  url "https://github.com/f5-sales-demo/xcsh/releases/download/v#{version}/xcsh-darwin-${RELEASE_ARCH}.zip"
  name "xcsh"
  homepage "https://github.com/f5-sales-demo/xcsh"
  binary "bin/xcsh"
end
RUBY
test -f "$baseline_cask"

brew trust --cask "${baseline_tap}/xcsh"
brew install --cask "${baseline_tap}/xcsh"
"$(brew --prefix)/bin/xcsh" --version | grep -F "$BASELINE_VERSION"
brew tap "$target_tap"
brew upgrade --cask "${target_tap}/xcsh"
