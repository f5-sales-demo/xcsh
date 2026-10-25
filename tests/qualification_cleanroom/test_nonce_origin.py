import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import uuid

import nonce_origin
import pytest


class NonceOriginTests(unittest.TestCase):
    def setUp(self):
        self.logs = io.StringIO()
        self.server = nonce_origin.serve(
            ("127.0.0.1", 0), "owned-fixture-generation", self.logs
        )
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.close)
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_response_and_origin_log_correlate_two_fresh_requests(self):
        for _ in range(2):
            nonce = uuid.uuid4().hex
            with urllib.request.urlopen(
                f"http://127.0.0.1:{self.server.server_port}/healthz?nonce={nonce}"
            ) as response:
                assert response.headers["Cache-Control"] == "no-store"
                assert json.load(response) == {
                    "fixtureId": "owned-fixture-generation",
                    "nonce": nonce,
                }
        records = [json.loads(row) for row in self.logs.getvalue().splitlines()]
        assert len(records) == 2
        assert len({row["nonce"] for row in records}) == 2
        assert all(row["sourceIp"] == "127.0.0.1" for row in records)

    def test_empty_health_check_cannot_return_a_success_proof(self):
        with (
            pytest.raises(urllib.error.HTTPError) as caught,
            urllib.request.urlopen(
                f"http://127.0.0.1:{self.server.server_port}/healthz"
            ),
        ):
            self.fail("empty health check unexpectedly succeeded")
        assert caught.value.code == 400
        assert self.logs.getvalue() == ""


if __name__ == "__main__":
    unittest.main()
