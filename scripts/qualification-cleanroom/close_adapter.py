"""Verify normal phone closure and close only the owned capture producer."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time


def close(lab, project):
    lab, project = pathlib.Path(lab), pathlib.Path(project)
    prep = json.loads((project / 'preparation.private.json').read_text())
    active = json.loads((lab / 'active-campaign.json').read_text())
    assert prep['candidate'] == active['candidate']
    binary = prep['candidate']['executable']
    assert hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest() == prep['candidate']['sha256']
    status = json.loads(subprocess.check_output([binary, 'remote-control', 'status', '--json']))
    observed = json.loads((project / '.xcsh/voice-observer/output/latest.json').read_text())
    assert status['activeVoiceSessions'] == 0
    assert not observed['outstandingTaskIds']
    assert all(t['completionVerified'] for t in observed['tasks'])
    assert observed['sessions'] and all(s['lifecycle'] == 'closed' for s in observed['sessions'])
    subprocess.run(['systemctl', '--user', 'stop', 'xcsh-uat.service'], check=True)
    return dict(candidate=prep['candidate'], activeVoiceSessions=0, outstandingTaskIds=[],
                normalPhoneClosureObserved=True, ownedProducerStopped=True,
                closedCallIds=[s['id'] for s in observed['sessions']], herdrRestarted=False,
                atUnixMs=time.time_ns() // 1_000_000)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lab', required=True)
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    print(json.dumps(close(args.lab, args.project)))
