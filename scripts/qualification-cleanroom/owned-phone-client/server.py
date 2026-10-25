"""Private phone client adapter. The xcsh host creates every voice call."""

import argparse
import asyncio
import contextlib
import hashlib
import hmac
import json
import os
import ssl
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from aiohttp import WSMsgType, web


@dataclass
class Settings:
    root: Path
    project: Path
    socket_path: Path
    token: str
    origin: str
    backend: dict

    def verify_backend(self):
        digest = hashlib.sha256()
        with Path(self.backend["executable"]).open("rb") as binary:
            for chunk in iter(lambda: binary.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != self.backend["sha256"]:
            raise RuntimeError("Backend artifact changed")


class Rpc:
    def __init__(self, callback, socket_path):
        self.callback = callback
        self.socket_path = socket_path
        self.pending = {}
        self.closed = False
        self.write_lock = asyncio.Lock()
        self.reader_task = None

    async def write(self, message):
        async with self.write_lock:
            self.writer.write((json.dumps(message) + "\n").encode())
            await self.writer.drain()

    async def open(self):
        self.reader, self.writer = await asyncio.open_unix_connection(str(self.socket_path), limit=2 * 1024 * 1024)
        self.reader_task = asyncio.create_task(self.read())
        await self.call("initialize", {"clientInfo": {"name": "xcsh_owned_phone", "version": "1"},
                                      "capabilities": {"experimentalApi": True}})

    async def read(self):
        try:
            while line := await self.reader.readline():
                row = json.loads(line)
                if row.get("method") == "protocol/event":
                    await self.write({"id": row["id"], "result": {}})
                    params = row.get("params", {})
                    event = params.get("event", params)
                    if isinstance(event, dict):
                        await self.callback(event)
                else:
                    future = self.pending.get(row.get("id"))
                    if future and not future.done():
                        if "error" in row or "error" in row.get("result", {}):
                            future.set_exception(RuntimeError("Host rejected the request"))
                        else:
                            future.set_result(row["result"]["result"])
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("Host connection closed"))
            if not self.closed:
                await self.callback({"method": "bridge/transport/closed", "params": {}})

    async def call(self, method, params):
        ident = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        try:
            await self.write({"id": ident, "method": "protocol", "params": {
                "request": {"id": ident, "method": method, "params": params}}})
            return await asyncio.wait_for(future, 90)
        finally:
            self.pending.pop(ident, None)

    async def close(self):
        self.closed = True
        if self.reader_task:
            self.reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.reader_task
        if hasattr(self, "writer"):
            self.writer.close()
            await self.writer.wait_closed()


class PhoneSession:
    def __init__(self, settings, ws, factory, state):
        self.settings, self.ws, self.factory, self.state = settings, ws, factory, state
        self.rpc = factory(self.event)
        self.thread_id = None
        self.start_task = None
        self.call_requested = False
        self.cleaned = False
        self.cleanup_task = None
        self.lease = False
        self.started_at = time.time_ns() // 1000000
        self.directory = settings.root / "calls" / uuid.uuid4().hex
        self.directory.mkdir(parents=True, mode=0o700)
        self.receipt = {"backend": settings.backend, "creationOwnership": "xcsh", "transport": "webrtc",
                        "startedAtUnixMs": self.started_at, "physicalAcceptance": False, "userWorkReplayed": False}

    def record(self, kind, value):
        with (self.directory / "events.private.jsonl").open("a") as stream:
            stream.write(json.dumps({"atUnixMs": time.time_ns() // 1000000, "kind": kind, "value": value}) + "\n")

    async def send(self, value):
        if not self.ws.closed:
            await self.ws.send_json(value)

    async def event(self, event):
        method, params = event.get("method"), event.get("params", {})
        if not isinstance(params, dict):
            return
        if method and (method.startswith("thread/realtime/") or method == "bridge/transport/closed"):
            self.record("hostEvent", event)
        if method == "thread/realtime/sdp":
            await self.send({"type": "sdp", "sdp": params["sdp"]})
        elif method in ("thread/realtime/error", "bridge/transport/closed"):
            self.receipt["hostErrorObserved"] = True
            await self.send({"type": "error", "message": "The call stopped. Its capture has been saved."})
            # Schedule closure rather than deadlocking the RPC event reader on cleanup.
            asyncio.create_task(self.ws.close())
        elif method in ("thread/realtime/stopped", "thread/realtime/closed"):
            await self.send({"type": "stopped"})

    async def start(self, sdp, client_info):
        try:
            self.settings.verify_backend()
            result = await self.rpc.call("thread/start", {"cwd": str(self.settings.project), "model": "gpt-6-astra",
                "modelProvider": "openai-codex", "effort": "high", "sandbox": "workspace-write", "approvalPolicy": "on-request"})
            self.thread_id = result["thread"]["id"]
            self.receipt["threadId"] = self.thread_id
            if result.get("approvalPolicy") != "on-request" or result.get("sandbox", {}).get("type") != "workspaceWrite":
                raise RuntimeError("Unexpected permission profile")
            await self.rpc.call("thread/name/set", {"threadId": self.thread_id, "name": "XCSH OWNED PHONE VOICE"})
            params = {"threadId": self.thread_id, "transport": {"type": "webrtc", "sdp": sdp}, "version": "v3",
                      "outputModality": "audio", "includeStartupContext": False}
            self.record("ownedStartRequest", params)
            self.receipt["clientInfo"] = client_info
            self.call_requested = True
            await self.rpc.call("thread/realtime/start", params)
            self.receipt["startRequestSucceeded"] = True
            await self.send({"type": "started"})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.receipt["startErrorType"] = type(error).__name__
            await self.send({"type": "error", "message": "Could not start the call. Its capture has been saved."})
            asyncio.create_task(self.ws.close())

    async def cleanup(self):
        if self.cleanup_task is None:
            self.cleanup_task = asyncio.create_task(self._cleanup())
        await asyncio.shield(self.cleanup_task)

    async def _cleanup(self):
        if self.cleaned:
            return
        self.cleaned = True
        if self.start_task and not self.start_task.done():
            self.start_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.start_task
        if self.call_requested and self.thread_id:
            try:
                await self.rpc.call("thread/realtime/stop", {"threadId": self.thread_id})
                self.receipt["ownedCallStopped"] = True
            except Exception as error:
                self.receipt["cleanupErrorType"] = type(error).__name__
                self.receipt["ownedCallStopped"] = False
                recovery = self.factory(lambda event: asyncio.sleep(0))
                try:
                    await recovery.open()
                    await recovery.call("thread/realtime/stop", {"threadId": self.thread_id})
                    self.receipt["ownedCallStopped"] = True
                    self.receipt["cleanupUsedFreshControlConnection"] = True
                except Exception as recovery_error:
                    self.receipt["recoveryErrorType"] = type(recovery_error).__name__
                finally:
                    with contextlib.suppress(Exception):
                        await recovery.close()
        try:
            await self.rpc.close()
        except Exception as error:
            self.receipt["connectionCloseErrorType"] = type(error).__name__
        if self.lease:
            self.state["owner"] = None
        self.receipt["completedAtUnixMs"] = time.time_ns() // 1000000
        self.receipt["complete"] = True
        (self.directory / "receipt.private.json").write_text(json.dumps(self.receipt, indent=2) + "\n")


def create_app(settings, rpc_factory=None):
    assets = Path(__file__).parent
    state = {"owner": None}
    factory = rpc_factory or (lambda callback: Rpc(callback, settings.socket_path))
    app = web.Application(client_max_size=128 * 1024)

    @web.middleware
    async def headers(request, handler):
        response = await handler(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "microphone=(self)"
        response.headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'"
        return response

    app.middlewares.append(headers)
    names = {"/": "index.html", "/app.js": "app.js", "/app.css": "app.css", "/manifest.webmanifest": "manifest.webmanifest", "/icon.png": "icon.png"}

    async def asset(request):
        name = names.get(request.path)
        if not name:
            raise web.HTTPNotFound()
        return web.FileResponse(assets / name)

    async def voice(request):
        protocols = [p.strip() for p in request.headers.get("Sec-WebSocket-Protocol", "").split(",")]
        if request.headers.get("Origin") != settings.origin or "xcsh-voice" not in protocols or not any(hmac.compare_digest(p, settings.token) for p in protocols):
            raise web.HTTPForbidden()
        ws = web.WebSocketResponse(protocols=["xcsh-voice"], heartbeat=20, max_msg_size=128 * 1024)
        await ws.prepare(request)
        session = PhoneSession(settings, ws, factory, state)
        try:
            await session.rpc.open()
            await session.send({"type": "ready"})
            async for message in ws:
                if message.type != WSMsgType.TEXT:
                    break
                try:
                    data = json.loads(message.data)
                except ValueError:
                    await session.send({"type": "error", "message": "Invalid request."})
                    continue
                if not isinstance(data, dict):
                    continue
                if data.get("type") == "evidence":
                    kind, value = data.get("kind"), data.get("value")
                    if kind in ("provider", "connection", "playback") and isinstance(value, dict) and len(json.dumps(value)) < 16384:
                        session.record("browserEvidence", {"kind": kind, "value": value})
                        if kind == "provider" and value.get("type") == "session.closed":
                            session.receipt["providerClosureObserved"] = True
                    continue
                if data.get("type") == "stop":
                    async def end_gracefully():
                        await session.cleanup()
                        await asyncio.sleep(2)
                        await ws.close()
                    asyncio.create_task(end_gracefully())
                    continue
                if data.get("type") != "start":
                    await session.send({"type": "error", "message": "Only voice start and stop are supported."})
                    continue
                sdp = data.get("sdp")
                if not isinstance(sdp, str) or not sdp.startswith("v=0") or len(sdp.encode()) > 96 * 1024:
                    await session.send({"type": "error", "message": "Invalid connection offer."})
                    continue
                if session.start_task or state["owner"] is not None:
                    await session.send({"type": "error", "message": "A call is already active."})
                    continue
                state["owner"] = session
                session.lease = True
                info = data.get("clientInfo", "")
                session.start_task = asyncio.create_task(session.start(sdp, info[:1024] if isinstance(info, str) else ""))
        finally:
            await session.cleanup()
            await ws.close()
            (session.directory / "receipt.private.json").write_text(json.dumps(session.receipt, indent=2) + "\n")
        return ws

    app.router.add_get("/voice", voice)
    app.router.add_get("/{path:.*}", asset)
    return app


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    settings = Settings(root=Path(config["root"]), project=Path(config["project"]), socket_path=Path(config["socketPath"]),
                        token=Path(config["tokenFile"]).read_text().strip(), origin=config["origin"], backend=config["backend"])
    settings.verify_backend()
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(config["certificate"], config["key"])
    web.run_app(create_app(settings), host=config["bind"], port=config["port"], ssl_context=tls, access_log=None)


if __name__ == "__main__":
    main()
