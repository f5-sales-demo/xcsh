import copy
import unittest
from voice_ab import assess_attempt, evaluate_abba, normalize


def attempt(backend='codex', quiet=True):
    stages = ['configuration_read', 'thread_created', 'prompt_selected', 'call_created',
              'media_active', 'sideband_upgraded', 'context_sent', 'context_acknowledged']
    if not quiet:
        stages += ['caption_delta', 'output_audio']
    stages += ['caller_speech', 'input_audio', 'caption_delta', 'backend_admitted',
               'local_close_requested', 'session_closed', 'websocket_closed', 'durable_terminal']
    events = [dict(source='rpc', sequence=i+1, atUnixNs=100+i, stage=stage)
              for i, stage in enumerate(stages)]
    for event in events:
        if event['stage'] == 'caption_delta':
            event.update(role='assistant' if event['atUnixNs'] < 110 and not quiet else 'user', text=' Mm-h')
        if event['stage'] == 'output_audio':
            event['signalFrames'] = 1
        if event['stage'] == 'durable_terminal':
            event['outcome'] = 'ended'
    return dict(schemaVersion=1, backend=backend, scope='native-startup',
                candidate=dict(commit='a'*40 if backend == 'codex' else 'b'*40, sha256='c'*64),
                expectedCandidate=dict(commit='a'*40 if backend == 'codex' else 'b'*40, sha256='c'*64),
                bindings=dict(host='nuc', accountSha256='d'*64, audioSha256='e'*64,
                              model='gpt-6-astra', effort='high', voiceModel='gpt-live-1-codex',
                              voice='cove', timingSha256='f'*64, configurationSha256='1'*64,
                              creationInstructionsSha256='2'*64, creationInstructionBytes=20,
                              ownership='neutral-creator', build='release'),
                identities=dict(thread='thread', call='call', realtime='realtime', voice='voice'),
                collectors={name: dict(armedAtUnixNs=99, complete=True, sha256='3'*64,
                                       sequenceComplete=True, drops=0, packets=4)
                            for name in ('rpc', 'sideband', 'history', 'process', 'packets', 'media')},
                events=events, outstandingTasks=0, outstandingTranscriptTails=0,
                transcriptsPreserved=True, startupAudio=dict(frames=20, signalFrames=0 if quiet else 1))


class VoiceABTests(unittest.TestCase):
    def test_quiet_component_does_not_establish_phone_parity(self):
        row = attempt()
        self.assertTrue(assess_attempt(row)['quietStartup'])
        row['scope'] = 'component'
        self.assertFalse(evaluate_abba([row, attempt('xcsh', False), attempt('xcsh', False), row])['matchedComparison'])

    def test_abba_detects_discriminating_backend_difference_without_root_cause_claim(self):
        result = evaluate_abba([attempt(), attempt('xcsh', False), attempt('xcsh', False), attempt()])
        self.assertTrue(result['matchedComparison'])
        self.assertTrue(result['discriminating'])
        self.assertFalse(result['physicalAcceptance'])
        self.assertFalse(result['rootCauseEstablished'])

    def test_nondiscriminating_fixture_cannot_pass(self):
        result = evaluate_abba([attempt(), attempt('xcsh'), attempt('xcsh'), attempt()])
        self.assertFalse(result['discriminating'])
        self.assertIn('control-did-not-reproduce', result['failures'])

    def test_wrong_order_and_confounding_variables_rejected(self):
        rows = [attempt(), attempt('xcsh', False), attempt('xcsh', False), attempt()]
        for binding in ('accountSha256', 'host', 'audioSha256', 'timingSha256', 'configurationSha256', 'voiceModel'):
            changed = copy.deepcopy(rows)
            changed[1]['bindings'][binding] = 'different'
            self.assertIn('confounded:'+binding, evaluate_abba(changed)['failures'])
        self.assertIn('abba-order', evaluate_abba(rows[:2]+rows[:2])['failures'])

    def test_missing_drops_sequence_gaps_and_wrong_artifact_fail_closed(self):
        for name in ('rpc', 'sideband', 'history', 'process', 'packets', 'media'):
            row = attempt()
            del row['collectors'][name]
            self.assertFalse(assess_attempt(row)['evidenceComplete'])
        for mutation in ('drops', 'sequence', 'candidate', 'late', 'unsealed'):
            row = attempt()
            if mutation == 'drops': row['collectors']['packets']['drops'] = 1
            if mutation == 'sequence': row['events'][3]['sequence'] += 1
            if mutation == 'candidate': row['candidate']['sha256'] = '4'*64
            if mutation == 'late': row['collectors']['sideband']['armedAtUnixNs'] = 120
            if mutation == 'unsealed': row['collectors']['history']['sha256'] = None
            self.assertFalse(assess_attempt(row)['evidenceComplete'], mutation)

    def test_fragmented_fillers_annotations_and_uncaptioned_audio_are_retained(self):
        for text in (' Mm', '-h', '[listening]', '<annotation>', 'Hello'):
            row = attempt(False)
            row = attempt(quiet=False)
            next(e for e in row['events'] if e['stage'] == 'caption_delta')['text'] = text
            self.assertFalse(assess_attempt(row)['quietStartup'])
        row = attempt()
        row['startupAudio']['signalFrames'] = 1
        self.assertFalse(assess_attempt(row)['quietStartup'])

    def test_output_racing_context_ack_is_reported(self):
        row = attempt(quiet=False)
        ack = next(e for e in row['events'] if e['stage'] == 'context_acknowledged')
        ack['atUnixNs'] = 115
        self.assertTrue(assess_attempt(row)['outputBeforeContextAcknowledgment'])

    def test_identities_are_mapped_without_requiring_unique_values(self):
        row = attempt()
        row['identities']['voice'] = row['identities']['realtime']
        self.assertTrue(assess_attempt(row)['evidenceComplete'])
        del row['identities']['voice']
        self.assertFalse(assess_attempt(row)['evidenceComplete'])

    def test_socket_close_alone_and_unfinished_work_are_not_normal_closure(self):
        row = attempt()
        row['events'] = [e for e in row['events'] if e['stage'] not in ('session_closed', 'durable_terminal')]
        for i, event in enumerate(row['events']): event['sequence'] = i+1
        self.assertEqual(assess_attempt(row)['closure'], 'incomplete-finalization')
        for field in ('outstandingTasks', 'outstandingTranscriptTails'):
            row = attempt(); row[field] = 1
            self.assertFalse(assess_attempt(row)['evidenceComplete'])

    def test_local_guard_and_remote_closure_are_distinct(self):
        row = attempt()
        close = next(e for e in row['events'] if e['stage'] == 'local_close_requested')
        close['reason'] = 'startup-guard'
        self.assertEqual(assess_attempt(row)['closure'], 'local-guard')
        close['stage'] = 'remote_close_observed'
        self.assertEqual(assess_attempt(row)['closure'], 'remote')

    def test_normalization_orders_clocks_and_hashes_private_text(self):
        row = attempt(quiet=False)
        timeline = normalize(list(reversed(row['events'])))
        self.assertEqual(timeline[0]['stage'], 'configuration_read')
        caption = next(e for e in timeline if e['stage'] == 'caption_delta')
        self.assertNotIn('text', caption)
        self.assertEqual(caption['textBytes'], 5)
        self.assertEqual(len(caption['textSha256']), 64)


if __name__ == '__main__':
    unittest.main()
