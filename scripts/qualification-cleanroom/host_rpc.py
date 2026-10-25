"""Explicit local xcsh protocol transport; never retries an admitted request."""
import json
import socket
import uuid


class HostRPC:
    def __init__(self, path):
        self.peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.peer.settimeout(120)
        self.peer.connect(path)
        self.wire = self.peer.makefile('rwb')
        self.call('initialize', dict(clientInfo=dict(name='kvm_qualification_observer', version='1'),
                                    capabilities=dict(experimentalApi=True)))

    def call(self, method, params):
        ident = uuid.uuid4().hex
        request = dict(id=ident, method='protocol', params=dict(request=dict(id=ident, method=method, params=params)))
        self.wire.write((json.dumps(request) + '\n').encode())
        self.wire.flush()
        while True:
            raw = self.wire.readline()
            if not raw:
                raise RuntimeError('transport ended; outcome unknown; do not replay')
            row = json.loads(raw)
            if row.get('method') == 'protocol/event':
                self.wire.write((json.dumps(dict(id=row['id'], result={})) + '\n').encode())
                self.wire.flush()
            elif row.get('id') == ident:
                if 'error' in row or 'error' in row.get('result', {}):
                    raise RuntimeError('protocol rejected: ' + method)
                return row['result']['result']

    def close(self):
        self.wire.close()
        self.peer.close()
