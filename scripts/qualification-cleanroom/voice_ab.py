"""Private native-startup comparison evidence; never grants physical acceptance."""
import argparse
import hashlib
import json
import re

COLLECTORS = ('rpc', 'sideband', 'history', 'process', 'packets', 'media')
BINDINGS = ('host', 'accountSha256', 'audioSha256', 'model', 'effort', 'voiceModel',
            'voice', 'timingSha256', 'configurationSha256', 'creationInstructionsSha256',
            'creationInstructionBytes', 'ownership', 'build')
AXES = {'backend': None, 'creation-instructions': 'creationInstructionsSha256',
        'ownership': 'ownership', 'build': 'build'}


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def normalize(events):
    """Same-host Unix nanoseconds, preserving source and sequence on equal clocks."""
    result = []
    for event in sorted(events, key=lambda e: (e['atUnixNs'], e['source'], e['sequence'])):
        item = {k: v for k, v in event.items() if k != 'text'}
        if isinstance(event.get('text'), str):
            item.update(textSha256=sha(event['text']), textBytes=len(event['text'].encode()))
        result.append(item)
    return result


def assess_attempt(row):
    failures = []
    events = row.get('events', [])
    if not events or any(not isinstance(e.get('atUnixNs'), int) or not e.get('stage')
                         or not e.get('source') or not isinstance(e.get('sequence'), int) for e in events):
        return dict(evidenceComplete=False, quietStartup=False, closure='incomplete-finalization',
                    failures=['timeline-missing-or-invalid'], physicalAcceptance=False)
    first = min(e['atUnixNs'] for e in events)
    for name in COLLECTORS:
        capture = row.get('collectors', {}).get(name, {})
        if not (capture.get('complete') is True and valid_sha(capture.get('sha256'))
                and capture.get('sequenceComplete') is True and capture.get('drops') == 0
                and isinstance(capture.get('armedAtUnixNs'), int) and capture['armedAtUnixNs'] <= first):
            failures.append('capture-incomplete:'+name)
        if name == 'packets' and not (isinstance(capture.get('packets'), int) and capture['packets'] > 0):
            failures.append('packets-missing')
    for source in set(e['source'] for e in events):
        sequences = [e['sequence'] for e in events if e['source'] == source]
        if sequences != list(range(1, len(sequences)+1)):
            failures.append('sequence-gap:'+source)
    candidate = row.get('candidate', {})
    if (candidate != row.get('expectedCandidate') or not valid_sha(candidate.get('sha256'))
            or not re.fullmatch('[a-f0-9]{40}', str(candidate.get('commit', '')))):
        failures.append('candidate-mismatch')
    bindings = row.get('bindings', {})
    for key in BINDINGS:
        if bindings.get(key) is None:
            failures.append('binding-missing:'+key)
    if any(not row.get('identities', {}).get(k) for k in ('thread', 'call', 'realtime', 'voice')):
        failures.append('identity-mapping-incomplete')
    if row.get('outstandingTasks') != 0 or row.get('outstandingTranscriptTails') != 0:
        failures.append('outstanding-work')
    if row.get('transcriptsPreserved') is not True:
        failures.append('transcripts-unverified')
    timeline = normalize(events)
    stages = {e['stage'] for e in timeline}
    if row.get('scope') == 'native-startup' and not {'configuration_read', 'thread_created',
            'prompt_selected', 'call_created', 'media_active', 'sideband_upgraded'} <= stages:
        failures.append('native-startup-incomplete')
    caller = min((e['atUnixNs'] for e in events if e['stage'] == 'caller_speech'), default=float('inf'))
    early = [e for e in events if e['atUnixNs'] < caller and
             ((e['stage'] == 'caption_delta' and e.get('role') == 'assistant'
               and isinstance(e.get('text'), str) and bool(e['text'].strip()))
              or (e['stage'] == 'output_audio' and e.get('signalFrames', 0) > 0))]
    admissions = [e for e in events if e['stage'] == 'backend_admitted' and e['atUnixNs'] < caller]
    audio = row.get('startupAudio', {})
    if not (isinstance(audio.get('frames'), int) and audio['frames'] > 0
            and isinstance(audio.get('signalFrames'), int) and audio['signalFrames'] >= 0):
        failures.append('startup-audio-unverified')
    if 'durable_terminal' not in stages or 'session_closed' not in stages or 'websocket_closed' not in stages:
        closure = 'incomplete-finalization'
        failures.append('terminal-outcome-incomplete')
    elif any(e['stage'] == 'local_close_requested' and e.get('reason') == 'startup-guard' for e in events):
        closure = 'local-guard'
    elif 'local_close_requested' in stages:
        closure = 'local-request'
    else:
        closure = 'remote'
    if 'sideband_upgrade_failed' in stages:
        closure = 'failed-upgrade'
    output = [e['atUnixNs'] for e in events if e['stage'] == 'output_audio' and e.get('signalFrames', 0) > 0]
    ack = min((e['atUnixNs'] for e in events if e['stage'] == 'context_acknowledged'), default=float('inf'))
    return dict(evidenceComplete=not failures, quietStartup=not failures and not early and not admissions
                and audio.get('signalFrames') == 0,
                startupViolation=bool(early or admissions or audio.get('signalFrames', 0)),
                outputBeforeContextAcknowledgment=any(t < ack for t in output),
                closure=closure, failures=failures, timeline=timeline, physicalAcceptance=False)


def evaluate_abba(rows, axis='backend'):
    if axis not in AXES:
        raise ValueError('unknown comparison axis')
    failures = []
    if len(rows) != 4:
        return dict(matchedComparison=False, discriminating=False, failures=['four-attempts-required'],
                    physicalAcceptance=False, rootCauseEstablished=False)
    assessments = [assess_attempt(row) for row in rows]
    variable = 'backend' if axis == 'backend' else AXES[axis]
    variants = [r.get(variable) if axis == 'backend' else r.get('bindings', {}).get(variable) for r in rows]
    if not (variants[0] == variants[3] and variants[1] == variants[2] and variants[0] != variants[1]):
        failures.append('abba-order')
    for key in BINDINGS:
        if key == AXES[axis] or (axis == 'creation-instructions' and key == 'creationInstructionBytes'):
            continue
        if any(r.get('bindings', {}).get(key) != rows[0].get('bindings', {}).get(key) for r in rows):
            failures.append('confounded:'+key)
    if axis != 'backend' and len({r.get('backend') for r in rows}) != 1:
        failures.append('confounded:backend')
    if any(r.get('scope') != 'native-startup' for r in rows):
        failures.append('component-only')
    if not all(a['evidenceComplete'] for a in assessments):
        failures.append('incomplete-attempts')
    violations = [a.get('startupViolation', False) for a in assessments]
    discriminating = (violations[0] == violations[3] and violations[1] == violations[2]
                      and violations[0] != violations[1])
    if not discriminating:
        failures.append('control-did-not-reproduce' if not any(violations) else 'inconsistent-outcomes')
    return dict(matchedComparison=not failures, discriminating=discriminating and not failures,
                failures=failures, attempts=assessments, physicalAcceptance=False,
                rootCauseEstablished=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipt')
    parser.add_argument('--axis', choices=AXES, default='backend')
    args = parser.parse_args()
    with open(args.receipt) as stream:
        result = evaluate_abba(json.load(stream), args.axis)
    print(json.dumps(result))
    raise SystemExit(0 if result['matchedComparison'] else 1)
