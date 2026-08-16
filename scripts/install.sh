#!/bin/sh
set -e

# xcsh Coding Agent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/scripts/install.sh | sh
#
# Options:
#   --source       Install via bun (installs bun if needed)
#   --binary       Always install prebuilt binary
#   --ref <ref>    Install specific tag/commit/branch
#   -r <ref>       Shorthand for --ref

REPO="f5-sales-demo/xcsh"
PACKAGE="@f5-sales-demo/xcsh"
SOURCE_REPO_URL="${XCSH_SOURCE_REPO_URL:-https://github.com/${REPO}.git}"
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
MIN_BUN_VERSION="1.3.7"
BUN_INSTALL_VERSION="1.3.14"

# Parse arguments
MODE=""
REF=""
while [ $# -gt 0 ]; do
  case "$1" in
  --source)
    MODE="source"
    shift
    ;;
  --binary)
    MODE="binary"
    shift
    ;;
  --ref)
    shift
    if [ -z "$1" ]; then
      echo "Missing value for --ref"
      exit 1
    fi
    REF="$1"
    shift
    ;;
  --ref=*)
    REF="${1#*=}"
    if [ -z "$REF" ]; then
      echo "Missing value for --ref"
      exit 1
    fi
    shift
    ;;
  -r)
    shift
    if [ -z "$1" ]; then
      echo "Missing value for -r"
      exit 1
    fi
    REF="$1"
    shift
    ;;
  *)
    echo "Unknown option: $1"
    exit 1
    ;;
  esac
done

# If a ref is provided, default to source install
if [ -n "$REF" ] && [ -z "$MODE" ]; then
  MODE="source"
fi

# Check if bun is available
has_bun() {
  command -v bun >/dev/null 2>&1
}

version_ge() {
  current="$1"
  minimum="$2"

  current_major="${current%%.*}"
  current_rest="${current#*.}"
  current_minor="${current_rest%%.*}"
  current_patch="${current_rest#*.}"
  current_patch="${current_patch%%.*}"

  minimum_major="${minimum%%.*}"
  minimum_rest="${minimum#*.}"
  minimum_minor="${minimum_rest%%.*}"
  minimum_patch="${minimum_rest#*.}"
  minimum_patch="${minimum_patch%%.*}"

  if [ "$current_major" -ne "$minimum_major" ]; then
    [ "$current_major" -gt "$minimum_major" ]
    return $?
  fi

  if [ "$current_minor" -ne "$minimum_minor" ]; then
    [ "$current_minor" -gt "$minimum_minor" ]
    return $?
  fi

  [ "$current_patch" -ge "$minimum_patch" ]
}

require_bun_version() {
  version_raw=$(bun --version 2>/dev/null || true)
  if [ -z "$version_raw" ]; then
    echo "Failed to read bun version"
    exit 1
  fi

  version_clean=${version_raw%%-*}
  if ! version_ge "$version_clean" "$MIN_BUN_VERSION"; then
    echo "Bun ${MIN_BUN_VERSION} or newer is required. Current version: ${version_clean}"
    echo "Upgrade Bun at https://bun.sh/docs/installation"
    exit 1
  fi
}

# Check if git is available
has_git() {
  command -v git >/dev/null 2>&1
}

# Install bun
install_bun() {
  echo "Installing bun ${BUN_INSTALL_VERSION}..."

  for command_name in curl unzip; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      echo "$command_name is required to install Bun"
      exit 1
    fi
  done

  case "$(uname -s)" in
  Linux) bun_platform="linux" ;;
  Darwin) bun_platform="darwin" ;;
  *)
    echo "Unsupported Bun installation platform: $(uname -s)"
    exit 1
    ;;
  esac

  case "$(uname -m)" in
  x86_64 | amd64) bun_arch="x64" ;;
  arm64 | aarch64) bun_arch="aarch64" ;;
  *)
    echo "Unsupported Bun installation architecture: $(uname -m)"
    exit 1
    ;;
  esac

  bun_asset="bun-${bun_platform}-${bun_arch}.zip"
  case "$bun_asset" in
  bun-darwin-aarch64.zip) bun_sha256="d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620" ;;
  bun-darwin-x64.zip) bun_sha256="4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633" ;;
  bun-linux-aarch64.zip) bun_sha256="a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b" ;;
  bun-linux-x64.zip) bun_sha256="951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f" ;;
  *)
    echo "No checksum configured for ${bun_asset}"
    exit 1
    ;;
  esac

  bun_tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$bun_tmp_dir"' EXIT
  bun_archive="$bun_tmp_dir/$bun_asset"
  bun_url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_INSTALL_VERSION}/${bun_asset}"
  curl --proto '=https' --tlsv1.2 -fsSLo "$bun_archive" "$bun_url"

  if command -v sha256sum >/dev/null 2>&1; then
    bun_actual_sha256=$(sha256sum "$bun_archive" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    bun_actual_sha256=$(shasum -a 256 "$bun_archive" | awk '{print $1}')
  else
    echo "sha256sum or shasum is required to verify Bun"
    exit 1
  fi

  if [ "$bun_actual_sha256" != "$bun_sha256" ]; then
    echo "Bun archive checksum verification failed"
    exit 1
  fi

  unzip -q "$bun_archive" -d "$bun_tmp_dir"
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  mkdir -p "$BUN_INSTALL/bin"
  mv "$bun_tmp_dir/bun-${bun_platform}-${bun_arch}/bun" "$BUN_INSTALL/bin/bun"
  chmod 0755 "$BUN_INSTALL/bin/bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  require_bun_version
  rm -rf "$bun_tmp_dir"
  trap - EXIT
}

# Check if git-lfs is available
has_git_lfs() {
  command -v git-lfs >/dev/null 2>&1
}

# Install via bun
install_via_bun() {
  echo "Installing via bun..."
  if [ -n "$REF" ]; then
    if ! has_git; then
      echo "git is required for --ref when installing from source"
      exit 1
    fi

    SOURCE_TMP_DIR="$(mktemp -d)"
    INSTALL_STAGE_DIR=""
    cleanup_source_install() {
      if [ -n "$INSTALL_STAGE_DIR" ] && [ -d "$INSTALL_STAGE_DIR" ]; then
        rm -rf "$INSTALL_STAGE_DIR"
      fi
      if [ -n "$SOURCE_TMP_DIR" ] && [ -d "$SOURCE_TMP_DIR" ]; then
        rm -rf "$SOURCE_TMP_DIR"
      fi
    }
    trap cleanup_source_install EXIT INT TERM

    git -C "$SOURCE_TMP_DIR" init -q
    git -C "$SOURCE_TMP_DIR" remote add origin "$SOURCE_REPO_URL"
    if ! git -C "$SOURCE_TMP_DIR" fetch --depth 1 origin "$REF"; then
      echo "Failed to fetch source ref: $REF"
      exit 1
    fi
    git -C "$SOURCE_TMP_DIR" checkout --detach -q FETCH_HEAD

    # Pull LFS files
    if has_git_lfs; then
      (cd "$SOURCE_TMP_DIR" && git lfs pull)
    fi

    if [ ! -d "$SOURCE_TMP_DIR/packages/coding-agent" ]; then
      echo "Expected package at ${SOURCE_TMP_DIR}/packages/coding-agent"
      exit 1
    fi

    (cd "$SOURCE_TMP_DIR" && bun install --frozen-lockfile) || {
      echo "Failed to install source workspace dependencies"
      exit 1
    }

    case "$(uname -s)" in
    Linux) native_platform="linux" ;;
    Darwin) native_platform="darwin" ;;
    *)
      echo "Unsupported source installation platform: $(uname -s)"
      exit 1
      ;;
    esac
    case "$(uname -m)" in
    x86_64 | amd64)
      native_arch="x64"
      native_addon_names="pi_natives.${native_platform}-${native_arch}-modern.node pi_natives.${native_platform}-${native_arch}-baseline.node"
      ;;
    arm64 | aarch64)
      native_arch="arm64"
      native_addon_names="pi_natives.${native_platform}-${native_arch}.node"
      ;;
    *)
      echo "Unsupported source installation architecture: $(uname -m)"
      exit 1
      ;;
    esac

    mkdir -p "$SOURCE_TMP_DIR/packages/natives/native"
    for native_addon_name in $native_addon_names; do
      native_addon_source=$(find "$SOURCE_TMP_DIR/node_modules/.bun" -type f -name "$native_addon_name" -print -quit)
      if [ -z "$native_addon_source" ]; then
        echo "Installed platform package did not provide ${native_addon_name}"
        exit 1
      fi
      cp "$native_addon_source" "$SOURCE_TMP_DIR/packages/natives/native/$native_addon_name"
    done

    (cd "$SOURCE_TMP_DIR" && bun --cwd=packages/coding-agent run build) || {
      echo "Failed to compile xcsh from source"
      exit 1
    }

    mkdir -p "$INSTALL_DIR"
    INSTALL_STAGE_DIR="$(mktemp -d "$INSTALL_DIR/.xcsh-install.XXXXXX")"
    cp "$SOURCE_TMP_DIR/packages/coding-agent/dist/xcsh" "$INSTALL_STAGE_DIR/xcsh"
    chmod 0755 "$INSTALL_STAGE_DIR/xcsh"
    for native_addon_name in $native_addon_names; do
      cp "$SOURCE_TMP_DIR/packages/natives/native/$native_addon_name" "$INSTALL_STAGE_DIR/$native_addon_name"
      mv -f "$INSTALL_STAGE_DIR/$native_addon_name" "$INSTALL_DIR/$native_addon_name"
    done
    mv -f "$INSTALL_STAGE_DIR/xcsh" "$INSTALL_DIR/xcsh"
    rmdir "$INSTALL_STAGE_DIR"
    INSTALL_STAGE_DIR=""
    rm -rf "$SOURCE_TMP_DIR"
    SOURCE_TMP_DIR=""
    trap - EXIT INT TERM

    echo ""
    echo "✓ Installed xcsh from source to ${INSTALL_DIR}/xcsh"
    echo "✓ Installed platform-native addons to ${INSTALL_DIR}"
    case ":$PATH:" in
    *":$INSTALL_DIR:"*) echo "Run 'xcsh' to get started!" ;;
    *) echo "Add ${INSTALL_DIR} to your PATH, then run 'xcsh'" ;;
    esac
    return
  else
    bun install -g "$PACKAGE" || {
      echo "Failed to install $PACKAGE"
      exit 1
    }
  fi
  echo ""
  echo "✓ Installed xcsh via bun"
  echo "Run 'xcsh' to get started!"
}

# Install binary from GitHub releases
install_binary() {
  # Detect platform
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
  Linux) PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
  esac

  case "$ARCH" in
  x86_64 | amd64) ARCH="x64" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
  esac

  BINARY="xcsh-${PLATFORM}-${ARCH}"
  # Get release tag
  if [ -n "$REF" ]; then
    echo "Fetching release $REF..."
    if RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/tags/${REF}"); then
      LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    else
      echo "Release tag not found: $REF"
      echo "For branch/commit installs, use --source with --ref."
      exit 1
    fi
  else
    echo "Fetching latest release..."
    RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")
    LATEST=$(echo "$RELEASE_JSON" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  fi

  if [ -z "$LATEST" ]; then
    echo "Failed to fetch release tag"
    exit 1
  fi
  echo "Using version: $LATEST"

  mkdir -p "$INSTALL_DIR"
  # Download binary
  BINARY_URL="https://github.com/${REPO}/releases/download/${LATEST}/${BINARY}"
  echo "Downloading ${BINARY}..."
  rm -f "${INSTALL_DIR}/xcsh"
  curl -fsSL "$BINARY_URL" -o "${INSTALL_DIR}/xcsh"
  chmod +x "${INSTALL_DIR}/xcsh"
  downloaded_native=0
  if [ "$ARCH" = "x64" ]; then
    for variant in modern baseline; do
      NATIVE_ADDON="pi_natives.${PLATFORM}-${ARCH}-${variant}.node"
      NATIVE_URL="https://github.com/${REPO}/releases/download/${LATEST}/${NATIVE_ADDON}"
      echo "Downloading ${NATIVE_ADDON}..."
      rm -f "${INSTALL_DIR}/${NATIVE_ADDON}"
      curl -fsSL "$NATIVE_URL" -o "${INSTALL_DIR}/${NATIVE_ADDON}" || {
        echo "Failed to download ${NATIVE_ADDON}"
        exit 1
      }
      downloaded_native=$((downloaded_native + 1))
    done
  else
    NATIVE_ADDON="pi_natives.${PLATFORM}-${ARCH}.node"
    NATIVE_URL="https://github.com/${REPO}/releases/download/${LATEST}/${NATIVE_ADDON}"
    echo "Downloading ${NATIVE_ADDON}..."
    rm -f "${INSTALL_DIR}/${NATIVE_ADDON}"
    curl -fsSL "$NATIVE_URL" -o "${INSTALL_DIR}/${NATIVE_ADDON}"
    downloaded_native=1
  fi
  echo ""
  echo "✓ Installed xcsh to ${INSTALL_DIR}/xcsh"
  echo "✓ Installed ${downloaded_native} native addon file(s) to ${INSTALL_DIR}"

  # Check if in PATH
  case ":$PATH:" in
  *":$INSTALL_DIR:"*) echo "Run 'xcsh' to get started!" ;;
  *) echo "Add ${INSTALL_DIR} to your PATH, then run 'xcsh'" ;;
  esac
}

# Main logic
case "$MODE" in
source)
  if ! has_bun; then
    install_bun
  fi
  require_bun_version
  install_via_bun
  ;;
binary)
  install_binary
  ;;
*)
  # Default: use bun if available, otherwise binary
  if has_bun; then
    require_bun_version
    install_via_bun
  else
    install_binary
  fi
  ;;
esac

# #1874 Task 7: if this was a re-install/upgrade, proactively recycle so the new
# version reaches the Chrome extension now (refresh the native-host wrapper +
# step down a running old manager; the successor re-adopts live workers). Fully
# best-effort — must never fail the install. Resolve xcsh from PATH or the
# install dir; skip silently if not found (passive supersede covers it).
XCSH_BIN="$(command -v xcsh 2>/dev/null || true)"
[ -z "$XCSH_BIN" ] && [ -x "$INSTALL_DIR/xcsh" ] && XCSH_BIN="$INSTALL_DIR/xcsh"
if [ -n "$XCSH_BIN" ]; then
  "$XCSH_BIN" chrome recycle >/dev/null 2>&1 || true
  # Also stop a running "office serve" squatting :8444 on the replaced binary, so
  # the next `xcsh office serve` starts clean instead of "port 8444 in use".
  "$XCSH_BIN" office recycle >/dev/null 2>&1 || true
fi
