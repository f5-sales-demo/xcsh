"""Seal ordered private lifecycle evidence, retaining incomplete captures explicitly."""
import argparse
import collections
import datetime
import hashlib
import json
import pathlib
import re
import subprocess


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def recording(path):
    rows=[json.loads(line) for line in path.read_text().splitlines()]
    complete=bool(rows and rows[0].get('stage')=='collector_armed'
                  and rows[-1].get('stage')=='collector_footer' and rows[-1].get('complete') is True
                  and [r.get('sequence') for r in rows]==list(range(1,len(rows)+1)))
    return rows,dict(path=str(path),sha256=digest(path),complete=complete,
                     armedAtUnixNs=rows[0].get('atUnixNs') if rows else None)


def unix_ns(value):
    if not isinstance(value,str):return None
    try:return int(datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000000000)
    except ValueError:return None


def seal(directory):
    directory=pathlib.Path(directory)
    result=json.loads((directory/'result.private.json').read_text())
    timeline=[]; captures={}; limitations=[]
    def event(stage,at,source,**fields):
        if at is not None:timeline.append(dict(stage=stage,atUnixNs=at,source=source,**fields))
    life,captures['lifecycle']=recording(directory/'lifecycle.private.jsonl')
    rpc,captures['rpc']=recording(directory/'rpc.private.jsonl')
    primary,captures['primary']=recording(directory/'primary.private.jsonl')
    media,captures['media']=recording(directory/'media.private.jsonl')
    candidate=result.get('candidate')
    if candidate is None:
        if result['backend']=='xcsh':candidate=json.loads((directory.parent/'baseline.private.json').read_text())['candidate']
        else:
            facts=json.loads((directory.parent/'symbols.private.json').read_text())
            candidate=dict(commit=facts['sourceCommit'],sha256=facts['executableSha256'],
                           executable=str(directory.parent/'release-bin/codex-x86_64-unknown-linux-musl'))
    candidate_verified=digest(candidate['executable'])==candidate['sha256']
    observed=[]
    for row in rpc:
        if row['stage']=='process_started':
            observed.extend(p['executable'] for p in row.get('processes',[]))
            if row.get('executable'):observed.append(row['executable'])
    candidate_verified=candidate_verified and candidate['executable'] in observed
    identities=dict(thread=None,call=None,realtime=None,productVoice=None,serverSession=None)
    for row in life:
        stage=row['stage']
        if stage=='thread_created':identities['thread']=row['threadId']
        if stage=='call_created':identities['call']=row['callId']
        if stage in ('configuration_read','thread_created','prompt_selected','call_created','media_activated','local_close_requested'):
            event(stage,row['atUnixNs'],'lifecycle')
        if stage=='media_state' and row.get('state')=='connected':event('media_active',row['atUnixNs'],'lifecycle')
    for row in rpc:
        if row.get('stage')=='rpc_sent':
            params=row.get('params',{})
            nested=params.get('params',{}) if row.get('method')=='worker/sessionCall' else params
            if nested.get('transport',{}).get('type')=='existingCall':
                identities['realtime']=nested.get('realtimeSessionId')
        message=row.get('message',{})
        message=message.get('params',{}).get('event',message)
        if message.get('method')=='turn/started':event('backend_admitted',row['atUnixNs'],'rpc')
        if message.get('method')=='thread/realtime/closed':event('local_terminal_notification',row['atUnixNs'],'rpc',reason=message.get('params',{}).get('reason'))
    errors=[]; captions=[]; sideband=[]
    def wire(row,at,source,direction='in'):
        kind=row.get('type')
        if kind in ('session.started','session.created'):
            event('sideband_upgraded' if source=='sideband' else 'call_session_started',at,source)
            if source=='primary':identities['serverSession']=row.get('session',{}).get('id')
        if kind=='session.context.append':event('context_sent',at,source,direction=direction)
        if kind=='session.context.appended':event('context_acknowledged',at,source)
        if kind=='session.input_audio.append':event('input_audio',at,source)
        if kind=='session.close':event('local_close_requested',at,source,reason='provider-error' if errors else 'local-request')
        if kind=='session.closed':event('remote_session_closed',at,source)
        if kind=='error':
            error=row.get('error',{})
            item=dict(type=error.get('type'),code=error.get('code'),param=error.get('param'),
                      messageSha256=hashlib.sha256(str(error.get('message','')).encode()).hexdigest())
            errors.append(item);event('provider_error',at,source,**item)
        if kind in ('input_transcript.added','output_transcript.added','turn.done'):
            text=row.get('item',{}).get('text') if kind!='turn.done' else row.get('turn',{}).get('transcript')
            role=('user' if kind=='input_transcript.added' else 'assistant') if kind!='turn.done' else row.get('turn',{}).get('role')
            if isinstance(text,str):
                item=dict(role=role,textSha256=hashlib.sha256(text.encode()).hexdigest(),textBytes=len(text.encode()))
                captions.append(item);event('caption',at,source,**item)
    for row in primary:
        if row.get('event'):wire(row['event'],row['atUnixNs'],'primary')
    for row in media:
        if row['stage']=='output_audio':event('output_audio',row['atUnixNs'],'media',signalFrames=row['signalFrames'])
    if result['backend']=='xcsh':
        traces=list((directory/'traces').glob('voice-*.jsonl'))
        if not traces:limitations.append('sideband-trace-missing')
        for path in traces:
            rows=[json.loads(x) for x in path.read_text().splitlines()]
            complete=rows[-1].get('kind')=='footer' and rows[-1].get('complete') is True
            events=[x for x in rows if x.get('kind')=='event']
            complete=complete and [x['sequence'] for x in events]==list(range(1,len(events)+1))
            candidate_verified=candidate_verified and rows[0].get('sourceCommit')==candidate['commit'] and rows[0].get('artifactSha256')==candidate['sha256']
            captures[path.name]=dict(path=str(path),sha256=digest(path),complete=complete,
                                     candidateCommit=rows[0].get('sourceCommit'),artifactSha256=rows[0].get('artifactSha256'))
            for row in events:
                at=int((rows[0]['startedAtUnixMs']+row['elapsedMs'])*1000000)
                sideband.append(row.get('message',{}).get('type'))
                wire(row.get('message',{}),at,'sideband',row.get('direction'))
                if row.get('layer')=='connection' and row.get('message',{}).get('type')=='closed':event('websocket_closed',at,'sideband')
    else:
        path=directory/'backend.private.log'
        captures['stock-wire-log']=dict(path=str(path),sha256=digest(path),complete=captures['rpc']['complete'])
        for line in path.read_text().splitlines():
            line=re.sub(r'\x1b\[[0-9;]*m','',line)
            match=re.search(r'realtime websocket (event|request): (\{.*\})',line)
            if not match:continue
            try:row=json.loads(match[2])
            except ValueError:limitations.append('stock-wire-json-incomplete');continue
            at=unix_ns(line.split()[0])
            sideband.append(row.get('type'))
            wire(row,at,'sideband','out' if match[1]=='request' else 'in')
        limitations.append('stock-upstream-event-sequence-not-exposed')
    durable=[]; tasks=[]
    for path in (directory/'codex-home/sessions').rglob('*.jsonl'):
        rows=[json.loads(x) for x in path.read_text().splitlines()]
        captures['durable-history-native']=dict(path=str(path),sha256=digest(path),complete=True)
        for row in rows:
            data=row.get('payload',{});at=unix_ns(row.get('timestamp'))
            if row.get('type')=='realtime_item' and data.get('type')=='realtime_session_closed':
                durable.append(data.get('outcome'));event('durable_terminal',at,'history',outcome=durable[-1])
    for path in (directory/'agent/sessions').rglob('*.jsonl'):
        rows=[json.loads(x) for x in path.read_text().splitlines()]
        captures['durable-history']=dict(path=str(path),sha256=digest(path),complete=True)
        for row in rows:
            data=row.get('data',{});at=unix_ns(row.get('timestamp'))
            if data.get('kind')=='voiceTimeline' and data.get('item',{}).get('type')=='realtimeSessionClosed':
                durable.append(data['item'].get('outcome'));event('durable_terminal',at,'history',outcome=durable[-1])
            if data.get('kind')=='voiceTaskDelegation':tasks.append(data)
            if data.get('kind')=='startupPolicyViolation':event('guard_decision',at,'history',reason=data.get('reason'))
    path=directory/'history.private.json'
    if path.exists():captures['history-view']=dict(path=str(path),sha256=digest(path),complete=True)
    else:limitations.append('history-view-missing')
    for key,name in (('packets','tunnels'),('sidebandPackets','sideband')):
        if key not in result:
            if name=='sideband':limitations.append('sideband-packets-missing')
            continue
        capture=dict(result[key]);path=directory/(name+'.private.pcap')
        capture['path']=str(path)
        capture['complete']=capture['complete'] and digest(path)==capture['sha256'] and capture['drops']==0
        lost=subprocess.check_output(['tshark','-r',str(path),'-Y','tcp.analysis.lost_segment','-T','fields','-e','frame.number'],
                                     text=True,stderr=subprocess.DEVNULL)
        capture['tcpSequenceGaps']=len(lost.splitlines())
        capture['complete']=capture['complete'] and not lost.strip()
        captures[name+'-packets']=capture
    timeline.sort(key=lambda row:(row['atUnixNs'],row['source']))
    for index,row in enumerate(timeline,1):row['sequence']=index
    terminal='local-provider-error' if errors and durable==['failed'] else 'local-request' if durable==['ended'] else 'unverified'
    receipt=dict(schemaVersion=1,directory=str(directory),backend=result['backend'],candidate=candidate,
                 candidateVerified=candidate_verified,identities=identities,
                 creationInstructionsSha256=result['creationInstructionsSha256'],
                 configuredInstructionsSha256=result.get('configuredInstructionsSha256'),
                 startupAudio=result['startupAudio'],backendAdmissions=len(tasks),terminal=terminal,
                 providerErrors=errors,captions=captions,sidebandEventTypes=dict(collections.Counter(sideband)),
                 captures=captures,timeline=timeline,limitations=sorted(set(limitations)),
                 productVoiceIdVisible=False,physicalAcceptance=False,rootCauseEstablishedForPhone=False)
    receipt['capturesComplete']=candidate_verified and all(c['complete'] for c in captures.values()) and 'sideband-packets-missing' not in limitations
    receipt['normalizerSha256']=digest(__file__)
    receipt['inputReceiptSha256']=digest(directory/'result.private.json')
    target=directory/('normalized-lifecycle-'+receipt['normalizerSha256'][:12]+'.private.json')
    with target.open('x') as stream:stream.write(json.dumps(receipt,indent=2)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('abba_receipt');args=parser.parse_args()
    rows=json.loads(pathlib.Path(args.abba_receipt).read_text())
    for row in rows:
        receipt=seal(row['directory'])
        print(json.dumps({k:receipt[k] for k in ('backend','directory','terminal','startupAudio','capturesComplete','limitations')}))
