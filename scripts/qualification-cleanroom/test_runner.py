"""Adversarial qualification checks: no replay, stale promotion, or false success."""
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import observer
import runner


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name).resolve()
        self.source = self.base / 'source'
        self.source.mkdir()
        (self.source / 'catalog.json').write_text('{"immutable": true}')
        self.binary = self.base / 'binary'
        self.binary.write_text('test candidate')
        self.candidate = dict(commit='a' * 40, sha256=runner.digest(self.binary), executable=str(self.binary))
        gates = [dict(id='core.' + str(i), requirement='retained', status='verified') for i in range(34)]
        plugins = [dict(plugin='p' + str(p), gates=[dict(id=f'plugin.{p}.{g}', requirement='retained', status='verified')
                                                for g in range(13)]) for p in range(23)]
        self.ledger = self.base / 'ledger.json'
        runner.write(self.ledger, dict(gates=gates, marketplace=plugins))
        self.evidence = self.base / 'result.json'
        runner.write(self.evidence, dict(state='ONLINE', success=True))
        self.spec = dict(candidate=self.candidate, sources=dict(marketplace=str(self.source)), adapters={},
                         effectiveConfiguration=dict(model='frozen-test-model', voice='frozen-test-voice'),
                         workspace=str(self.base), ledgerPath=str(self.ledger),
                         cases={'core.0': dict(assertions=[dict(id='state', kind='equals', path=str(self.evidence),
                                                              field='state', expected='ONLINE')])})
        self.spec_path = self.base / 'spec.json'
        runner.write(self.spec_path, self.spec)
        self.root = self.base / 'campaign'

    def prepare(self):
        return runner.execute(self.root, 'prepare', str(self.spec_path))

    def test_all_gates_are_retained_without_historical_promotion(self):
        self.prepare()
        scope = runner.load(self.root / 'scope.json')
        self.assertEqual(len(scope['cases']), 333)
        self.assertTrue(all(g['status'] == 'incomplete' for g in scope['cases'].values()))
        self.assertEqual(scope['finalRepetitionsRequired'], 2)

    def test_reduced_scope_is_rejected(self):
        ledger = runner.load(self.ledger)
        ledger['marketplace'].pop()
        self.assertRaises(ValueError, runner.campaign_cases, ledger)

    def test_wrong_candidate_is_rejected_before_creation(self):
        self.binary.write_text('wrong binary')
        self.assertRaises(ValueError, self.prepare)
        self.assertFalse(self.root.exists())

    def test_mutable_catalog_invalidates_resume(self):
        self.prepare()
        (self.source / 'catalog.json').write_text('changed')
        self.assertRaises(ValueError, runner.execute, self.root, 'resume')

    def test_resume_never_runs_adapter_or_replays_mutation(self):
        self.prepare()
        with patch.object(runner, 'adapter') as adapter:
            result = runner.execute(self.root, 'resume')
            adapter.assert_not_called()
        self.assertEqual(result['replayedMutations'], 0)

    def test_mutated_fixture_invalidates_resume(self):
        fixture = self.base / 'fixture.json'
        fixture.write_text('{"identity":"first"}')
        self.spec['fixtureHashes'] = {str(fixture): runner.digest(fixture)}
        self.spec_path.write_text(json.dumps(self.spec))
        self.prepare()
        fixture.write_text('{"identity":"different"}')
        self.assertRaises(ValueError, runner.execute, self.root, 'resume')

    def test_wrong_declared_fixture_hash_rejects_preparation(self):
        fixture = self.base / 'fixture.json'
        fixture.write_text('{}')
        self.spec['fixtureHashes'] = {str(fixture): '0' * 64}
        self.spec_path.write_text(json.dumps(self.spec))
        self.assertRaises(ValueError, self.prepare)
        self.assertFalse(self.root.exists())

    def test_capture_inventory_retains_fresh_diagnostics_and_deduplicates(self):
        directory = self.base / 'diagnostics'
        directory.mkdir()
        old = directory / 'old.jsonl'
        fresh = directory / 'fresh.jsonl'
        old.write_text('historical')
        fresh.write_text('current')
        binding = dict(capturePaths=[str(fresh)], diagnosticDirectory=str(directory),
                       diagnosticBaseline=[old.name])
        self.assertEqual(runner.capture_paths(binding), [str(fresh)])

    def test_sideband_capture_directory_is_included_without_old_files(self):
        directory = self.base / 'captures'
        directory.mkdir()
        old = directory / 'voice-old.jsonl'
        fresh = directory / 'voice-new.jsonl'
        host = directory / 'host-current.jsonl'
        for path in (old, fresh, host):
            path.write_text('capture')
        binding = dict(capturePaths=[str(host)], captureDirectory=str(directory),
                       captureBaseline=[old.name, host.name])
        self.assertEqual(runner.capture_paths(binding), [str(host), str(fresh)])

    def test_admission_spec_and_journal_tampering_are_rejected(self):
        self.prepare()
        path = self.root / 'spec.json'
        spec = runner.load(path)
        spec['cases']['core.0']['assertions'] = []
        path.write_text(json.dumps(spec))
        self.assertRaises(ValueError, runner.execute, self.root, 'resume')

    def test_missing_and_incomplete_footer_never_seal(self):
        trace = self.base / 'trace.jsonl'
        rows = [dict(kind='manifest', sourceCommit=self.candidate['commit'], artifactSha256=self.candidate['sha256']),
                dict(kind='event', sequence=1, direction='in', message=dict(type='session.created'))]
        trace.write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
        self.assertFalse(observer.trace_state(trace, self.candidate)['complete'])
        rows.append(dict(kind='footer', complete=False, events=1))
        trace.write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
        self.assertFalse(observer.trace_state(trace, self.candidate)['complete'])

    def test_sequence_gaps_and_wrong_manifests_fail(self):
        trace = self.base / 'trace.jsonl'
        rows = [dict(kind='wrong', sourceCommit=self.candidate['commit'], artifactSha256=self.candidate['sha256']),
                dict(kind='event', sequence=3, direction='in', message={}), dict(kind='footer', complete=True, events=1)]
        trace.write_text('\n'.join(json.dumps(r) for r in rows) + '\n')
        result = observer.trace_state(trace, self.candidate)
        self.assertIn('sequence-gap', result['failures'])
        self.assertIn('manifest-missing', result['failures'])

    def test_reported_success_is_not_an_assertion(self):
        rule = dict(kind='equals', path=str(self.evidence), field='success', expected=True)
        self.assertRaises(ValueError, runner.assertion, rule)

    def test_empty_plan_is_not_zero_change_acceptance(self):
        self.evidence.write_text(json.dumps(dict(resource_changes=[])))
        self.assertFalse(runner.assertion(dict(kind='plan-no-change', path=str(self.evidence))))

    def test_saved_plan_requires_content_and_matching_hash(self):
        import hashlib
        content = 'Install KVM and its Platform dependency in the configured namespace.'
        plan = dict(content=content, sha256=hashlib.sha256(content.encode()).hexdigest())
        self.evidence.write_text(json.dumps(dict(plan=plan)))
        rule = dict(kind='saved-plan', path=str(self.evidence), field='plan')
        self.assertTrue(runner.assertion(rule))
        plan['content'] = 'Changed plan'
        self.evidence.write_text(json.dumps(dict(plan=plan)))
        self.assertFalse(runner.assertion(rule))
        self.evidence.write_text(json.dumps(dict(plan=dict(content='', sha256='0' * 64))))
        self.assertFalse(runner.assertion(rule))

    def test_http_200_wrong_origin_or_missing_nonce_log_fails(self):
        sample = dict(nonce='fresh', status=200, body=dict(fixtureId='owned', nonce='fresh'),
                      ceUid='ce', loadBalancerUid='lb')
        rule = dict(kind='traffic', path=str(self.evidence), fixtureId='owned', ceUid='ce',
                    loadBalancerUid='lb', ceInsideIp='10.0.0.1')
        data = dict(samples=[sample], workloadLogs=[])
        self.evidence.write_text(json.dumps(data))
        self.assertFalse(runner.assertion(rule))
        data['workloadLogs'] = [dict(nonce='fresh', fixtureId='owned', sourceIp='10.0.0.1')]
        self.evidence.write_text(json.dumps(data))
        self.assertTrue(runner.assertion(rule))
        data['samples'].append(sample)
        self.evidence.write_text(json.dumps(data))
        self.assertFalse(runner.assertion(rule))

    def test_unsafe_attempt_id_is_rejected(self):
        self.prepare()
        self.assertRaises(ValueError, runner.execute, self.root, 'arm', case_id='core.0', attempt_id='../old-seal')


if __name__ == '__main__':
    unittest.main()
