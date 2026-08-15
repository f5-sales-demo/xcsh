import { describe, expect, test } from "bun:test";
import { MediaPlaybackScheduler } from "../src/media-playback";
import { encodeKitty, stableKittyImageId } from "../src/terminal-capabilities";

describe("MediaPlaybackScheduler", () => {
	test("autoplays once when visible, pauses off-screen, and resumes", () => {
		const scheduler = new MediaPlaybackScheduler([50, 50, 50], {
			autoplay: true,
			loop: false,
			fpsCap: 12,
			reducedMotion: false,
		});

		expect(scheduler.state).toBe("stopped");
		scheduler.setVisible(true, 0);
		expect(scheduler.state).toBe("playing");
		expect(scheduler.tick(84)).toBe(1);
		scheduler.setVisible(false, 90);
		expect(scheduler.state).toBe("paused");
		scheduler.setVisible(true, 200);
		expect(scheduler.state).toBe("playing");
		expect(scheduler.tick(285)).toBe(2);
		expect(scheduler.tick(370)).toBe(2);
		expect(scheduler.state).toBe("stopped");

		scheduler.setVisible(false, 400);
		scheduler.setVisible(true, 500);
		expect(scheduler.state).toBe("stopped");
	});

	test("reduced motion disables autoplay and fps cap enforces a minimum frame duration", () => {
		const scheduler = new MediaPlaybackScheduler([1, 1], {
			autoplay: true,
			loop: true,
			fpsCap: 10,
			reducedMotion: true,
		});
		scheduler.setVisible(true, 0);
		expect(scheduler.state).toBe("stopped");
		scheduler.play(0);
		expect(scheduler.tick(99)).toBe(0);
		expect(scheduler.tick(100)).toBe(1);
	});
});

test("Kitty media uses a stable positive image ID and transmit/replace action", () => {
	const first = stableKittyImageId("media_abc");
	const second = stableKittyImageId("media_abc");
	expect(first).toBe(second);
	expect(first).toBeGreaterThan(0);
	expect(encodeKitty("YWJj", { imageId: first })).toContain(`a=T,f=100,q=2,i=${first}`);
});
