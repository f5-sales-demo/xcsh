#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT_DIR="$(pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

SOURCE_REPO="$WORK_DIR/source-repo"
SOURCE_INSTALL_DIR="$WORK_DIR/source-bin"
SMOKE_HOME="$WORK_DIR/home"
git clone --local --no-hardlinks "$ROOT_DIR" "$SOURCE_REPO" >/dev/null
git -C "$SOURCE_REPO" config user.name "xcsh installer test"
git -C "$SOURCE_REPO" config user.email "xcsh-installer-test@example.com"
git -C "$SOURCE_REPO" commit --allow-empty -m "test: local source installer fixture" >/dev/null
SOURCE_REF="$(git -C "$SOURCE_REPO" rev-parse HEAD)"

PI_INSTALL_DIR="$SOURCE_INSTALL_DIR" \
  XCSH_SOURCE_REPO_URL="$SOURCE_REPO" \
  bash "$ROOT_DIR/scripts/install.sh" --source --ref "$SOURCE_REF"

rm -rf "$SOURCE_REPO"
mkdir -p "$SMOKE_HOME"

HOME="$SMOKE_HOME" PI_CODING_AGENT_DIR="$SMOKE_HOME/agent" "$SOURCE_INSTALL_DIR/xcsh" --version
HOME="$SMOKE_HOME" PI_CODING_AGENT_DIR="$SMOKE_HOME/agent" "$SOURCE_INSTALL_DIR/xcsh" --help >/dev/null
HOME="$SMOKE_HOME" PI_CODING_AGENT_DIR="$SMOKE_HOME/agent" XCSH_SMOKE_TEST_SPECS=1 \
  "$SOURCE_INSTALL_DIR/xcsh" >/dev/null

if find "$SOURCE_INSTALL_DIR" -type l -print -quit | grep -q .; then
  echo "Source install must not contain symlinks into the temporary clone"
  exit 1
fi

case "$(uname -m)" in
x86_64 | amd64) expected_files=3 ;;
arm64 | aarch64) expected_files=2 ;;
*)
  echo "Unsupported source installer test architecture: $(uname -m)"
  exit 1
  ;;
esac
installed_files=$(find "$SOURCE_INSTALL_DIR" -maxdepth 1 -type f | wc -l)
if [ "$installed_files" -ne "$expected_files" ]; then
  echo "Expected ${expected_files} installed files, found ${installed_files}"
  find "$SOURCE_INSTALL_DIR" -maxdepth 1 -type f -print
  exit 1
fi

echo "Source-ref installer regression passed at ${SOURCE_REF}"
