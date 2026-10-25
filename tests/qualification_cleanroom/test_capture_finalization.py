import pathlib
import tempfile
import unittest
from typing import Any

from capture_finalization import finalize_attempt


class Resource:
    def __init__(self, failure=False):
        self.failure = failure
        self.closed = False

    def close(self):
        self.closed = True
        if self.failure:
            message = "fixture peer disconnected"
            raise BrokenPipeError(message)


class Packet:
    def __init__(self, failure=False):
        self.failure = failure
        self.closed = False

    async def close(self) -> dict[str, Any]:
        self.closed = True
        if self.failure:
            message = "fixture footer unavailable"
            raise RuntimeError(message)
        return {"complete": True, "drops": 0}


class FinalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_broken_snapshot_and_peer_cannot_skip_packet_cleanup(self):
        peer, rpc, log, packet = Resource(True), Resource(), Resource(), Packet()

        def snapshot():
            message = "fixture snapshot disconnected"
            raise BrokenPipeError(message)

        with tempfile.TemporaryDirectory() as directory:
            result = await finalize_attempt(
                pathlib.Path(directory),
                packet,
                [("peer", peer), ("rpc", rpc), ("log", log)],
                snapshot,
            )
            assert all(x.closed for x in [peer, rpc, log])
            assert packet.closed
            assert result["packet"] == {"complete": True, "drops": 0}
            assert [x["stage"] for x in result["errors"]] == ["snapshot", "peer"]
            assert not result["complete"]
            assert (pathlib.Path(directory) / "finalization.private.json").exists()

    async def test_packet_failure_is_recorded_without_inventing_a_footer(self):
        with tempfile.TemporaryDirectory() as directory:
            packet = Packet(True)
            result = await finalize_attempt(
                pathlib.Path(directory), packet, [], lambda: {"thread": {}}
            )
            assert packet.closed
            assert not result["complete"]
            assert result["packet"] is None
            assert result["errors"][0]["stage"] == "packet"

    async def test_success_keeps_snapshot_and_packet_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            result = await finalize_attempt(
                pathlib.Path(directory),
                Packet(),
                [],
                lambda: {"thread": {"id": "fixture"}},
            )
            assert result["complete"]
            assert result["errors"] == []
            assert (pathlib.Path(directory) / "thread-final.private.json").exists()


if __name__ == "__main__":
    unittest.main()
