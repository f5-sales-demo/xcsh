"""Capture only task-owned CONNECT tunnels; no trust-store or daemon changes."""
import asyncio
import hashlib
import json
import os
import pathlib
import pwd
import re
import signal
import subprocess
import time


class ConnectProxy:
    def __init__(self, directory):
        self.directory = pathlib.Path(directory)
        self.connections = []
        self.tasks = set()

    async def start(self):
        self.server = await asyncio.start_server(self.accept, '127.0.0.1', 0)
        self.port = self.server.sockets[0].getsockname()[1]
        self.url = 'http://127.0.0.1:'+str(self.port)

    async def accept(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        upstream = None
        try:
            head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 15)
            method, target, version = head.split(b'\r\n', 1)[0].decode('ascii').split(' ')
            host, port = target.rsplit(':', 1)
            if method != 'CONNECT' or port != '443' or host not in ('api.openai.com', 'chatgpt.com', 'ab.chatgpt.com'):
                raise ValueError('unexpected diagnostic tunnel destination')
            remote, upstream = await asyncio.open_connection(host, int(port))
            self.connections.append(dict(atUnixNs=time.time_ns(), target=host, interface='lo',
                                         localTuple=writer.get_extra_info('peername'),
                                         tunnelTuple=writer.get_extra_info('sockname'),
                                         upstreamTuple=upstream.get_extra_info('peername')))
            writer.write(b'HTTP/1.1 200 Connection established\r\n\r\n')
            await writer.drain()

            async def forward(source, sink):
                while block := await source.read(65536):
                    sink.write(block)
                    await sink.drain()
            pending = [asyncio.create_task(forward(reader, upstream)),
                       asyncio.create_task(forward(remote, writer))]
            try:
                await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for child in pending: child.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
        except (Exception, asyncio.CancelledError):
            pass
        finally:
            writer.close()
            if upstream: upstream.close()
            self.tasks.discard(task)

    async def close(self):
        self.server.close()
        await self.server.wait_closed()
        for task in list(self.tasks): task.cancel()
        await asyncio.gather(*list(self.tasks), return_exceptions=True)
        (self.directory/'connections.private.json').write_text(json.dumps(self.connections, indent=2)+'\n')


class PacketCapture:
    async def start(self, directory, port=None, interface='lo', name='tunnels', capture_filter=None):
        self.directory = pathlib.Path(directory)
        self.path = self.directory/(name+'.private.pcap')
        self.interface = interface
        self.name = name
        self.armed_at = time.time_ns()
        self.proc = await asyncio.create_subprocess_exec(
            'sudo', '-n', 'tcpdump', '-Z', pwd.getpwuid(os.getuid()).pw_name,
            '-i', interface, '-s', '0', '-U', '--immediate-mode',
            '-w', str(self.path), *(capture_filter or ['tcp','port',str(port)]),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE, start_new_session=True)
        self.prefix = await asyncio.wait_for(self.proc.stderr.readline(), 10)
        # A collector is armed only after tcpdump reports its interface.
        while b'listening on' not in self.prefix:
            line = await asyncio.wait_for(self.proc.stderr.readline(), 10)
            if not line: raise RuntimeError('packet collector failed before arm')
            self.prefix += line

    async def close(self):
        if self.proc.returncode is None:
            subprocess.run(['sudo', '-n', 'kill', '-INT', '--', '-'+str(self.proc.pid)], check=True)
        _, output = await asyncio.wait_for(self.proc.communicate(), 10)
        log = (self.prefix+output).decode(errors='replace')
        (self.directory/(self.name+'-tcpdump.private.log')).write_text(log)
        # tcpdump drops privileges; restore only this owned capture's permissions.
        subprocess.run(['sudo', '-n', 'chown', str(os.getuid())+':'+str(os.getgid()), str(self.path)], check=True)
        self.path.chmod(0o600)
        drops = re.search(r'(\d+) packets dropped by kernel', log)
        packets = re.search(r'(\d+) packets captured', log)
        return dict(interface=self.interface, snaplen=0, armedAtUnixNs=self.armed_at,
                    complete=self.proc.returncode == 0 and bool(drops and packets),
                    drops=int(drops[1]) if drops else None,
                    packets=int(packets[1]) if packets else None,
                    sha256=hashlib.sha256(self.path.read_bytes()).hexdigest(),
                    encrypted=True, phoneRequestVisible=False)
