#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" != 0 ]]
for command in bash curl git jq rg gh glab aws az gcloud sf terraform ssh scp bun node python3 chromium; do
  command -v "$command" >/dev/null || { echo "Missing executable: $command" >&2; exit 1; }
done
aws --version | rg '^aws-cli/2\.' >/dev/null
az extension show --name resource-graph --output none
python3 -c 'import sys; assert sys.version_info >= (3, 11)'
"$HOME/.xcsh/python-env/bin/python" -c 'import ipykernel, kernel_gateway'
chromium --headless --no-sandbox --disable-dev-shm-usage --dump-dom 'data:text/html,<title>CONTAINER_BROWSER_OK</title>' 2>/dev/null | rg 'CONTAINER_BROWSER_OK' >/dev/null
jq -e '.version == 2 and (.plugins | length == 23)' "$HOME/.xcsh/plugins/installed_plugins.json" >/dev/null
jq -r '.plugins[][] | .installPath' "$HOME/.xcsh/plugins/installed_plugins.json" | while IFS= read -r path; do test -d "$path"; done
xcsh plugin list --json > /tmp/container-plugin-list.json
jq -e '([.marketplace[]?.id] | length) == 23' /tmp/container-plugin-list.json >/dev/null
xcsh --version
printf '%s\n' 'PASS: container runtime, native browser, Python dependencies, and 23 cached plugins'
