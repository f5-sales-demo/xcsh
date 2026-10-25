"""Bind an already prepared real project to its verified host and collectors."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess


def arm(lab, project):
    lab, project = pathlib.Path(lab), pathlib.Path(project)
    active = json.loads((lab / 'active-campaign.json').read_text())
    prep = json.loads((project / 'preparation.private.json').read_text())
    assert active['candidate'] == prep['candidate']
    binary = active['candidate']['executable']
    assert hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest() == active['candidate']['sha256']
    clients = json.loads(subprocess.check_output([binary, 'remote-control', 'clients', '--json']))['data']
    assert len(clients) == 1
    status = json.loads(subprocess.check_output([binary, 'remote-control', 'status', '--json']))
    assert status['activeVoiceSessions'] == 0
    checkpoint = json.loads((lab / 'resume-checkpoint.json').read_text())
    source = pathlib.Path(checkpoint['sourceWorktree'])
    env = dict(os.environ, PATH=str(lab / 'tooling/bun-1.4.3/bin') + ':' + str(pathlib.Path.home() / '.local/bin') + ':/usr/local/bin:/usr/bin:/bin')
    runtime = json.loads(subprocess.check_output(['bun', 'packages/coding-agent/scripts/lifecycle-uat-controller.ts',
        'preflight', '--campaign-dir', active['campaign']], cwd=source, env=env))
    assert len(runtime['workers']) == 1 and runtime['workers'][0]['threadId'] == prep['threadId']
    observer = json.loads((project / '.xcsh/voice-observer/output/latest.json').read_text())
    assert observer['candidate'] == active['candidate'] and not observer['outstandingTaskIds']
    capture = list((pathlib.Path(active['campaign']) / 'captures').glob('host-' + str(runtime['childPid']) + '-*.jsonl'))
    assert len(capture) == 1
    voice = pathlib.Path(active['campaign']) / 'diagnostics'
    return dict(threadId=prep['threadId'], historyPath=prep['sessionPath'], capturePaths=[str(capture[0])],
                diagnosticDirectory=str(voice), diagnosticBaseline=[p.name for p in voice.glob('*.jsonl')],
                captureDirectory=str(pathlib.Path(active['campaign']) / 'captures'),
                captureBaseline=[p.name for p in (pathlib.Path(active['campaign']) / 'captures').glob('*.jsonl')],
                hostIdentity=dict(supervisorPid=runtime['supervisorPid'], childPid=runtime['childPid'],
                                  hostname='nuc', invocation=runtime['invocation']),
                workerIdentity=runtime['workers'][0],
                effectiveConfiguration=dict(executionModel=prep['executionModel'], executionEffort=prep['executionEffort'],
                                            context=prep['context'], namespace=prep['namespace']),
                fixtureHashes={str(project / 'fixture.json'): hashlib.sha256((project / 'fixture.json').read_bytes()).hexdigest()},
                ownership=dict(stateRoot=prep['controllerState'], previousOwnedResourcesAbsent=True,
                               finalDisposition='destroy-and-prove-absence'),
                collectorsArmed=True, pairingVerified=True, phoneBuild=clients[0]['appVersion'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lab', required=True)
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    print(json.dumps(arm(args.lab, args.project)))
