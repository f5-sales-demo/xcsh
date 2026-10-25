"""Owned workload proof endpoint; each successful request echoes a fresh nonce."""

from __future__ import annotations

import argparse
import http.server
import json
import re
import sys
import urllib.parse
from typing import Any


class NonceServer(http.server.ThreadingHTTPServer):
    """Retain the fixture identity and private log sink for request handlers."""

    fixture_id: str
    log_stream: Any


class Handler(http.server.BaseHTTPRequestHandler):
    """Maintain Handler qualification state."""

    server: NonceServer

    def do_GET(self) -> Any:  # pylint: disable=invalid-name
        # Required BaseHTTPRequestHandler method name.
        """Perform do GET."""
        query = urllib.parse.urlsplit(self.path)
        values = urllib.parse.parse_qs(query.query)
        nonces = values.get("nonce", [])
        if (
            query.path != "/healthz"
            or len(nonces) != 1
            or not re.fullmatch("[a-zA-Z0-9_-]{16,128}", nonces[0])
        ):
            self.send_error(400, "A single fresh request nonce is required")
            return
        body = {"fixtureId": self.server.fixture_id, "nonce": nonces[0]}
        raw = json.dumps(body, sort_keys=True).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        print(
            json.dumps(
                {"event": "request", **body, "sourceIp": self.client_address[0]}
            ),
            file=self.server.log_stream,
            flush=True,
        )
        # A completed response must have its matching owned-workload log already recorded.
        self.wfile.write(raw)

    def log_message(self, *_: Any) -> Any:
        """Perform log message."""


def serve(address: Any, fixture_id: Any, log_stream: Any = sys.stdout) -> Any:
    """Perform serve."""
    server = NonceServer(address, Handler)
    server.fixture_id = fixture_id
    server.log_stream = log_stream
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-id", required=True)
    parser.add_argument("--port", type=int, default=80)
    args = parser.parse_args()
    # Owned workload fixture must receive the remotely routed demo requests.
    BIND_ADDRESS = "0.0.0.0"  # noqa: S104
    serve((BIND_ADDRESS, args.port), args.fixture_id).serve_forever()
