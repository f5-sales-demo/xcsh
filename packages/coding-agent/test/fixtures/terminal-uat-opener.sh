#!/bin/sh
# Record literal arguments only; never delegate to a desktop application.
set -eu
: "${XCSH_UAT_OPEN_LOG:?Missing disposable launcher log}"
umask 077
printf '%s\0' "$@" >>"$XCSH_UAT_OPEN_LOG"
if [ -n "${XCSH_UAT_OPEN_FAIL_FILE:-}" ] && [ -e "$XCSH_UAT_OPEN_FAIL_FILE" ]; then
  printf '%s\n' 'Synthetic launcher failure' >&2
  exit 73
fi
