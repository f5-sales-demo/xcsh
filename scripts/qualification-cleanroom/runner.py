"""Candidate-bound private voice/lifecycle runner; resumption never replays work.

Adapters are explicit argv arrays whose executables are frozen with the spec.
Collectors own their footer; the runner never manufactures capture completeness.
"""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import time

PHRASES = [
    'Who are you?', 'What do you know about me?', 'Please repeat that.',
    'What files are in this project?', 'Which context and workspace are active?',
    'What does my saved machine profile say, separately from the computer running xcsh and this workspace?',
    'Tell me about xcsh’s capabilities, selected execution model and reasoning, host, and workspace.',
]
OPERATIONS = ('prepare', 'pair', 'arm', 'observe', 'inspect', 'close', 'seal', 'resume')


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def private_path(path, directory=False):
    path = pathlib.Path(path).absolute()
    if path.resolve() != path:
        raise ValueError('symlink in private path')
    info = path.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('private path owner or mode mismatch')
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError('private path type mismatch')
    return path


def write(path, data):
    path = pathlib.Path(path)
    with path.open('x') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')
    path.chmod(0o600)


def tree(root):
    root = pathlib.Path(root)
    result = {}
    for path in sorted(root.rglob('*')):
        if any(part in ('.git', 'node_modules', '__pycache__') for part in path.relative_to(root).parts):
            continue
        if path.is_symlink():
            raise ValueError('mutable symlink in frozen source')
        if path.is_file():
            result[str(path.relative_to(root))] = digest(path)
    if not result:
        raise ValueError('empty frozen source')
    return result


def freeze(spec):
    candidate = spec['candidate']
    if not re.fullmatch('[0-9a-f]{40}', candidate['commit']) or digest(candidate['executable']) != candidate['sha256']:
        raise ValueError('candidate mismatch')
    fixtures = spec.get('fixtureHashes', {})
    if any(digest(path) != expected for path, expected in fixtures.items()):
        raise ValueError('fixture hash mismatch')
    return dict(candidate=candidate, sources={name: tree(path) for name, path in spec['sources'].items()},
                adapters={name: {arg: digest(arg) for arg in argv if pathlib.Path(arg).is_file()}
                          for name, argv in spec['adapters'].items()},
                effectiveConfiguration=spec['effectiveConfiguration'], fixtureHashes=fixtures)


def campaign_cases(ledger):
    gates = ledger['gates']
    plugins = ledger['marketplace']
    rows = gates + [row for plugin in plugins for row in plugin['gates']]
    if len(gates) != 34 or len(plugins) != 23 or sum(len(p['gates']) for p in plugins) != 299:
        raise ValueError('campaign scope was reduced')
    if len({row['id'] for row in rows}) != 333:
        raise ValueError('duplicate campaign gate')
    # History is archived separately; no previous status is promoted here.
    return {row['id']: dict(requirement=row['requirement'], status='incomplete') for row in rows}


def adapter(spec, name, output):
    argv = spec['adapters'].get(name)
    if not argv or not all(isinstance(arg, str) for arg in argv):
        raise ValueError('required adapter unavailable: ' + name)
    env = dict(os.environ)
    env.update(spec.get('environment', {}))
    # Long-running setup is governed by its controller, up to two hours.
    limit = 7200 if name in ('setup', 'destroy', 'deploy') else 120
    with pathlib.Path(output).open('xb') as stream:
        result = subprocess.run(argv, cwd=spec['workspace'], env=env, stdout=stream,
                                stderr=subprocess.STDOUT, timeout=limit, check=False)
    if result.returncode:
        raise ValueError('adapter failed; inspect private output: ' + name)
    return load(output)


def field(value, dotted):
    for component in dotted.split('.'):
        value = value[int(component)] if isinstance(value, list) else value[component]
    return value


def assertion(rule):
    """Derive acceptance from source evidence rather than reported success flags."""
    value = load(rule['path'])
    kind = rule['kind']
    if kind == 'equals':
        if rule['field'].split('.')[-1] in ('pass', 'passed', 'success', 'accepted', 'qualified', 'automatedPass'):
            raise ValueError('reported acceptance cannot prove itself')
        return field(value, rule['field']) == rule['expected']
    if kind == 'empty':
        return field(value, rule['field']) in ([], {})
    if kind == 'plan-no-change':
        changes = value['resource_changes']
        return bool(changes) and all(row['change']['actions'] == ['no-op'] for row in changes)
    if kind == 'saved-plan':
        plan = field(value, rule['field'])
        content = plan.get('content')
        return (isinstance(content, str) and bool(content.strip())
                and hashlib.sha256(content.encode()).hexdigest() == plan.get('sha256'))
    if kind == 'traffic':
        samples, logs = value['samples'], value['workloadLogs']
        expected = rule['fixtureId']
        nonces = [row['nonce'] for row in samples]
        return (bool(samples) and len(set(nonces)) == len(nonces)
                and all(row['body']['fixtureId'] == expected and row['body']['nonce'] == row['nonce']
                        and row['status'] == 200 and row['ceUid'] == rule['ceUid']
                        and row['loadBalancerUid'] == rule['loadBalancerUid'] for row in samples)
                and all(any(log['nonce'] == row['nonce'] and log['fixtureId'] == expected
                            and log['sourceIp'] == rule['ceInsideIp'] for log in logs) for row in samples))
    raise ValueError('unknown assertion kind')


def observer_module():
    path = pathlib.Path(__file__).with_name('observer.py')
    spec = importlib.util.spec_from_file_location('voice_observer', path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def capture_paths(binding):
    paths = list(binding['capturePaths'])
    if binding.get('captureDirectory'):
        paths += [str(p) for p in sorted(pathlib.Path(binding['captureDirectory']).glob('*.jsonl'))
                  if p.name not in binding['captureBaseline']]
    if binding.get('diagnosticDirectory'):
        paths += [str(p) for p in sorted(pathlib.Path(binding['diagnosticDirectory']).glob('*.jsonl'))
                  if p.name not in binding['diagnosticBaseline']]
    return list(dict.fromkeys(paths))


def inspect_attempt(spec, attempt):
    observer = observer_module()
    binding = load(attempt / 'arm.json')
    history, pending, history_hash = observer.read_jsonl_prefix(binding['historyPath'])
    # Include only this attempt's fresh capture paths, never old successful files.
    traces = [observer.trace_state(path, spec['candidate']) for path in capture_paths(binding)]
    derived = observer.derive(history[binding['historyStartRecord']:])
    sessions = derived['sessions']
    call_id = binding.get('callId')
    session = next((s for s in sessions if s['id'] == call_id), None) if call_id else (sessions[0] if len(sessions) == 1 else None)
    failures = []
    if not session:
        failures.append('call-not-observed')
    else:
        if session['lifecycle'] != 'closed':
            failures.append('call-not-closed')
        if session.get('outcome') == 'failed':
            failures.append('call-failed')
        if session['startupObservations']['audioAcceptance'] == 'signal-observed':
            failures.append('unsolicited-startup-audio')
        if session['startupObservations']['assistantBeforeCaller']:
            failures.append('unsolicited-startup-speech')
        if not session['startupObservations']['userTranscriptObserved']:
            failures.append('caller-not-observed')
        if any(r['identityStatus'] != 'xcsh-identity-verified' for r in session['identityRequests']):
            failures.append('identity-answer-unverified')
        if any(r['executionStatus'] != 'canonical-read-verified' for r in session['profileRequests']):
            failures.append('canonical-profile-read-unverified')
        phrase = spec['cases'][binding['caseId']].get('spokenRequest')
        if phrase:
            normalize = lambda text: ' '.join(re.findall('[a-z0-9]+', text.lower()))
            if not any(t['role'] == 'user' and normalize(t['text']) == normalize(phrase) for t in session['transcripts']):
                failures.append('exact-caller-request-missing')
        if any(not t['completionVerified'] or (t['tools'] and not t['allToolsVerified']) for t in derived['tasks']):
            failures.append('task-or-tool-incomplete')
    if pending or derived['outstandingTaskIds']:
        failures.append('history-or-task-incomplete')
    if not traces or any(not t['complete'] or t['applicationInputBeforeCaller'] for t in traces):
        failures.append('capture-incomplete-or-startup-injection')
    for rule in spec['cases'][binding['caseId']]['assertions']:
        if not assertion(rule):
            failures.append('assertion-failed:' + rule['id'])
    return dict(candidate=spec['candidate'], caseId=binding['caseId'], threadId=binding['threadId'],
                callId=session['id'] if session else call_id, historySha256=history_hash, traces=traces,
                failures=failures, automatedPass=not failures, physicalAcceptance=False)


def journal(root):
    result = []
    for path in sorted((root / 'journal').glob('*.json')):
        record = load(path)
        if record['sequence'] != len(result) + 1 or record['previous'] != (canonical(result[-1]) if result else None):
            raise ValueError('journal sequence or hash gap')
        result.append(record)
    return result


def record(root, operation, payload):
    history = journal(root)
    row = dict(sequence=len(history) + 1, previous=canonical(history[-1]) if history else None,
               operation=operation, payload=payload, atUnixMs=time.time_ns() // 1_000_000)
    write(root / 'journal' / ('%06d.json' % row['sequence']), row)


def execute(root, operation, spec_path=None, case_id=None, attempt_id=None, observations=None):
    root = pathlib.Path(root).absolute()
    if operation == 'prepare':
        spec = load(spec_path)
        frozen = freeze(spec)
        ledger = load(spec['ledgerPath'])
        cases = campaign_cases(ledger)
        if not set(spec['cases']).issubset(cases):
            raise ValueError('unknown campaign case')
        for case in spec['cases'].values():
            if not case['assertions'] or len({r['id'] for r in case['assertions']}) != len(case['assertions']):
                raise ValueError('case requires distinct automated assertions')
        root.mkdir(mode=0o700)
        for name in ('journal', 'attempts', 'archive', 'settings', 'plugins', 'cache', 'sessions', 'fixtures', 'controller', 'terraform-data'):
            (root / name).mkdir(mode=0o700)
        shutil.copyfile(spec['ledgerPath'], root / 'archive/previous-ledger.json')
        (root / 'archive/previous-ledger.json').chmod(0o600)
        write(root / 'spec.json', spec)
        write(root / 'freeze.json', frozen)
        write(root / 'scope.json', dict(cases=cases, gates=34, plugins=23, lifecycleGates=299,
                                       finalRepetitionsRequired=2, fullGoalComplete=False))
        record(root, operation, dict(specSha256=digest(root / 'spec.json'), freezeSha256=digest(root / 'freeze.json')))
        return dict(prepared=True, root=str(root), fullGoalComplete=False)
    private_path(root, directory=True)
    spec = load(root / 'spec.json')
    frozen = load(root / 'freeze.json')
    history = journal(root)
    if not history or history[0]['payload']['specSha256'] != digest(root / 'spec.json') or history[0]['payload']['freezeSha256'] != digest(root / 'freeze.json'):
        raise ValueError('campaign admission changed')
    if freeze(spec) != frozen:
        raise ValueError('frozen candidate, adapter, catalog, or configuration changed')
    if operation == 'resume':
        return dict(root=str(root), lastOperation=history[-1]['operation'], attempts=[p.name for p in (root / 'attempts').iterdir()],
                    replayedMutations=0, fullGoalComplete=False)
    if operation == 'pair':
        path = root / ('pair-%s.json' % time.time_ns())
        result = adapter(spec, 'pair', path)
        record(root, operation, dict(receipt=str(path), sha256=digest(path)))
        return dict(pairingReceipt=str(path), humanAction='scan and authorize QR', acceptance=False)
    if not attempt_id or not re.fullmatch('[a-zA-Z0-9_-]+', attempt_id):
        raise ValueError('explicit safe attempt ID required')
    attempt = root / 'attempts' / attempt_id
    if operation == 'arm':
        if case_id not in spec['cases']:
            raise ValueError('case lacks concrete acceptance rules')
        attempt.mkdir(mode=0o700)
        binding = adapter(spec, 'arm', attempt / 'arm-adapter.json')
        for key in ('threadId', 'historyPath', 'capturePaths', 'hostIdentity', 'workerIdentity', 'effectiveConfiguration', 'fixtureHashes', 'ownership'):
            if not binding.get(key):
                raise ValueError('missing arm binding: ' + key)
        if binding['effectiveConfiguration'] != spec['effectiveConfiguration'] or not binding.get('collectorsArmed') or not binding.get('pairingVerified'):
            raise ValueError('pairing, model, instructions, or collectors not verified')
        if binding['fixtureHashes'] != spec.get('fixtureHashes'):
            raise ValueError('arm fixture binding differs from frozen fixture hashes')
        # Challenge expiry applies before authorization. A registered client does
        # not expire when its already-consumed QR challenge does.
        if binding.get('clientExpiresAt') and datetime.datetime.fromisoformat(binding['clientExpiresAt'].replace('Z', '+00:00')).timestamp() <= time.time():
            raise ValueError('paired client expired')
        rows, pending, _ = observer_module().read_jsonl_prefix(binding['historyPath'])
        if pending or not binding['capturePaths']:
            raise ValueError('incomplete history or missing captures at arm')
        binding.update(caseId=case_id, candidate=spec['candidate'], historyStartRecord=len(rows), armedAtUnixMs=time.time_ns() // 1_000_000)
        write(attempt / 'arm.json', binding)
        record(root, operation, dict(attempt=attempt_id, armSha256=digest(attempt / 'arm.json')))
        return dict(armed=True, threadId=binding['threadId'], humanAction='tap voice once, remain silent eight seconds')
    private_path(attempt, directory=True)
    arm = next((r for r in history if r['operation'] == 'arm' and r['payload']['attempt'] == attempt_id), None)
    if not arm or arm['payload']['armSha256'] != digest(attempt / 'arm.json'):
        raise ValueError('attempt arm binding changed')
    if (attempt / 'seal.json').exists():
        raise ValueError('sealed attempt is immutable')
    if operation in ('observe', 'inspect'):
        result = inspect_attempt(spec, attempt)
        write(attempt / ('inspection-%s.json' % time.time_ns()), result)
        return result
    if operation == 'close':
        result = adapter(spec, 'close', attempt / 'close.json')
        if result['activeVoiceSessions'] != 0 or result['outstandingTaskIds']:
            raise ValueError('phone call or backend work remains open')
        record(root, operation, dict(attempt=attempt_id, sha256=digest(attempt / 'close.json')))
        return dict(closed=True, sealPending=True)
    if operation == 'seal':
        result = inspect_attempt(spec, attempt)
        if not (attempt / 'close.json').exists():
            raise ValueError('closure receipt missing')
        close = next((r for r in history if r['operation'] == 'close' and r['payload']['attempt'] == attempt_id), None)
        if not close or close['payload']['sha256'] != digest(attempt / 'close.json'):
            raise ValueError('closure receipt changed')
        required = spec['cases'][result['caseId']].get('physicalObservations', [])
        physical = load(observations) if observations else {}
        if required and (physical.get('attemptId') != attempt_id or physical.get('candidate') != spec['candidate'] or any(physical.get(k) is not True for k in required)):
            result['failures'].append('physical-observations-missing-or-failed')
        result.update(passed=not result['failures'], physicalAcceptance=bool(required) and not result['failures'],
                      dependencies=frozen, physicalObservations=physical,
                      evidenceHashes={str(p.relative_to(attempt)): digest(p) for p in attempt.iterdir() if p.is_file()},
                      assertionEvidenceHashes={r['id']: digest(r['path']) for r in spec['cases'][result['caseId']]['assertions']},
                      fullGoalComplete=False)
        archive = attempt / 'sealed-evidence'
        archive.mkdir(mode=0o700)
        binding = load(attempt / 'arm.json')
        paths = [binding['historyPath'], *capture_paths(binding),
                 *binding['fixtureHashes'],
                 *(r['path'] for r in spec['cases'][result['caseId']]['assertions'])]
        result['retainedEvidence'] = []
        for index, source in enumerate(paths):
            target = archive / ('%03d-%s' % (index, pathlib.Path(source).name))
            shutil.copyfile(source, target)
            target.chmod(0o600)
            result['retainedEvidence'].append(dict(source=source, path=str(target), sha256=digest(target)))
        write(attempt / 'seal.json', result)
        record(root, operation, dict(attempt=attempt_id, sha256=digest(attempt / 'seal.json'), passed=result['passed']))
        return result
    raise ValueError('unknown operation')


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=OPERATIONS)
    parser.add_argument('--root', required=True)
    parser.add_argument('--spec')
    parser.add_argument('--case')
    parser.add_argument('--attempt')
    parser.add_argument('--observations')
    args = parser.parse_args()
    # A sibling lock works for initial creation and subsequent operations.
    lock = pathlib.Path(args.root).absolute().with_suffix('.runner.lock')
    with lock.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            result = execute(args.root, args.operation, args.spec, args.case, args.attempt, args.observations)
        except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
            print(json.dumps(dict(operation=args.operation, error=str(error), acceptance=False)))
            raise SystemExit(1) from error
        print(json.dumps(result))


if __name__ == '__main__':
    main()
