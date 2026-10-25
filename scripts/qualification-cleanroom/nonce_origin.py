"""Owned workload proof endpoint; each successful request echoes a fresh nonce."""
import argparse
import http.server
import json
import re
import sys
import urllib.parse


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlsplit(self.path)
        values = urllib.parse.parse_qs(query.query)
        nonces = values.get('nonce', [])
        if query.path != '/healthz' or len(nonces) != 1 or not re.fullmatch('[a-zA-Z0-9_-]{16,128}', nonces[0]):
            self.send_error(400, 'A single fresh request nonce is required')
            return
        body = dict(fixtureId=self.server.fixture_id, nonce=nonces[0])
        raw = json.dumps(body, sort_keys=True).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
        print(json.dumps(dict(event='request', **body, sourceIp=self.client_address[0])),
              file=self.server.log_stream, flush=True)

    def log_message(self, *_):
        pass


def serve(address, fixture_id, log_stream=sys.stdout):
    server = http.server.ThreadingHTTPServer(address, Handler)
    server.fixture_id = fixture_id
    server.log_stream = log_stream
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-id', required=True)
    parser.add_argument('--port', type=int, default=80)
    args = parser.parse_args()
    serve(('0.0.0.0', args.port), args.fixture_id).serve_forever()
