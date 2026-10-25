"""Linux installed-RPC experiment; all raw evidence stays owner-only."""
import asyncio
import array
import hashlib
import json
import math
import os
import pathlib
import random
import shutil
import socket
import sqlite3
import ssl
import struct
import subprocess
import time
import uuid
from fractions import Fraction

import aiohttp
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, MediaStreamTrack
from av import AudioFrame
from voice_ab_capture import ConnectProxy, PacketCapture
from voice_ab_network import launch as namespace_launch, INTERFACE, ADDRESS

ROOT = pathlib.Path.home() / 'xcsh-uat-lab/voice-ab-20261018'
os.umask(0o077)


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def file_sha(path):
    h=hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):h.update(block)
    return h.hexdigest()


def seeded_burst_pcm(pts, amplitude=1500, samples=960):
    generator = random.Random(pts)
    phase = (pts / 48000) % 3
    envelope = max(0.0, math.sin(math.pi * phase / 0.7)) ** 2 if phase < 0.7 else 0.01
    return b''.join(struct.pack('<h', int(generator.randint(-amplitude, amplitude) * envelope))
                    for _ in range(samples))


class Recording:
    def __init__(self, path):
        self.path = path
        self.stream = path.open('x')
        self.sequence = 0
        self.rows = []
        self.append('collector_armed')

    def append(self, stage, **values):
        self.sequence += 1
        row = dict(sequence=self.sequence, atUnixNs=time.time_ns(), stage=stage, **values)
        self.rows.append(row)
        self.stream.write(json.dumps(row)+'\n')
        self.stream.flush()

    def close(self):
        self.append('collector_footer', complete=True)
        self.stream.close()
        return dict(sha256=sha(self.path.read_bytes()), complete=True, count=self.sequence)


class RPC:
    async def connect(self, directory, backend, environment):
        self.backend = backend
        self.pending = {}
        self.record = Recording(directory/'rpc.private.jsonl')
        self.notifications = []
        self.error_stream = (directory/'backend.private.log').open('w')
        if backend == 'codex':
            binary = os.environ.get('VOICE_AB_NATIVE_BINARY',str(ROOT/'release-bin/codex-x86_64-unknown-linux-musl'))
            self.candidate=dict(commit='83086188ae0614bd882818ff1aa23f3194962012',executable=binary,sha256=file_sha(binary))
            command = [binary, 'app-server', '--stdio']
            debug_socket=None
            if os.environ.get('VOICE_AB_GDB') == '1':
                debug_socket=directory/'debug.sock'
                command=['/usr/bin/gdb','-q','-batch','-x',str(ROOT/'gdb-trace.private.commands'),'--args',
                         binary,'app-server','--listen','unix://'+str(debug_socket)]
            if os.environ.get('VOICE_AB_NAMESPACE') == '1': command = namespace_launch(command,environment,directory)
            self.proc = await asyncio.create_subprocess_exec(*command,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=self.error_stream, env=environment, cwd=directory/'project', start_new_session=True)
            if debug_socket:
                for _ in range(600):
                    if debug_socket.exists():break
                    await asyncio.sleep(.05)
                self.reader,self.writer=await asyncio.open_unix_connection(str(debug_socket))
            else:self.reader, self.writer = self.proc.stdout, self.proc.stdin
        else:
            agent = directory/'agent'
            (agent/'remote-control/workers').mkdir(parents=True, mode=0o700)
            snapshots = {}
            for name in ('agent.db', 'models.db'):
                db = sqlite3.connect((pathlib.Path.home() / '.xcsh/agent' / name).as_uri() + '?mode=ro', uri=True)
                target = sqlite3.connect(agent/name)
                db.backup(target); target.close(); db.close()
                snapshots[name] = sha((agent/name).read_bytes())
            self.record.append('real_configuration_cloned',databaseSha256=snapshots)
            environment['PI_CODING_AGENT_DIR'] = str(agent)
            environment['XCSH_REMOTE_TRACE_DIRECTORY'] = str(directory/'traces')
            environment['XCSH_REMOTE_TRACE_SCENARIO'] = 'native-ab-startup'
            environment['XCSH_REMOTE_TRACE_SALT'] = os.urandom(32).hex()
            environment['XCSH_VOICE_UAT_DIRECTORY'] = str(directory/'diagnostics')
            environment['XCSH_VOICE_UAT_SCENARIO'] = 'native-ab-startup'
            path = agent/'remote-control/workers/attempt.sock'
            baseline = json.loads(pathlib.Path(os.environ.get('VOICE_AB_XCSH_CANDIDATE',str(ROOT/'baseline.private.json'))).read_text())
            self.candidate=baseline['candidate']
            assert file_sha(self.candidate['executable'])==self.candidate['sha256'], 'installed candidate hash mismatch'
            command = [baseline['candidate']['executable'],'remote-control','worker',str(path)]
            if os.environ.get('VOICE_AB_NAMESPACE') == '1': command = namespace_launch(command,environment,directory)
            self.proc = await asyncio.create_subprocess_exec(*command, stderr=self.error_stream,
                stdout=self.error_stream, env=environment, cwd=directory/'project', start_new_session=True)
            for _ in range(200):
                if path.exists(): break
                if self.proc.returncode is not None: raise RuntimeError('installed worker startup failed')
                await asyncio.sleep(.05)
            self.reader, self.writer = await asyncio.open_unix_connection(str(path))
        if os.environ.get('VOICE_AB_NAMESPACE') == '1':
            # The sudo monitor is root-owned; prove the actual namespace inferior.
            code = '''import pathlib,subprocess,json,sys,time
expected=pathlib.Path(sys.argv[1]);found=[]
for _ in range(40):
 for pid in subprocess.check_output(["ip","netns","pids","voice-ab-20261018"],text=True).split():
  try:
   p=pathlib.Path("/proc",pid)
   if (p/"exe").resolve()==expected:
    found.append(dict(pid=int(pid),executable=str(expected),startTime=(p/"stat").read_text().split(") ",1)[1].split()[19],uid=p.stat().st_uid))
  except FileNotFoundError:pass
 if found:break
 time.sleep(.05)
assert found,"expected namespace executable not observed"
print(json.dumps(found))'''
            expected=binary if backend=='codex' else baseline['candidate']['executable']
            observed=json.loads(subprocess.check_output(['sudo','-n','/usr/bin/python3','-c',code,expected],text=True))
            self.record.append('process_started',monitorPid=self.proc.pid,backend=backend,processes=observed)
        else:
            self.record.append('process_started', pid=self.proc.pid, backend=backend,
                               executable=str(pathlib.Path('/proc',str(self.proc.pid),'exe').resolve()))
        self.pump = asyncio.create_task(self.read())

    async def read(self):
        try:
            while raw := await self.reader.readline():
                value = json.loads(raw)
                self.record.append('rpc_received', message=value)
                if value.get('id') in self.pending and ('result' in value or 'error' in value):
                    self.pending.pop(value['id']).set_result(value)
                elif value.get('method'):
                    message = value.get('params', {}).get('event', value)
                    self.notifications.append(message)
                    if 'id' in value:
                        result = {'ack':value.get('params',{}).get('seq')} if self.backend == 'xcsh' else {}
                        self.writer.write((json.dumps(dict(id=value['id'],result=result))+'\n').encode())
                        await self.writer.drain()
        except Exception:
            for future in self.pending.values():
                if not future.done(): future.set_exception(RuntimeError('RPC capture ended'))

    async def call(self, method, params, sensitive=False):
        ident = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        self.record.append('rpc_sent', method=method, params={'type':params.get('type'),'credentialValuesOmitted':True}
                           if sensitive else params)
        self.writer.write((json.dumps(dict(id=ident,method=method,params=params))+'\n').encode())
        await self.writer.drain()
        response = await asyncio.wait_for(future, 90)
        if 'error' in response: raise RuntimeError('RPC rejected '+method+': '+str(response['error'].get('code')))
        return response.get('result', {})

    async def session(self, method, params):
        if self.backend == 'codex': return await self.call(method, params)
        result = await self.call('worker/sessionCall', dict(identity=uuid.uuid4().hex, method=method, params=params))
        return result['result']

    async def close(self):
        if hasattr(self, 'writer'): self.writer.close()
        if hasattr(self, 'proc') and self.proc.returncode is None:
            if os.environ.get('VOICE_AB_NAMESPACE') == '1':
                subprocess.run(['sudo','-n','kill','-TERM','--','-'+str(self.proc.pid)],check=True)
            else: self.proc.terminate()
            try: await asyncio.wait_for(self.proc.wait(), 15)
            except asyncio.TimeoutError:
                self.proc.kill(); await self.proc.wait()
        if hasattr(self, 'pump'): await asyncio.gather(self.pump, return_exceptions=True)
        self.error_stream.close()
        return self.record.close()


class CallerAudio(MediaStreamTrack):
    kind = 'audio'
    def __init__(self):
        super().__init__(); self.pts=0; self.started=None; self.digest=hashlib.sha256()
    async def recv(self):
        if self.started is None: self.started=time.monotonic()
        await asyncio.sleep(max(0, self.started+self.pts/48000-time.monotonic()))
        data = seeded_burst_pcm(self.pts)
        self.digest.update(data)
        frame=AudioFrame(format='s16',layout='mono',samples=960)
        frame.sample_rate=48000; frame.pts=self.pts; frame.time_base=Fraction(1,48000)
        frame.planes[0].update(data.ljust(frame.planes[0].buffer_size,b'\0'))
        self.pts += 960
        return frame


async def config_read():
    reader, writer = await asyncio.open_unix_connection(str(pathlib.Path.home() / '.xcsh/agent/remote-control/host.sock'))
    async def call(method, params):
        ident=uuid.uuid4().hex
        writer.write((json.dumps(dict(id=ident,method='protocol',params=dict(request=dict(id=ident,method=method,params=params))))+'\n').encode())
        await writer.drain()
        while raw := await reader.readline():
            row=json.loads(raw)
            if row.get('id') == ident:
                if 'error' in row: raise RuntimeError('installed config read rejected')
                return row['result']['result']
            if row.get('method') == 'protocol/event':
                writer.write((json.dumps(dict(id=row['id'],result={}))+'\n').encode()); await writer.drain()
        raise RuntimeError('configuration transport ended')
    try:
        await call('initialize',dict(clientInfo=dict(name='voice_ab_config',version='1'),capabilities=dict(experimentalApi=True)))
        return await call('config/read',dict(includeLayers=True))
    finally: writer.close(); await writer.wait_closed()


async def run(backend, policy, material, index):
    # Linux sockaddr_un permits at most 107 pathname bytes, including parent paths.
    directory=ROOT/('a'+str(index)+'-'+backend+'-'+str(time.time_ns()%1000000000))
    directory.mkdir(mode=0o700)
    for name in ('project','traces','diagnostics','codex-home'): (directory/name).mkdir(mode=0o700)
    wire=Recording(directory/'primary.private.jsonl')
    media=Recording(directory/'media.private.jsonl')
    lifecycle=Recording(directory/'lifecycle.private.jsonl')
    proxy=ConnectProxy(directory); await proxy.start()
    packet=PacketCapture(); await packet.start(directory,proxy.port)
    sideband_packet=None
    if os.environ.get('VOICE_AB_NAMESPACE') == '1':
        sideband_packet=PacketCapture()
        await sideband_packet.start(directory,interface=INTERFACE,name='sideband',
                                   capture_filter=['host',ADDRESS,'and','tcp','port','443'])
    rpc=RPC(); pc=RTCPeerConnection(RTCConfiguration(iceServers=[])); caller=CallerAudio();pc.addTrack(caller)
    channel=pc.createDataChannel('oai-events'); output=dict(frames=0,signalFrames=0,maxRms=0)
    consumers=[]; call_id=None; thread_id=None; server_closed=False; rpc_started=False
    headers={'Authorization':'Bearer '+material['accessToken'],'ChatGPT-Account-Id':material['accountId'],
             'originator':'xcsh','openai-alpha':'quicksilver=v2'}
    @channel.on('message')
    def on_message(value):
        nonlocal server_closed
        event=json.loads(value); wire.append('primary_event',event=event)
        if event.get('type') == 'session.closed': server_closed=True
    @pc.on('connectionstatechange')
    async def state_change(): lifecycle.append('media_state',state=pc.connectionState)
    @pc.on('track')
    def track_received(track):
        async def consume():
            try:
                while True:
                    frame=await track.recv()
                    if frame.format.bytes != 2: raise RuntimeError('non-PCM16 output')
                    count=frame.samples*(1 if frame.format.is_planar else len(frame.layout.channels))
                    samples=array.array('h',bytes(frame.planes[0])[:count*2])
                    rms=math.sqrt(sum(v*v for v in samples)/len(samples)) if samples else 0
                    output['frames']+=1; output['signalFrames']+=int(rms>32)
                    output['maxRms']=max(output['maxRms'],round(rms))
                    media.append('output_audio',rms=round(rms),signalFrames=int(rms>32))
            except Exception as error: media.append('audio_track_ended',errorType=type(error).__name__)
        consumers.append(asyncio.create_task(consume()))
    result=dict(backend=backend,scope='installed-worker-startup' if backend=='xcsh' else 'native-startup',
                physicalAcceptance=False, phoneRequestVisible=False, creationInstructionBytes=len(policy.encode()),
                creationInstructionsSha256=sha(policy), model='gpt-6-astra',effort='high',voiceModel='gpt-live-1-codex',voice='cove',
                accountSha256=sha(material['accountId']),rootCauseEstablished=False)
    result['nativeBuild']='source-debug' if os.environ.get('VOICE_AB_NATIVE_BINARY') else 'stock-release'
    result['debuggerInstrumented']=os.environ.get('VOICE_AB_GDB')=='1'
    try:
        environment=dict(os.environ,HTTPS_PROXY=proxy.url,HTTP_PROXY=proxy.url,ALL_PROXY=proxy.url,
                         NO_PROXY='localhost,127.0.0.1',CODEX_HOME=str(directory/'codex-home'),
                         RUST_LOG='codex_api=trace,codex_core::realtime_conversation=debug')
        (directory/'codex-home/config.toml').write_text('model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n'
            +'experimental_realtime_ws_backend_prompt = '+json.dumps(policy)+'\n')
        await rpc.connect(directory,backend,environment); rpc_started=True
        if backend=='codex':
            await rpc.call('initialize',dict(clientInfo=dict(name='voice_ab',version='1'),capabilities=dict(experimentalApi=True)))
            await rpc.call('account/login/start',dict(type='chatgptAuthTokens',accessToken=material['accessToken'],
                           chatgptAccountId=material['accountId']),sensitive=True)
            account=await rpc.call('account/read',dict(refreshToken=False))
            lifecycle.append('account_read',account=account)
            config=await rpc.call('config/read',dict(includeLayers=True))
            lifecycle.append('configuration_read',configuration=config)
            thread=await rpc.call('thread/start',dict(cwd=str(directory/'project'),model='gpt-6-astra',
                                  modelProvider='openai',experimentalRawEvents=True))
            thread_id=thread['thread']['id']
        else:
            config=await config_read(); lifecycle.append('configuration_read',configuration=config)
            initialized=await rpc.call('worker/initialize',dict(request=dict(kind='start',params=dict(
                cwd=str(directory/'project'),model='gpt-6-astra',modelProvider='openai-codex',effort='high'))))
            thread_id=initialized['endpoint']['thread']['id']
        lifecycle.append('thread_created',threadId=thread_id)
        result['configuredInstructionsSha256']=sha(config['config'].get('experimental_realtime_ws_backend_prompt') or '')
        await pc.setLocalDescription(await pc.createOffer())
        body={'sdp':pc.localDescription.sdp,'session':{'model':'gpt-live-1-codex','instructions':policy,
              'audio':{'output':{'voice':'cove'}},'delegation':{'type':'client'}}}
        lifecycle.append('prompt_selected',instructionsSha256=sha(policy),bytes=len(policy.encode()))
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=45)) as http:
            async with http.post('https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas',
                headers={**headers,'Content-Type':'application/json'},json=body,proxy=proxy.url,allow_redirects=False) as response:
                result['creationStatus']=response.status
                if response.status!=201: raise RuntimeError('call creation rejected')
                location=response.headers.get('Location','').split('?')[0]
                call_id=location.rstrip('/').split('/')[-1]
                if not call_id or not location: raise RuntimeError('call identity unavailable')
                lifecycle.append('call_created',callId=call_id,responseHeaderNames=sorted(response.headers.keys()))
                answer=await response.text()
            await pc.setRemoteDescription(RTCSessionDescription(sdp=answer,type='answer'))
            lifecycle.append('media_activated',callId=call_id)
            await rpc.session('thread/realtime/start',dict(threadId=thread_id,version='v3',outputModality='audio',
                includeStartupContext=False,realtimeSessionId=str(uuid.uuid4()),
                transport=dict(type='existingCall',callId=call_id)))
            lifecycle.append('realtime_start_accepted')
            await asyncio.sleep(14)
            await rpc.session('thread/realtime/stop',dict(threadId=thread_id))
            lifecycle.append('local_close_requested',reason='diagnostic-duration-ended')
            await asyncio.sleep(2)
            try:
                history=await rpc.session('thread/read',dict(threadId=thread_id,includeTurns=True))
                (directory/'history.private.json').write_text(json.dumps(history,indent=2)+'\n')
            except Exception as error: result['historyErrorType']=type(error).__name__
            result['notifications']=[n.get('method') for n in rpc.notifications]
    except Exception as error:
        result['failureType']=type(error).__name__
        result['failureMessage']=str(error)[:150]
        lifecycle.append('attempt_failed',errorType=type(error).__name__)
    finally:
        result['notifications']=[n.get('method') for n in rpc.notifications] if hasattr(rpc,'notifications') else []
        if call_id and not server_closed:
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as http:
                    async with http.ws_connect('wss://api.openai.com/v1/live/'+call_id,headers=headers,proxy=proxy.url) as ws:
                        await ws.send_json({'type':'session.close'})
                        deadline=time.monotonic()+5
                        while time.monotonic()<deadline:
                            msg=await asyncio.wait_for(ws.receive(),1)
                            if msg.type==aiohttp.WSMsgType.TEXT and json.loads(msg.data).get('type')=='session.closed':
                                server_closed=True; break
                            if msg.type in (aiohttp.WSMsgType.CLOSED,aiohttp.WSMsgType.ERROR):break
            except Exception as error: result['cleanupErrorType']=type(error).__name__
        await pc.close()
        for task in consumers: task.cancel()
        await asyncio.gather(*consumers,return_exceptions=True)
        if hasattr(rpc,'candidate'):result['candidate']=rpc.candidate
        if hasattr(rpc, 'record'): result['rpcCapture']=await rpc.close()
        await proxy.close(); result['packets']=await packet.close()
        if sideband_packet: result['sidebandPackets']=await sideband_packet.close()
        result.update(startupAudio=output,inputSamples=caller.pts,inputSha256=caller.digest.hexdigest(),
                      serverClosureConfirmed=server_closed,primaryCapture=wire.close(),mediaCapture=media.close(),
                      lifecycleCapture=lifecycle.close(),directory=str(directory))
        # Runtime auth and cloned credential DBs are staging, never evidence artifacts.
        for parent in (directory/'agent',directory/'codex-home'):
            for name in ('auth.json','agent.db','agent.db-wal','agent.db-shm','models.db','models.db-wal','models.db-shm'):
                (parent/name).unlink(missing_ok=True)
        (directory/'result.private.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps({k:v for k,v in result.items() if k in ('backend','directory','failureType','failureMessage',
                        'creationStatus','startupAudio','serverClosureConfirmed','configuredInstructionsSha256','creationInstructionsSha256')}),flush=True)
    return result


async def main():
    material_path=ROOT/'auth-material.private.json'
    material=json.loads(material_path.read_text()); material_path.unlink()
    config=await config_read()
    policy=config['config'].get('experimental_realtime_ws_backend_prompt')
    assert isinstance(policy,str) and policy.strip(), 'installed creation policy unavailable'
    (ROOT/'bootstrap-config.private.json').write_text(json.dumps(config,indent=2)+'\n')
    results=[]
    for index,backend in enumerate(('codex','xcsh','xcsh','codex'),1):
        results.append(await run(backend,policy,material,index))
    (ROOT/('installed-abba-'+str(time.time_ns())+'.private.json')).write_text(json.dumps(results,indent=2)+'\n')


if __name__=='__main__': asyncio.run(main())
