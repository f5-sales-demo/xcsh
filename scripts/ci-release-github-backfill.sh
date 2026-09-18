#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 OWNER/REPO vX.Y.Z ASSETS_DIR" >&2
  exit 2
fi

repository=$1
tag=$2
assets_dir=$3
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 2
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
test -d "$assets_dir"

file_size() {
  if stat -f %z "$1" >/dev/null 2>&1; then
    stat -f %z "$1"
  else
    stat -c %s "$1"
  fi
}

file_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}

expected_assets=(
  pi_natives.darwin-arm64.node
  pi_natives.darwin-x64-baseline.node
  pi_natives.darwin-x64-modern.node
  pi_natives.linux-arm64.node
  pi_natives.linux-x64-baseline.node
  pi_natives.linux-x64-modern.node
  pi_natives.win32-x64-baseline.node
  pi_natives.win32-x64-modern.node
  xcsh-darwin-arm64
  xcsh-darwin-arm64.pkg
  xcsh-darwin-arm64.provenance.json
  xcsh-darwin-arm64.zip
  xcsh-darwin-x64
  xcsh-darwin-x64.pkg
  xcsh-darwin-x64.provenance.json
  xcsh-darwin-x64.zip
  xcsh-linux-arm64
  xcsh-linux-x64
  xcsh-windows-x64.exe
)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' "${expected_assets[@]}" | LC_ALL=C sort >"$work/expected-names"
find "$assets_dir" -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort >"$work/local-names"
diff -u "$work/expected-names" "$work/local-names"

gh api "repos/${repository}/immutable-releases" | jq -e '.enabled == true' >/dev/null
# Draft releases are intentionally unavailable from the tag endpoint. Use a
# cache-busted listing for resume discovery, then retain the create response
# directly rather than re-listing and risking a stale CDN response.
release_list_url="repos/${repository}/releases?per_page=100&cache_bust=$(date +%s)"
releases=$(gh api "$release_list_url")
release=$(jq -c --arg tag "$tag" '[.[] | select(.tag_name == $tag)] | if length == 0 then null elif length == 1 then .[0] else error("duplicate release tag") end' <<<"$releases")
if [ "$release" = "null" ]; then
  release=$(gh api --method POST "repos/${repository}/releases" \
    -f tag_name="$tag" \
    -F draft=true \
    -F prerelease=false \
    -F generate_release_notes=true)
fi
jq -e --arg tag "$tag" '.tag_name == $tag and .draft == true and .prerelease == false and .immutable == false' <<<"$release" >/dev/null
release_id=$(jq -r '.id' <<<"$release")

for name in "${expected_assets[@]}"; do
  asset="$assets_dir/$name"
  size=$(file_size "$asset")
  digest="sha256:$(file_sha256 "$asset")"
  existing=$(jq -c --arg name "$name" '[.assets[] | select(.name == $name)] | if length == 0 then null elif length == 1 then .[0] else error("duplicate asset name") end' <<<"$release")
  if [ "$existing" != "null" ] && jq -e --argjson size "$size" --arg digest "$digest" '.state == "uploaded" and .size == $size and .digest == $digest' <<<"$existing" >/dev/null; then
    echo "Already verified: $name"
    continue
  fi

  delay=20
  uploaded=0
  for attempt in 1 2 3 4 5; do
    if gh release upload "$tag" "$asset" --repo "$repository" --clobber; then
      uploaded=1
      break
    fi
    if [ "$attempt" -lt 5 ]; then
      echo "Upload attempt ${attempt}/5 failed for ${name}; retrying in ${delay}s"
      sleep "$delay"
      delay=$((delay * 2))
    fi
  done
  if [ "$uploaded" -ne 1 ]; then
    echo "Failed to upload $name after 5 attempts" >&2
    exit 1
  fi
done

release=$(gh api "repos/${repository}/releases/${release_id}")
jq -r '.assets[] | [.name, (.size | tostring), (.digest // "")] | @tsv' <<<"$release" | LC_ALL=C sort >"$work/actual-assets"
: >"$work/expected-assets"
for name in "${expected_assets[@]}"; do
  asset="$assets_dir/$name"
  size=$(file_size "$asset")
  digest="sha256:$(file_sha256 "$asset")"
  printf '%s\t%s\t%s\n' "$name" "$size" "$digest" >>"$work/expected-assets"
done
LC_ALL=C sort -o "$work/expected-assets" "$work/expected-assets"
diff -u "$work/expected-assets" "$work/actual-assets"

gh release edit "$tag" --repo "$repository" --draft=false
gh api "repos/${repository}/releases/${release_id}" |
  jq -e --arg tag "$tag" '.tag_name == $tag and .draft == false and .prerelease == false and .immutable == true and (.assets | length) == 19' \
    >/dev/null
