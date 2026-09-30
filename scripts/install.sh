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
MIN_BUN_VERSION="1.4.2"
BUN_INSTALL_VERSION="1.4.2"

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
  bun-darwin-aarch64.zip) bun_sha256="90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f" ;;
  bun-darwin-x64.zip) bun_sha256="80520d7e17526308c9185d261679ac6d27798d3803a0e9f7ff9121ab8affb012" ;;
  bun-linux-aarch64.zip) bun_sha256="54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7" ;;
  bun-linux-x64.zip) bun_sha256="36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913" ;;
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
  for required_command in curl jq; do
    command -v "$required_command" >/dev/null 2>&1 || {
      echo "$required_command is required to verify a binary release" >&2
      exit 1
    }
  done
  file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$1" | awk '{print $1}'
    else
      shasum -a 256 "$1" | awk '{print $1}'
    fi
  }
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || {
    echo "sha256sum or shasum is required to verify release artifacts" >&2
    exit 1
  }
  mkdir -p "$INSTALL_DIR"
  CANONICAL_INSTALL_DIR=$(cd -P "$INSTALL_DIR" && pwd -P)
  INSTALL_STAGE_DIR="$(mktemp -d "$INSTALL_DIR/.xcsh-install.XXXXXX")"
  chmod 0700 "$INSTALL_STAGE_DIR"
  PROMOTION_STARTED=""
  PROMOTION_COMPLETE=""
  cleanup_binary_install() {
    cleanup_status=$?
    if [ -n "$PROMOTION_STARTED" ] && [ -z "$PROMOTION_COMPLETE" ]; then
      while IFS= read -r installed_file; do
        if [ -e "$INSTALL_STAGE_DIR/backup/$installed_file" ] || [ -L "$INSTALL_STAGE_DIR/backup/$installed_file" ]; then
          mv -f "$INSTALL_STAGE_DIR/backup/$installed_file" "$INSTALL_DIR/$installed_file" || {
            echo "Rollback failed; recovery files retained at $INSTALL_STAGE_DIR/backup" >&2
            exit 1
          }
        else
          rm -f "$INSTALL_DIR/$installed_file"
        fi
      done <"$INSTALL_STAGE_DIR/promoted"
      while IFS= read -r legacy_file; do
        mv -f "$INSTALL_STAGE_DIR/backup/$legacy_file" "$INSTALL_DIR/$legacy_file" || {
          echo "Native rollback failed; recovery files retained at $INSTALL_STAGE_DIR/backup" >&2
          exit 1
        }
      done <"$INSTALL_STAGE_DIR/legacy"
    fi
    rm -rf "$INSTALL_STAGE_DIR"
    trap - EXIT INT TERM
    exit "$cleanup_status"
  }
  trap cleanup_binary_install EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [ -n "$REF" ]; then
    case "$REF" in v[0-9]*.[0-9]*.[0-9]*) ;; *)
      echo "A published version tag is required for --binary" >&2
      exit 1
      ;;
    esac
    RELEASE_URL="https://api.github.com/repos/${REPO}/releases/tags/${REF}"
  else
    RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
  fi
  github_api_download() {
    api_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    case "$api_token" in *[!A-Za-z0-9_]*)
      echo "Invalid GitHub API token format" >&2
      return 1
      ;;
    esac
    if [ -n "$api_token" ]; then
      # Send only API credentials via stdin configuration, never argv or public asset URLs.
      printf 'header = "Authorization: Bearer %s"\n' "$api_token" |
        curl --config - --proto '=https' --tlsv1.2 -fsS "$1" -o "$2"
    else
      curl --proto '=https' --tlsv1.2 -fsS "$1" -o "$2"
    fi
  }
  github_api_download "$RELEASE_URL" "$INSTALL_STAGE_DIR/release.json"
  LATEST=$(jq -er 'select(.draft == false and .prerelease == false and .immutable == true) | .tag_name | select(test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))' "$INSTALL_STAGE_DIR/release.json")
  [ -z "$REF" ] || [ "$LATEST" = "$REF" ] || {
    echo "Release tag identity mismatch" >&2
    exit 1
  }
  expected_version="${LATEST#v}"
  echo "Using version: $LATEST"
  BINARY_URL="https://github.com/${REPO}/releases/download/${LATEST}"
  download_verified_asset() {
    asset_name="$1"
    expected_digest=$(jq -er --arg name "$asset_name" '[.assets[] | select(.name == $name)] | select(length == 1) | .[0].digest | select(test("^sha256:[a-f0-9]{64}$")) | ltrimstr("sha256:")' "$INSTALL_STAGE_DIR/release.json")
    curl -fsSL "$BINARY_URL/$asset_name" -o "$INSTALL_STAGE_DIR/$asset_name"
    [ "$(file_sha256 "$INSTALL_STAGE_DIR/$asset_name")" = "$expected_digest" ] || {
      echo "Release API checksum mismatch for $asset_name" >&2
      exit 1
    }
  }
  download_verified_asset "$BINARY"
  if [ "$PLATFORM" = linux ]; then
    PROVENANCE="$BINARY.provenance.json"
    for artifact_name in "$BINARY.sha256" "$PROVENANCE" "$PROVENANCE.sha256"; do
      download_verified_asset "$artifact_name"
    done
    verify_checksum_sidecar() {
      checksum_name="$1"
      checksum_actual=$(file_sha256 "$INSTALL_STAGE_DIR/$checksum_name")
      checksum_expected="$checksum_actual  $checksum_name"
      [ "$(cat "$INSTALL_STAGE_DIR/$checksum_name.sha256")" = "$checksum_expected" ] || {
        echo "Published checksum sidecar mismatch for $checksum_name" >&2
        exit 1
      }
    }
    verify_checksum_sidecar "$BINARY"
    verify_checksum_sidecar "$PROVENANCE"
    github_api_download "https://api.github.com/repos/${REPO}/git/ref/tags/${LATEST}" "$INSTALL_STAGE_DIR/tag.json"
    tag_depth=0
    while [ "$(jq -er .object.type "$INSTALL_STAGE_DIR/tag.json")" = tag ]; do
      tag_sha=$(jq -er '.object.sha | select(test("^[a-f0-9]{40}$"))' "$INSTALL_STAGE_DIR/tag.json")
      tag_depth=$((tag_depth + 1))
      [ "$tag_depth" -le 5 ] || {
        echo "Release tag indirection exceeds limit" >&2
        exit 1
      }
      github_api_download "https://api.github.com/repos/${REPO}/git/tags/${tag_sha}" "$INSTALL_STAGE_DIR/tag.json"
    done
    release_commit=$(jq -er 'select(.object.type == "commit") | .object.sha | select(test("^[a-f0-9]{40}$"))' "$INSTALL_STAGE_DIR/tag.json")
    binary_digest=$(file_sha256 "$INSTALL_STAGE_DIR/$BINARY")
    binary_size=$(wc -c <"$INSTALL_STAGE_DIR/$BINARY" | tr -d ' ')
    jq -e --arg version "$expected_version" --arg arch "$ARCH" --arg name "$BINARY" \
      --arg digest "$binary_digest" --arg commit "$release_commit" --argjson size "$binary_size" \
      --slurpfile release "$INSTALL_STAGE_DIR/release.json" '
      .schemaVersion == 1 and .version == $version and .platform == "linux" and .arch == $arch
      and .source.repository == "f5-sales-demo/xcsh" and .source.commit == $commit
      and .source.workflow == "ci.yml" and (.source.runId | test("^[0-9]+$"))
      and (.source.runAttempt | test("^[0-9]+$")) and .source.buildPlatform == "linux-x64"
      and .binary.name == $name and .binary.sha256 == $digest and .binary.size == $size
      and .natives.mode == "embedded"
      and ([.natives.files[].name] | sort) == (if $arch == "x64" then
        ["pi_natives.linux-x64-baseline.node", "pi_natives.linux-x64-modern.node"]
        else ["pi_natives.linux-arm64.node"] end)
      and all(.natives.files[]; (.sha256 | test("^[a-f0-9]{64}$")) and (.size | type == "number") and .size > 0
        and (. as $native | [$release[0].assets[] | select(.name == $native.name)]
          | length == 1 and .[0].digest == ("sha256:" + $native.sha256) and .[0].size == $native.size))
    ' "$INSTALL_STAGE_DIR/$PROVENANCE" >/dev/null || {
      echo "Linux provenance does not match release artifacts" >&2
      exit 1
    }
  fi

  mv "$INSTALL_STAGE_DIR/$BINARY" "$INSTALL_STAGE_DIR/xcsh"
  chmod 0755 "$INSTALL_STAGE_DIR/xcsh"
  installed_version=$("${INSTALL_STAGE_DIR}/xcsh" --version 2>/dev/null || true)
  [ "$installed_version" = "xcsh/${expected_version}" ] || {
    echo "Downloaded xcsh version mismatch" >&2
    exit 1
  }
  jq -n --arg version "$expected_version" --arg executable "${CANONICAL_INSTALL_DIR}/xcsh" \
    --arg platform "$PLATFORM" --arg arch "$ARCH" \
    '{schemaVersion:2,channel:"standalone",version:$version,executablePath:$executable,platform:$platform,arch:$arch}' >"$INSTALL_STAGE_DIR/xcsh-install.json"
  mkdir "$INSTALL_STAGE_DIR/backup"
  : >"$INSTALL_STAGE_DIR/promoted"
  : >"$INSTALL_STAGE_DIR/legacy"
  install_files="xcsh-install.json"
  [ "$PLATFORM" != linux ] || install_files="$install_files $BINARY.sha256 $PROVENANCE $PROVENANCE.sha256"
  # The compiled executable carries all selected addons. Stage and validate the
  # entire payload before changing any file belonging to the previous install.
  for installed_file in $install_files xcsh; do
    if [ -e "$INSTALL_DIR/$installed_file" ] || [ -L "$INSTALL_DIR/$installed_file" ]; then
      cp -Pp "$INSTALL_DIR/$installed_file" "$INSTALL_STAGE_DIR/backup/$installed_file"
    fi
  done
  for legacy_native in "$INSTALL_DIR"/pi_natives.*.node; do
    [ -f "$legacy_native" ] || continue
    cp -Pp "$legacy_native" "$INSTALL_STAGE_DIR/backup/${legacy_native##*/}"
  done
  PROMOTION_STARTED=1
  for installed_file in $install_files; do
    printf '%s\n' "$installed_file" >>"$INSTALL_STAGE_DIR/promoted"
    mv -f "$INSTALL_STAGE_DIR/$installed_file" "$INSTALL_DIR/$installed_file"
  done
  for legacy_native in "$INSTALL_DIR"/pi_natives.*.node; do
    [ -f "$legacy_native" ] || continue
    printf '%s\n' "${legacy_native##*/}" >>"$INSTALL_STAGE_DIR/legacy"
    rm "$legacy_native"
  done
  printf '%s\n' xcsh >>"$INSTALL_STAGE_DIR/promoted"
  mv -f "$INSTALL_STAGE_DIR/xcsh" "$INSTALL_DIR/xcsh"
  PROMOTION_COMPLETE=1
  rm -rf "$INSTALL_STAGE_DIR" || true
  INSTALL_STAGE_DIR=""
  trap - EXIT INT TERM
  echo ""
  echo "✓ Installed xcsh to ${INSTALL_DIR}/xcsh"
  echo "✓ Installed standalone receipt to ${INSTALL_DIR}/xcsh-install.json"

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
  # Official installs must use the compiled release. Source installs remain
  # available only through the explicit --source development route.
  install_binary
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
