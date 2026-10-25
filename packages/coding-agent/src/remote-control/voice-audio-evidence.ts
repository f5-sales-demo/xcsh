/** Aggregate PCM16 signal facts; audio samples are never retained. */
export class VoiceAudioEvidence {
	#frames = 0;
	#samples = 0;
	#signalFrames = 0;
	#maxRms = 0;
	#peak = 0;
	observe(encoded: string): void {
		if (!encoded || encoded.length > 1048576 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4) return;
		const bytes = Buffer.from(encoded, "base64");
		if (!bytes.length || bytes.length % 2) return;
		let squares = 0,
			peak = 0;
		for (let offset = 0; offset < bytes.length; offset += 2) {
			const sample = bytes.readInt16LE(offset);
			squares += sample * sample;
			peak = Math.max(peak, Math.abs(sample));
		}
		const rms = Math.sqrt(squares / (bytes.length / 2));
		this.#frames++;
		this.#samples += bytes.length / 2;
		if (rms > 32) this.#signalFrames++;
		this.#maxRms = Math.max(this.#maxRms, Math.round(rms));
		this.#peak = Math.max(this.#peak, peak);
	}
	snapshot() {
		return {
			frames: this.#frames,
			samples: this.#samples,
			signalFrames: this.#signalFrames,
			maxRms: this.#maxRms,
			peak: this.#peak,
		};
	}
}
