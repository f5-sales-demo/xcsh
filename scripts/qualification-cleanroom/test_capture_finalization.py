import pathlib
import tempfile
import unittest
from capture_finalization import finalize_attempt


class Resource:
    def __init__(self, failure=False):
        self.failure = failure
        self.closed = False

    def close(self):
        self.closed = True
        if self.failure:
            raise BrokenPipeError("fixture peer disconnected")


class Packet:
    def __init__(self, failure=False):
        self.failure = failure
        self.closed = False

    async def close(self):
        self.closed = True
        if self.failure:
            raise RuntimeError("fixture footer unavailable")
        return {"complete": True, "drops": 0}


class FinalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_broken_snapshot_and_peer_cannot_skip_packet_cleanup(self):
        peer, rpc, log, packet = Resource(True), Resource(), Resource(), Packet()

        def snapshot():
            raise BrokenPipeError("fixture snapshot disconnected")

        with tempfile.TemporaryDirectory() as directory:
            result = await finalize_attempt(pathlib.Path(directory), packet,
                                            [("peer", peer), ("rpc", rpc), ("log", log)], snapshot)
            self.assertTrue(all(x.closed for x in [peer, rpc, log, packet]))
            self.assertEqual(result["packet"], {"complete": True, "drops": 0})
            self.assertEqual([x["stage"] for x in result["errors"]], ["snapshot", "peer"])
            self.assertFalse(result["complete"])
            self.assertTrue((pathlib.Path(directory) / "finalization.private.json").exists())

    async def test_packet_failure_is_recorded_without_inventing_a_footer(self):
        with tempfile.TemporaryDirectory() as directory:
            packet = Packet(True)
            result = await finalize_attempt(pathlib.Path(directory), packet, [], lambda: {"thread": {}})
            self.assertTrue(packet.closed)
            self.assertFalse(result["complete"])
            self.assertIsNone(result["packet"])
            self.assertEqual(result["errors"][0]["stage"], "packet")

    async def test_success_keeps_snapshot_and_packet_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            result = await finalize_attempt(pathlib.Path(directory), Packet(), [], lambda: {"thread": {"id": "fixture"}})
            self.assertTrue(result["complete"])
            self.assertEqual(result["errors"], [])
            self.assertTrue((pathlib.Path(directory) / "thread-final.private.json").exists())


if __name__ == "__main__":
    unittest.main()
