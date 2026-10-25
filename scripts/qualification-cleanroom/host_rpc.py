"""Explicit local xcsh protocol transport; never retries an admitted request."""

from __future__ import annotations

import json
import socket
import uuid
from typing import Any


class HostRPC:
    """Maintain HostRPC qualification state."""

    def __init__(self, path: Any) -> None:
        """Initialize qualification state."""
        self.peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.peer.settimeout(120)
        self.peer.connect(path)
        self.wire = self.peer.makefile("rwb")
        self.call(
            "initialize",
            {
                "clientInfo": {"name": "kvm_qualification_observer", "version": "1"},
                "capabilities": {"experimentalApi": True},
            },
        )

    def call(self, method: Any, params: Any) -> Any:
        """Perform call."""
        ident = uuid.uuid4().hex
        request = {
            "id": ident,
            "method": "protocol",
            "params": {"request": {"id": ident, "method": method, "params": params}},
        }
        self.wire.write((json.dumps(request) + "\n").encode())
        self.wire.flush()
        while True:
            raw = self.wire.readline()
            if not raw:
                message = "transport ended; outcome unknown; do not replay"
                raise RuntimeError(message)
            row = json.loads(raw)
            if row.get("method") == "protocol/event":
                self.wire.write(
                    (json.dumps({"id": row["id"], "result": {}}) + "\n").encode()
                )
                self.wire.flush()
            elif row.get("id") == ident:
                if "error" in row or "error" in row.get("result", {}):
                    message = "protocol rejected: " + method
                    raise RuntimeError(message)
                return row["result"]["result"]

    def close(self) -> Any:
        """Perform close."""
        self.wire.close()
        self.peer.close()
