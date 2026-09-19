#!/usr/bin/env bash
set -euo pipefail

: "${BASELINE_VERSION:?BASELINE_VERSION is required}"
: "${BASELINE_SHA256:?BASELINE_SHA256 is required}"
: "${RELEASE_ARCH:?RELEASE_ARCH is required}"

baseline_tap="xcsh-uat/baseline"
target_tap="f5-sales-demo/tap"

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
