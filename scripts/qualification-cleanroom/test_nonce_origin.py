import io
import json
import threading
import unittest
import urllib.error
import urllib.request
import uuid

import nonce_origin


class NonceOriginTests(unittest.TestCase):
    def setUp(self):
        self.logs = io.StringIO()
        self.server = nonce_origin.serve(('127.0.0.1', 0), 'owned-fixture-generation', self.logs)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.addCleanup(self.close)
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_response_and_origin_log_correlate_two_fresh_requests(self):
        for _ in range(2):
            nonce = uuid.uuid4().hex
            with urllib.request.urlopen(self.url + '/healthz?nonce=' + nonce) as response:
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(json.load(response), dict(fixtureId='owned-fixture-generation', nonce=nonce))
        records = [json.loads(row) for row in self.logs.getvalue().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertEqual(len({row['nonce'] for row in records}), 2)
        self.assertTrue(all(row['sourceIp'] == '127.0.0.1' for row in records))

    def test_empty_health_check_cannot_return_a_success_proof(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(self.url + '/healthz')
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(self.logs.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
