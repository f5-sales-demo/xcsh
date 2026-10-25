"""Read-only, session-aware voice evidence observer. Never submits or replays work."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import time


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def visible(text):
    # Terminal display is concise and excludes personal address/token patterns.
    text = re.sub(r'[\w.+-]+@[\w.-]+', '[email]', text)
    text = re.sub(r'(?i)(bearer\s+|(?:token|password|secret)\s*[:=]\s*)\S+', r'\1[private]', text)
    return text[:1500]


def derive(history):
    """Keep call IDs, task owners, and transcript-only replies distinct."""
    sessions, tasks, delegation_sessions, delegation_texts, current_task = {}, {}, {}, {}, None
    def session(ident):
        return sessions.setdefault(ident, dict(id=ident, lifecycle='observed', transcripts=[], taskIds=[]))
    def task(ident):
        return tasks.setdefault(ident, dict(id=ident, status='unknown', admissions=[], tools=[], results={}, final=[], sessionId=None))
    for index, row in enumerate(history):
        data = row.get('data', {})
        kind = data.get('kind')
        if kind == 'voiceTimeline':
            item = data.get('item', {})
            ident = item.get('realtimeSessionId')
            if ident and item.get('type') in ['realtimeSessionStarted', 'realtimeSessionClosed']:
                session(ident)['lifecycle'] = 'open' if item['type'] == 'realtimeSessionStarted' else 'closed'
                session(ident)['outcome'] = item.get('outcome')
        elif kind == 'voiceStartupAudioDiagnostic' and data.get('realtimeSessionId'):
            session(data['realtimeSessionId'])['startupAudio'] = {k: data[k] for k in
                ('frames', 'signalFrames', 'maxRms', 'peak', 'callerObserved')}
        elif kind == 'transcript':
            ident = data.get('realtimeSessionId')
            if ident:
                session(ident)['transcripts'].append(dict(index=index, role=data['role'], text=data['text'], sha256=sha(data['text'])))
        elif kind == 'delegation' and data.get('realtimeSessionId'):
            delegation_sessions[data['key']] = data['realtimeSessionId']
            if data.get('text'):
                delegation_texts[data['key']] = data['text']
        elif kind == 'voiceTaskDelegation':
            ident = data['taskId']
            owner = delegation_sessions.get(data['delegationId'])
            task(ident)['sessionId'] = owner
            task(ident)['revision'] = data.get('revision')
            task(ident)['request'] = delegation_texts.get(data['delegationId'], '')
            if owner and ident not in session(owner)['taskIds']:
                session(owner)['taskIds'].append(ident)
        elif kind == 'turnStarted':
            current_task = data['id']
            task(current_task).update(status='running', startIndex=index)
        elif kind == 'requestAccepted':
            current_task = data['turnId']
            task(current_task)['admissions'].append(dict(method=data['method'], clientIdSha256=sha(data.get('clientUserMessageId'))))
        elif kind == 'turnCompleted':
            task(data['id']).update(status=data['status'], endIndex=index)
            if current_task == data['id']:
                current_task = None
        if row.get('type') == 'message' and current_task:
            message = row['message']
            target = task(current_task)
            if message.get('role') == 'assistant':
                for part in message.get('content', []):
                    if part.get('type') == 'toolCall':
                        target['tools'].append(dict(id=part['id'], name=part['name'], argumentsSha256=sha(part['arguments'])))
                    elif part.get('type') == 'text':
                        target['final'].append(part['text'])
            elif message.get('role') == 'toolResult':
                target['results'][message['toolCallId']] = dict(isError=message.get('isError'), sha256=sha(message))
                if message.get('toolName') in ['person_profile', 'machine_profile'] and message.get('isError') is False:
                    text = '\n'.join(p.get('text', '') for p in message.get('content', []) if p.get('type') == 'text')
                    try:
                        value = json.loads(text)
                    except ValueError:
                        value = None
                    if isinstance(value, dict):
                        target.setdefault('canonicalProfileResults', []).append(dict(tool=message['toolName'],
                            resultSha256=sha(value), state=value.get('state'), factsEmpty=value.get('facts') == {}))
    # Failed startup speech can be retained only as a timeline segment.
    # Merge missing segments without duplicating canonical transcript records.
    for index, row in enumerate(history):
        data = row.get('data', {})
        value = data.get('item', {})
        if data.get('kind') != 'voiceTimeline' or value.get('type') != 'transcriptSegment':
            continue
        ident, role, text = value.get('realtimeSessionId'), value.get('role'), value.get('text')
        if not ident or role not in ('user', 'assistant') or not isinstance(text, str):
            continue
        target = session(ident)['transcripts']
        if not any(t['role'] == role and t['text'] == text for t in target):
            target.append(dict(index=index, role=role, text=text, sha256=sha(text), source='timeline'))
    for item in sessions.values():
        item['transcripts'].sort(key=lambda t: t['index'])
    for item in tasks.values():
        item['verifiedToolCount'] = sum(t['id'] in item['results'] and item['results'][t['id']]['isError'] is False for t in item['tools'])
        item['allToolsVerified'] = bool(item['tools']) and item['verifiedToolCount'] == len(item['tools'])
        item['completionVerified'] = item['status'] == 'completed'
    for item in sessions.values():
        transcripts = item['transcripts']
        first_user = next((i for i, t in enumerate(transcripts) if t['role'] == 'user'), len(transcripts))
        early = [t for t in transcripts[:first_user] if t['role'] == 'assistant']
        item['startupObservations'] = dict(assistantBeforeCaller=bool(early), userTranscriptObserved=first_user < len(transcripts),
            selfDialogueBeforeCaller=any(re.search(r'(?i)\bwho are you\s*\?', t['text']) and re.search(r"(?i)\bi(?: am|'m|’m)\b", t['text']) for t in early),
            startupSilenceRequirement='best-effort')
        audio = item.get('startupAudio')
        item['startupObservations']['audioAcceptance'] = (
            'signal-observed' if audio and audio['signalFrames'] else
            'no-signal-observed' if audio and audio['frames'] else 'unverified')
        # Report each real caller's profile lookup separately from startup speech.
        # This is execution qualification; audio usefulness still needs human ears.
        item['profileRequests'] = []
        normalize = lambda text: ' '.join(re.findall(r'[a-z0-9]+', text.lower()))
        item['identityRequests'] = []
        for i, transcript in enumerate(transcripts):
            if transcript['role'] != 'user' or normalize(transcript['text']) != 'who are you':
                continue
            following = transcripts[i + 1:]
            next_user = next((j for j, t in enumerate(following) if t['role'] == 'user'), len(following))
            answer = ' '.join(t['text'] for t in following[:next_user] if t['role'] == 'assistant')
            status = 'pending'
            if answer:
                words = normalize(answer)
                branded = re.search(r'\bxcsh\b|\bek see shell\b|\bxc shell\b', words)
                status = 'xcsh-identity-verified' if branded and 'chatgpt' not in words else 'identity-mismatch'
            item['identityRequests'].append(dict(transcriptIndex=transcript['index'],
                requestSha256=transcript['sha256'], identityStatus=status, answerSha256=sha(answer)))
        for i, transcript in enumerate(transcripts):
            if transcript['role'] != 'user' or 'what do you know about me' not in normalize(transcript['text']):
                continue
            text = normalize(transcript['text'])
            owners = [tasks[t] for t in item['taskIds'] if text in normalize(tasks[t].get('request', ''))]
            subsequent = transcripts[i + 1:]
            next_user = next((j for j, t in enumerate(subsequent) if t['role'] == 'user'), len(subsequent))
            answered = any(t['role'] == 'assistant' for t in subsequent[:next_user])
            status = 'pending'
            if len(owners) == 1 and owners[0]['status'] != 'running':
                owner = owners[0]
                canonical = owner.get('canonicalProfileResults', [])
                status = 'canonical-read-verified' if owner['completionVerified'] and owner['allToolsVerified'] and any(v['tool'] == 'person_profile' for v in canonical) else 'canonical-read-missing'
            elif not owners and answered:
                status = 'no-backend-delegation'
            item['profileRequests'].append(dict(transcriptIndex=transcript['index'], requestSha256=transcript['sha256'],
                taskIds=[t['id'] for t in owners], executionStatus=status))
    return dict(sessions=list(sessions.values()), tasks=list(tasks.values()),
                outstandingTaskIds=[t['id'] for t in tasks.values() if t['status'] == 'running'])


def read_jsonl_prefix(path):
    """Ignore only a concurrently written final line; never hide an interior gap."""
    data = pathlib.Path(path).read_bytes()
    lines = data.splitlines(keepends=True)
    pending = bool(lines and not lines[-1].endswith(b'\n'))
    if pending:
        lines = lines[:-1]
    return [json.loads(line) for line in lines], pending, hashlib.sha256(data).hexdigest()


def trace_state(path, candidate):
    rows, pending, digest = read_jsonl_prefix(path)
    if not rows:
        return dict(path=str(path), valid=False, failures=['manifest-missing'], partialLine=pending)
    failures = []
    if rows[0].get('kind') != 'manifest':
        failures.append('manifest-missing')
    if rows[0].get('sourceCommit') != candidate['commit'] or rows[0].get('artifactSha256') != candidate['sha256']:
        failures.append('candidate-mismatch')
    footer = rows[-1] if rows[-1].get('kind') == 'footer' else None
    events = rows[1:-1] if footer else rows[1:]
    if any(r.get('kind') != 'event' or r.get('sequence') != i + 1 for i, r in enumerate(events)):
        failures.append('sequence-gap')
    if footer and (not footer.get('complete') or footer.get('events') != len(events)):
        failures.append('invalid-footer')
    outgoing = [r for r in events if r.get('direction') == 'out']
    first_user = next((r['sequence'] for r in events if r.get('message', {}).get('turn', {}).get('role') == 'user'), None)
    return dict(path=str(path), sha256=digest, valid=not failures, failures=failures, events=len(events),
                complete=bool(footer and not failures and not pending), partialLine=pending,
                applicationSentEventTypes=sorted({str(r.get('message', {}).get('type')) for r in outgoing}),
                applicationInputBeforeCaller=any(r.get('message', {}).get('type') in ['input_text.append', 'session.input_text.append', 'conversation.item.create', 'response.create']
                    and (first_user is None or r['sequence'] < first_user) for r in outgoing))


def report_herdr(config, state, sequence):
    """Only the observer's own inherited Herdr binding may report its owned pane."""
    binding = config.get('herdr', {})
    executable = binding.get('cli')
    pane = binding.get('nativePane')
    if not executable or not pane or os.environ.get('HERDR_ENV') != '1':
        return None
    status = 'working' if state['outstandingTaskIds'] else 'idle'
    args = [executable, 'pane', 'report-agent', pane, '--source', 'voice-qualification-observer',
        '--agent', 'xcsh', '--state', status, '--seq', str(sequence),
        '--message', 'Observed durable task state; no task submitted by observer',
        '--agent-session-id', config['threadId'], '--agent-session-path', config['historyPath']]
    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
    return result.returncode


def observe(config, once=False):
    output = pathlib.Path(config['outputDirectory'])
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    journal = output / 'observer-events.jsonl'
    previous, revision = None, 0
    herdr_sequence = time.time_ns() // 1_000_000
    heartbeat = 0
    candidate = config['candidate']
    expected = candidate['sha256']
    if hashlib.sha256(pathlib.Path(candidate['executable']).read_bytes()).hexdigest() != expected:
        raise ValueError('Pinned executable changed')
    print(json.dumps(dict(observer='ready', threadId=config['threadId'], automation='transcripts,tools,outcomes,call IDs', workSubmitted=False)), flush=True)
    while True:
        try:
            history, pending, history_hash = read_jsonl_prefix(config['historyPath'])
            state = derive(history)
            captures = [trace_state(p, candidate) for directory in config['captureDirectories']
                        for p in sorted(pathlib.Path(directory).glob('*.jsonl'))]
            # Private source text remains in original history. Receipts contain hashes
            # and execution facts; safe terminal text can be inspected through Herdr.
            receipt_sessions = [dict(s, transcripts=[dict(index=t['index'], role=t['role'], sha256=t['sha256']) for t in s['transcripts']]) for s in state['sessions']]
            receipt_tasks = [dict(t, final=[sha(text) for text in t['final']], request=sha(t.get('request', ''))) for t in state['tasks']]
            receipt = dict(candidate=candidate, threadId=config['threadId'], historySha256=history_hash,
                completeHistoryRecords=len(history), partialHistoryLine=pending, sessions=receipt_sessions,
                tasks=receipt_tasks, outstandingTaskIds=state['outstandingTaskIds'], captures=captures,
                observationOnly=True, noWorkSubmittedOrReplayed=True, physicalAudioObserved=False,
                physicalPhoneRenderingObserved=False, acceptanceClaim=False)
            # Checkpoints and unrelated host polls change file hashes continuously.
            # Emit progress only for new conversation/task state or integrity changes.
            current = sha(dict(sessions=receipt_sessions, tasks=receipt_tasks,
                outstanding=state['outstandingTaskIds'], historyPartial=pending,
                captures=[dict(path=x['path'], valid=x['valid'], complete=x.get('complete'), failures=x['failures'], inputBeforeCaller=x.get('applicationInputBeforeCaller')) for x in captures]))
            if current != previous:
                revision += 1
                receipt['revision'] = revision
                target = output / 'latest.json'
                temporary = output / 'latest.tmp'
                temporary.write_text(json.dumps(receipt, indent=2) + '\n')
                temporary.chmod(0o600)
                temporary.replace(target)
                with journal.open('a') as stream:
                    stream.write(json.dumps(dict(revision=revision, receiptSha256=sha(receipt), atUnixMs=time.time_ns() // 1_000_000)) + '\n')
                journal.chmod(0o600)
                print(json.dumps(dict(revision=revision, sessions=[dict(id=s['id'], lifecycle=s['lifecycle'], tasks=len(s['taskIds']), startup=s['startupObservations'], identityRequests=s['identityRequests'], profileRequests=s['profileRequests']) for s in state['sessions']],
                    tasks=[dict(id=t['id'], status=t['status'], tools=[x['name'] for x in t['tools']], verifiedTools=t['verifiedToolCount']) for t in state['tasks'][-5:]],
                    outstanding=state['outstandingTaskIds'], captureFailures=[f for x in captures for f in x['failures']])), flush=True)
                for session in state['sessions'][-2:]:
                    for transcript in session['transcripts'][-2:]:
                        print(session['id'][:8] + ' ' + transcript['role'] + ': ' + visible(transcript['text']), flush=True)
                previous = current
                herdr_sequence += 1
                try:
                    code = report_herdr(config, state, herdr_sequence)
                    if code:
                        print(json.dumps(dict(herdrReportFailed=code, noWorkReplay=True)), flush=True)
                except (OSError, subprocess.TimeoutExpired):
                    print(json.dumps(dict(herdrReportFailed='unavailable', noWorkReplay=True)), flush=True)
        except (OSError, ValueError, KeyError) as error:
            # Recording failure affects evidence only. Keep observing; never launch,
            # cancel, or retry any application task as recovery.
            print(json.dumps(dict(observerFailure=type(error).__name__, acceptanceClaim=False, noWorkReplay=True)), flush=True)
        if once:
            return
        if time.monotonic() - heartbeat >= 30:
            print(json.dumps(dict(observer='watching', revision=revision, atUnixMs=time.time_ns() // 1_000_000)), flush=True)
            heartbeat = time.monotonic()
        time.sleep(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('config')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    observe(json.loads(pathlib.Path(args.config).read_text()), args.once)
