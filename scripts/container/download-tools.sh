#!/usr/bin/env bash
set -euo pipefail
# Every downloaded executable/archive is pinned by version and SHA256.
case "$TARGETARCH" in
amd64)
  node_arch=x64
  aws_arch=x86_64
  node_sha=cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008
  aws_sha=b11ed416d91f4251da363a17706938eeaf0e520745754c104c0c1890dd8363c7
  glab_sha=9c9ac4c2b74ec8709dec4819a4041050f3680c6aaa18f0ed30434081f4fe9bef
  terraform_sha=38034b38d03096399a7a1264a14561a8029b2b496fd1f169452656e53968f1b7
  ;;
arm64)
  node_arch=arm64
  aws_arch=aarch64
  node_sha=fef00bb4d36e1c50104a9775a10359beee98f162b4104dd12472c75065c6a143
  aws_sha=91360c0adb2ae508334ff657dce4787b598b443a11cf3dc58e08b74f12e16009
  glab_sha=1f2d0a885b28d08de341a597b2eb7204ce03d4e67b008efecab9951e4b014f0c
  terraform_sha=a750b5a11038f165846b2658c40c88cd7070aa67a61bab431a14ba27928ea9ea
  ;;
*)
  echo 'Unsupported native architecture' >&2
  exit 1
  ;;
esac
mkdir -p /opt/xcsh /opt/node /tmp/xcsh-tools
cd /tmp/xcsh-tools
fetch() {
  curl --fail --silent --show-error --location "$1" --output "$2"
  printf '%s  %s\n' "$3" "$2" | sha256sum -c -
}
fetch "https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-${node_arch}.tar.xz" node.tar.xz "$node_sha"
tar -xJf node.tar.xz --strip-components=1 -C /opt/node
fetch "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}-2.38.1.zip" aws.zip "$aws_sha"
unzip -q aws.zip
./aws/install --install-dir /opt/aws-cli --bin-dir /usr/local/bin
fetch "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/1%2E123%2E0/glab_1%2E123%2E0_linux_${TARGETARCH}%2Etar%2Egz" glab.tar.gz "$glab_sha"
tar -xzf glab.tar.gz
install -m 0755 bin/glab /usr/local/bin/glab
fetch "https://releases.hashicorp.com/terraform/1.16.6/terraform_1.16.6_linux_${TARGETARCH}.zip" terraform.zip "$terraform_sha"
unzip -q terraform.zip
install -m 0755 terraform /usr/local/bin/terraform
fetch https://azcliprod.blob.core.windows.net/cli-extensions/resource_graph-2.1.1-py2.py3-none-any.whl resource_graph-2.1.1-py2.py3-none-any.whl 436b2e865d7f3fb6beea2cdc017c74dd48a66991209a5ab8dc092443ec93140f
mv resource_graph-2.1.1-py2.py3-none-any.whl /opt/xcsh/
jq -n --arg node "$node_sha" --arg aws "$aws_sha" --arg glab "$glab_sha" --arg terraform "$terraform_sha" \
  '{node: $node, aws: $aws, glab: $glab, terraform: $terraform, azureResourceGraph: "436b2e865d7f3fb6beea2cdc017c74dd48a66991209a5ab8dc092443ec93140f"}' >/opt/xcsh/download-checksums.json
cd /
rm -rf /tmp/xcsh-tools
