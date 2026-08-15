export type MediaPlaybackState = "stopped" | "playing" | "paused";

export interface MediaPlaybackOptions {
	autoplay: boolean;
	loop: boolean;
	fpsCap: number;
	reducedMotion: boolean;
}

export class MediaPlaybackScheduler {
	readonly #durations: number[];
	readonly #options: MediaPlaybackOptions;
	#state: MediaPlaybackState = "stopped";
	#frameIndex = 0;
	#lastTick = 0;
	#visible = false;
	#autoplayConsumed = false;
	#resumeWhenVisible = false;

	constructor(frameDurationsMs: number[], options: MediaPlaybackOptions) {
		if (frameDurationsMs.length === 0) throw new Error("media playback requires at least one frame");
		if (!Number.isFinite(options.fpsCap) || options.fpsCap < 1) throw new Error("fpsCap must be positive");
		const minimumDuration = 1000 / Math.min(60, options.fpsCap);
		this.#durations = frameDurationsMs.map(duration => Math.max(minimumDuration, duration));
		this.#options = options;
	}

	get state(): MediaPlaybackState {
		return this.#state;
	}

	get frameIndex(): number {
		return this.#frameIndex;
	}

	setVisible(visible: boolean, now: number): void {
		if (visible === this.#visible) return;
		this.#visible = visible;
		if (!visible && this.#state === "playing") {
			this.#resumeWhenVisible = true;
			this.pause();
			return;
		}
		if (!visible) return;
		if (this.#resumeWhenVisible) {
			this.#resumeWhenVisible = false;
			this.play(now);
			return;
		}
		if (this.#options.autoplay && !this.#options.reducedMotion && !this.#autoplayConsumed) {
			this.#autoplayConsumed = true;
			this.play(now);
		}
	}

	play(now: number): void {
		if (this.#frameIndex >= this.#durations.length) this.#frameIndex = 0;
		this.#lastTick = now;
		this.#state = "playing";
	}

	pause(): void {
		if (this.#state === "playing") this.#state = "paused";
	}

	stop(): void {
		this.#state = "stopped";
		this.#frameIndex = 0;
		this.#resumeWhenVisible = false;
		this.#autoplayConsumed = true;
	}

	tick(now: number): number {
		if (this.#state !== "playing") return this.#frameIndex;
		let elapsed = Math.max(0, now - this.#lastTick);
		while (elapsed >= (this.#durations[this.#frameIndex] ?? Number.POSITIVE_INFINITY)) {
			const duration = this.#durations[this.#frameIndex] ?? Number.POSITIVE_INFINITY;
			elapsed -= duration;
			if (this.#frameIndex + 1 < this.#durations.length) {
				this.#frameIndex++;
				this.#lastTick = now - elapsed;
				continue;
			}
			if (this.#options.loop) {
				this.#frameIndex = 0;
				this.#lastTick = now - elapsed;
				continue;
			}
			this.#state = "stopped";
			this.#frameIndex = this.#durations.length - 1;
			break;
		}
		return this.#frameIndex;
	}

	dispose(): void {
		this.#state = "stopped";
		this.#resumeWhenVisible = false;
	}
}
