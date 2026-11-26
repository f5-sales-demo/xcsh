"""Installed executable acceptance: common."""

from __future__ import annotations

import hashlib
import json
import pathlib
from typing import Any, NoReturn


class AcceptanceError(Exception):
    """Observed evidence failed a required acceptance condition."""


Json = dict[str, Any]
MAX_API_ATTEMPTS = 2
MIN_TIMEOUT_MS = 29_000
MAX_TIMEOUT_MS = 35_000
ERASE_WHOLE_LINE = 2
PRINTABLE_CHARACTER = 32


def fail(message: str, *, cause: BaseException | None = None) -> NoReturn:
    """Reject evidence with a stable reason while preserving a private cause."""
    raise AcceptanceError(message) from cause


API_PATH = "/api/config/namespaces/{namespace}/http_loadbalancers"
SHELL_COMMAND = (
    "printf 'NS=%s LOGIN=%s REGION=%s STALE=%s TIMEOUT=%s\\n' "
    '"${XCSH_NAMESPACE-unset}" "${XCSH_USERNAME-unset}" "${XCSH_REGION-unset}" '
    '"${XCSH_STALE-unset}" "${XCSH_PLUGIN_GIT_TIMEOUT_MS-unset}"'
)

PROMPT = (
    "Inspect the current context using xcsh_context with action=status. Keep the current selection; do not activate another context. "
    "Run exactly this command with the bash tool, without changing it:\n```bash\n"
    + SHELL_COMMAND
    + "\n```\n"
    "Finish those two tools before the API call. Use xcsh_api to list the fixture's HTTP load balancers through "
    + API_PATH
    + ", leaving namespace substitution to the current context and disabling discovery expansion. "
    "Return only one JSON object with namespace, apiStatus (HTTP status, 0 for transport failure, null for local rejection), "
    "outcome (success, empty or error), and resourceNames (observed names, or an empty array on empty/error). Do not retry tools manually."
)

SCENARIOS = [
    "explicit",
    "automatic-startup",
    "guided",
    "guided-manual",
    "cancelled",
    "repeated",
    "transition",
    "cached-shell",
    "override",
    "environment",
    "environment-name-guard",
    "environment-missing-token",
    "no-context",
    "nonexistent",
    "missing-token",
    "auth-error",
    "offline",
    "http-401",
    "http-403",
    "http-404",
    "http-429",
    "http-503",
    "timeout",
    "refused",
    "empty",
    "admitted-namespace",
    "admitted-context",
    "plugin-success",
    "plugin-failure",
    "search-match",
    "search-no-match",
    "search-invalid",
    "provider-failure",
    "provider-malformed",
    "provider-missing-tool",
]
NEGATIVE_SCENARIOS = set(SCENARIOS[-3:])


def text_content(message: Json) -> str:
    """Extract only textual content from an agent message."""
    content = message.get("content", [])
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content if c.get("type") == "text")


def digest(path: pathlib.Path) -> str:
    """Hash a file incrementally without retaining its bytes in memory."""
    h = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path: pathlib.Path, value: Any) -> None:
    """Write a private or allowlisted receipt with a complete final newline."""
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n")


def require(condition: object, reason: str) -> None:
    """Reject an unproven acceptance condition."""
    if not condition:
        fail(reason)
