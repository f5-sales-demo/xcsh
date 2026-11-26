"""Installed executable acceptance: fixtures."""

from __future__ import annotations

import http.server
import json
import re
import ssl
import threading
import time
import uuid
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import TYPE_CHECKING

from .common import Json, write_json
from .provider import response

if TYPE_CHECKING:
    import pathlib


@dataclass
class FixtureEvents:
    """Record credential comparisons and provider input without header secrets."""

    requests: list[Json] = field(default_factory=list)
    provider: list[Json] = field(default_factory=list)
    provider_faults: list[str] = field(default_factory=list)


@dataclass
class FixtureGates:
    """Coordinate admitted requests, retries and shutdown."""

    gated: threading.Event = field(default_factory=threading.Event)
    release: threading.Event = field(default_factory=threading.Event)
    shutdown: threading.Event = field(default_factory=threading.Event)


class FixtureServer(http.server.ThreadingHTTPServer):
    """Bind each HTTP handler to its typed fixture and endpoint."""

    owner: Fixture
    endpoint_label: str


class FixtureState:
    """Fresh withheld markers and synthetic endpoint credentials."""

    def __init__(self, scenario: str) -> None:
        """Create independent oracle values for one profile."""
        self.markers = ["lb-" + uuid.uuid4().hex[:16] for _ in range(2)]
        self.search_marker = "search-" + uuid.uuid4().hex[:16]
        self.cache_marker = "cache-" + uuid.uuid4().hex[:16]
        self.tokens = {
            "context-a": "synthetic-a-" + uuid.uuid4().hex,
            "context-b": "synthetic-b-" + uuid.uuid4().hex,
            "environment": "synthetic-env-" + uuid.uuid4().hex,
            "inherited": "synthetic-inherited-" + uuid.uuid4().hex,
        }
        self.auth_status = 401 if scenario in ("auth-error", "offline") else 200
        self.resource_status = (
            int(scenario.split("-")[1]) if scenario.startswith("http-") else 200
        )


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    """Record synthetic transport without recording authorization header values."""

    protocol_version = "HTTP/1.1"
    server: FixtureServer
    close_connection = True

    def log_message(self, *_: object) -> None:
        """Observe log message for the acceptance fixture."""

    def head(self) -> None:
        """Observe do HEAD for the acceptance fixture."""
        self.get()

    def get(self) -> None:
        """Observe do GET for the acceptance fixture."""
        if self.path in ("/v1/models", "/models"):
            self.respond(200, {"data": [{"id": "claude-sonnet-4-5", "type": "model"}]})
            return
        token = self.headers.get("Authorization", "")
        context = next(
            (
                name
                for name, value in self.server.owner.state.tokens.items()
                if token == "APIToken " + value
            ),
            None,
        )
        endpoint = self.server.endpoint_label
        if endpoint == "inherited" and self.server.owner.scenario.startswith(
            "environment"
        ):
            endpoint = "environment"
        event = {
            "at": time.monotonic(),
            "method": self.command,
            "path": self.path,
            "credentialMatches": context == endpoint,
            "context": context,
            "endpoint": endpoint,
            "requestId": self.headers.get("X-Request-ID"),
            "status": None,
            "url": "https://127.0.0.1:" + str(self.server.server_port) + self.path,
        }
        self.server.owner.events.requests.append(event)
        body: Json
        if self.path == "/api/web/namespaces":
            status, body = (
                self.server.owner.state.auth_status,
                {"items": [{"name": "default"}, {"name": "example-old"}]},
            )
        elif re.fullmatch(
            r"/api/config/namespaces/[a-z0-9-]+/http_loadbalancers", self.path
        ):
            if (
                self.server.owner.scenario.startswith("admitted-")
                and not self.server.owner.gates.release.is_set()
            ):
                self.server.owner.gates.gated.set()
                self.server.owner.gates.release.wait(90)
            if self.server.owner.scenario == "timeout":
                self.server.owner.gates.shutdown.wait(35)
                return
            if (
                self.server.owner.scenario.startswith("admitted-")
                and sum(
                    "/http_loadbalancers" in r["path"]
                    for r in self.server.owner.events.requests
                )
                == 1
            ):
                status = 503
            else:
                status = self.server.owner.state.resource_status
            body = {
                "items": []
                if self.server.owner.scenario == "empty"
                else [{"name": name} for name in self.server.owner.state.markers]
            }
        else:
            status, body = 404, {"error": "Unexpected synthetic route"}
        if not event["credentialMatches"]:
            status, body = 401, {"error": "Synthetic credential mismatch"}
        if status >= HTTPStatus.BAD_REQUEST:
            body = {"error": "Synthetic HTTP failure", "status": status}
        event["status"] = status
        self.respond(status, body)

    def respond(self, status: int, body: Json) -> None:
        """Observe respond for the acceptance fixture."""
        data = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.close_connection = True
            self.send_header("Retry-After", "1")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def post(self) -> None:
        """Observe do POST for the acceptance fixture."""
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if not self.path.endswith("/messages"):
            self.server.owner.events.provider.append(
                {"fault": "unexpected-provider-path", "path": self.path}
            )
            self.respond(404, {"error": "unexpected provider route"})
            return
        self.server.owner.events.provider.append(body)
        write_json(
            self.server.owner.private / "provider-requests.json",
            self.server.owner.events.provider,
        )
        if self.server.owner.scenario == "provider-failure":
            self.server.owner.events.provider_faults.append("failure")
            self.respond(
                400,
                {
                    "error": {
                        "type": "invalid_request_error",
                        "message": "Synthetic provider failure",
                    }
                },
            )
            return
        if self.server.owner.scenario == "provider-malformed":
            self.server.owner.events.provider_faults.append("malformed")
            events = [
                (
                    "message_start",
                    {"type": "message_start", "message": {"id": "bad"}},
                )
            ]
        else:
            events = response(self.server.owner, body)
        data = "".join(
            "event: " + kind + "\ndata: " + json.dumps(value) + "\n\n"
            for kind, value in events
        ).encode()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.close_connection = True
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # BaseHTTPRequestHandler dispatches these exact HTTP protocol names.
    do_HEAD = head  # noqa: N815 - BaseHTTPRequestHandler HTTP dispatch contract
    do_GET = get  # noqa: N815 - BaseHTTPRequestHandler HTTP dispatch contract
    do_POST = post  # noqa: N815 - BaseHTTPRequestHandler HTTP dispatch contract


class Fixture:
    """Serve synthetic tenant endpoints and a separate scripted provider endpoint."""

    def __init__(self, private: pathlib.Path, tls: pathlib.Path, scenario: str) -> None:
        """Observe init for the acceptance fixture."""
        self.private, self.scenario = private, scenario
        self.events = FixtureEvents()
        self.state = FixtureState(scenario)
        self.gates = FixtureGates()
        self.listeners: dict[str, tuple[FixtureServer, threading.Thread]] = {}
        self.urls: dict[str, str] = {}
        self.tenant_closed = False
        self.closed = False
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(str(tls / "certificate.pem"), str(tls / "key.pem"))
        for label in ("context-a", "context-b", "inherited", "provider"):
            self.listen(label, context)

    def listen(self, label: str, context: ssl.SSLContext) -> None:
        """Start a distinct tenant or provider loopback listener."""
        server = FixtureServer(("127.0.0.1", 0), FixtureHandler)
        server.owner = self
        server.endpoint_label = label
        server.daemon_threads = True
        server.socket = context.wrap_socket(server.socket, server_side=True)
        self.urls[label] = "https://127.0.0.1:" + str(server.server_port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        self.listeners[label] = (server, thread)
        thread.start()

    @property
    def provider_url(self) -> str:
        """Return the provider transport endpoint."""
        return self.urls["provider"]

    def close(self) -> None:
        """Observe close for the acceptance fixture."""
        if self.closed:
            return
        self.closed = True
        self.gates.release.set()
        self.gates.shutdown.set()
        self.close_tenant()
        for label in ("provider", "context-b", "inherited"):
            self.close_listener(label)
        write_json(self.private / "backend.json", self.events.requests)

    def close_tenant(self) -> None:
        """Observe close tenant for the acceptance fixture."""
        if not self.tenant_closed:
            self.close_listener("context-a")
            self.tenant_closed = True

    def close_listener(self, label: str) -> None:
        """Stop one owned listener and wait for its server thread."""
        server, thread = self.listeners[label]
        server.shutdown()
        server.server_close()
        thread.join(5)
