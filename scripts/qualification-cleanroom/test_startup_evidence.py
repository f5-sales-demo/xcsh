import unittest
import observer

class StartupEvidenceTests(unittest.TestCase):
    def test_failed_partial_speech_is_seen_in_durable_timeline(self):
        history = [{"data": {"kind": "voiceTimeline", "item": {"realtimeSessionId": "call", "type": "transcriptSegment", "role": "assistant", "text": " Mm-h"}}}, {"data": {"kind": "voiceTimeline", "item": {"realtimeSessionId": "call", "type": "realtimeSessionClosed", "outcome": "failed"}}}]
        item = observer.derive(history)["sessions"][0]
        self.assertTrue(item["startupObservations"]["assistantBeforeCaller"])
        self.assertEqual(item["transcripts"][0]["text"], " Mm-h")

    def test_canonical_and_timeline_records_are_not_duplicated(self):
        history = [{"data": {"kind": "transcript", "realtimeSessionId": "call", "role": "assistant", "text": "Hello"}}, {"data": {"kind": "voiceTimeline", "item": {"realtimeSessionId": "call", "type": "transcriptSegment", "role": "assistant", "text": "Hello"}}}]
        item = observer.derive(history)["sessions"][0]
        self.assertEqual(len(item["transcripts"]), 1)

    def test_uncaptioned_startup_audio_is_a_separate_gate(self):
        history = [{"data": {"kind": "voiceStartupAudioDiagnostic", "realtimeSessionId": "call", "frames": 2, "signalFrames": 1, "maxRms": 226, "peak": 1409, "callerObserved": False}}]
        item = observer.derive(history)["sessions"][0]
        self.assertEqual(item["startupObservations"]["audioAcceptance"], "signal-observed")
        self.assertFalse(item["startupObservations"]["assistantBeforeCaller"])
        self.assertEqual(item["startupAudio"]["signalFrames"], 1)

if __name__ == "__main__": unittest.main()
