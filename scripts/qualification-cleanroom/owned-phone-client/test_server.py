import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path

from aiohttp import WSServerHandshakeError
from aiohttp.test_utils import TestClient, TestServer

from server import Settings, create_app


class FakeRpc:
    def __init__(self, callback, calls, gate=None):
        self.callback = callback
        self.calls = calls
        self.gate = gate
        self.start_sent = asyncio.Event()

    async def open(self):
        self.calls.append(("open", {}))

    async def call(self, method, params):
        self.calls.append((method, params))
        if method == "thread/start":
            return {"thread": {"id": "fixture-thread"}, "sandbox": {"type": "workspaceWrite"}, "approvalPolicy": "on-request"}
        if method == "thread/realtime/start":
            self.start_sent.set()
            if self.gate:
                await self.gate.wait()
            await self.callback({"method": "thread/realtime/sdp", "params": {"sdp": "v=0\r\nanswer"}})
        return {}

    async def close(self):
        self.calls.append(("close", {}))


class PhoneClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        binary = root / "backend"
        binary.write_bytes(b"immutable fixture")
        self.settings = Settings(root=root, project=root, socket_path=root / "fixture.sock", token="a" * 64,
                                 origin="https://phone.test", backend={"executable": str(binary), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "commit": "fixture"})
        self.calls = []
        self.gate = None
        self.rpc = None

        def factory(callback):
            self.rpc = FakeRpc(callback, self.calls, self.gate)
            return self.rpc

        self.client = TestClient(TestServer(create_app(self.settings, rpc_factory=factory)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    async def connect(self):
        ws = await self.client.ws_connect("/voice", headers={"Origin": self.settings.origin}, protocols=["xcsh-voice", self.settings.token])
        self.assertEqual((await ws.receive_json())["type"], "ready")
        return ws

    async def wait_for_cleanup(self):
        for _ in range(100):
            if any(method == "close" for method, _ in self.calls):
                return
            await asyncio.sleep(0.01)
        self.fail("Owned connection was not cleaned up")

    async def test_untrusted_client_cannot_open_backend(self):
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect("/voice", headers={"Origin": self.settings.origin}, protocols=["xcsh-voice", "wrong"])
        self.assertEqual(error.exception.status, 403)
        self.assertEqual(self.calls, [])
        with self.assertRaises(WSServerHandshakeError):
            await self.client.ws_connect("/voice", headers={"Origin": "https://other.test"}, protocols=["xcsh-voice", self.settings.token])
        self.assertEqual(self.calls, [])

    async def test_page_exposes_no_host_credentials(self):
        response = await self.client.get("/")
        body = await response.text()
        self.assertEqual(response.status, 200)
        self.assertNotIn(self.settings.token, body)
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual((await self.client.get("/server.py")).status, 404)

    async def test_only_owned_webrtc_start_and_stop_are_allowed(self):
        ws = await self.connect()
        await ws.send_json({"type": "turn/start", "params": {"input": "replay"}})
        self.assertEqual((await ws.receive_json())["type"], "error")
        self.assertFalse(any(method == "turn/start" for method, _ in self.calls))
        await ws.send_json({"type": "start", "sdp": "v=0\r\no=fixture"})
        for _ in range(3):
            event = await ws.receive_json()
            if event["type"] == "started":
                break
        self.assertEqual(event["type"], "started")
        starts = [params for method, params in self.calls if method == "thread/realtime/start"]
        self.assertEqual(len(starts), 1)
        self.assertEqual(starts[0]["transport"]["type"], "webrtc")
        thread = next(params for method, params in self.calls if method == "thread/start")
        self.assertEqual(thread["sandbox"], "workspace-write")
        self.assertEqual(thread["approvalPolicy"], "on-request")
        await ws.close()
        await self.wait_for_cleanup()
        self.assertEqual(sum(method == "thread/realtime/stop" for method, _ in self.calls), 1)
        self.assertEqual(sum(method == "thread/realtime/start" for method, _ in self.calls), 1)

    async def test_disconnect_during_creation_stops_without_replay(self):
        self.gate = asyncio.Event()
        ws = await self.connect()
        await ws.send_json({"type": "start", "sdp": "v=0\r\no=fixture"})
        await asyncio.wait_for(self.rpc.start_sent.wait(), 2)
        await ws.close()
        await self.wait_for_cleanup()
        self.assertEqual(sum(method == "thread/realtime/stop" for method, _ in self.calls), 1)
        self.assertFalse(any(method == "turn/start" for method, _ in self.calls))


if __name__ == "__main__":
    unittest.main()
