import { expect, test } from "bun:test";
import { VoiceAudioEvidence } from "../../src/remote-control/voice-audio-evidence";

test("audio energy evidence distinguishes silence and signal without retaining samples", () => {
	const evidence = new VoiceAudioEvidence();
	evidence.observe(Buffer.alloc(960).toString("base64"));
	const signal = Buffer.alloc(960);
	for (let offset = 0; offset < signal.length; offset += 2) signal.writeInt16LE(1000, offset);
	evidence.observe(signal.toString("base64"));
	expect(evidence.snapshot()).toEqual({ frames: 2, samples: 960, signalFrames: 1, maxRms: 1000, peak: 1000 });
	expect(Object.keys(evidence.snapshot())).not.toContain("audio");
});

test("invalid and oversized audio cannot become evidence of silence", () => {
	const evidence = new VoiceAudioEvidence();
	evidence.observe("not base64");
	evidence.observe(Buffer.alloc(3).toString("base64"));
	evidence.observe("A".repeat(1048580));
	expect(evidence.snapshot()).toEqual({ frames: 0, samples: 0, signalFrames: 0, maxRms: 0, peak: 0 });
});
