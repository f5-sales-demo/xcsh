"""Installed executable acceptance: credentials."""

from __future__ import annotations

import base64
import contextlib
import json
import sqlite3
import subprocess
import time
from functools import partial
from typing import TYPE_CHECKING

from .common import AcceptanceError, fail

if TYPE_CHECKING:
    import pathlib


def credential_is_absent(root: pathlib.Path, token: str | None) -> bool:
    """Check all private bytes and paths, including WAL and exit-time writes."""
    if not token:
        return True
    needle = token.encode()
    for path in root.rglob("*"):
        if needle in str(path.relative_to(root)).encode():
            return False
        if not path.is_file():
            continue
        tail = b""
        with path.open("rb") as stream:
            for block in iter(partial(stream.read, 1024 * 1024), b""):
                window = tail + block
                if needle in window:
                    return False
                tail = window[-(len(needle) - 1) :] if len(needle) > 1 else b""
    return True


def load_enabled_credential(database: pathlib.Path) -> str:
    """Read exactly one enabled subscription credential without copying its store."""
    try:
        with contextlib.closing(
            sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
        ) as connection:
            rows = connection.execute(
                "SELECT data FROM auth_credentials WHERE provider = ? AND credential_type = ? AND disabled_cause IS NULL",
                ("openai-codex", "oauth"),
            ).fetchall()
        valid = []
        for row in rows:
            token = json.loads(row[0]).get("access")
            try:
                check_live_token(token)
            except AcceptanceError:
                continue
            valid.append(token)
    except (sqlite3.Error, ValueError, OSError) as error:
        fail("enabled subscription credential store could not be read", cause=error)
    if len(valid) != 1:
        fail("exactly one valid enabled openai-codex credential is required")
    return valid[0]


def check_live_token(token: str | None) -> None:
    """Check the in-memory enabled credential without emitting or persisting it."""
    if not token:
        fail("OPENAI_CODEX_OAUTH_TOKEN is required through the child environment")
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        if payload.get("exp", 0) < time.time() + 600:
            fail("enabled live credential has expired")
        if not payload.get("https://api.openai.com/auth", {}).get("chatgpt_account_id"):
            fail("enabled live credential has no account identity")
    except (
        AcceptanceError,
        OSError,
        ValueError,
        TypeError,
        KeyError,
        subprocess.SubprocessError,
    ) as error:
        fail("enabled live credential is invalid or expires too soon", cause=error)
