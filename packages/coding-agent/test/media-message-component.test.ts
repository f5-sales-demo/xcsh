import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Container, TUI } from "@f5-sales-demo/pi-tui";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";
import type { MediaMessage } from "../src/media/types";
import { controlMediaPlayback, MediaMessageComponent } from "../src/modes/components/media-message";
import { initTheme } from "../src/modes/theme/theme";
import { BlobStore } from "../src/session/blob-store";

let root: string | undefined;

beforeAll(async () => {
	await initTheme();
});

afterEach(async () => {
	if (root) await fs.rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("MediaMessageComponent playback", () => {
	test("reduced motion stays static until manual play and unmount removes controls", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-media-component-"));
		const terminal = new VirtualTerminal(40, 5);
		const tui = new TUI(terminal);
		const message: MediaMessage = {
			role: "media",
			timestamp: Date.now(),
			media: {
				version: 1,
				id: "media_0123456789abcdef01234567",
				kind: "text-timeline",
				durationMs: 40,
				timeline: [
					{ text: "frame-one", durationMs: 20 },
					{ text: "frame-two", durationMs: 20 },
				],
				provenance: { sourceType: "timeline", source: "timeline:test" },
				playback: { autoplay: true, loop: false, muted: true, fpsCap: 60 },
			},
		};
		const component = new MediaMessageComponent(message, new BlobStore(path.join(root, "blobs")), tui, {
			autoplay: true,
			reducedMotion: true,
			fpsCap: 60,
		});
		const container = new Container();
		container.addChild(component);
		tui.addChild(container);
		tui.start();
		await Bun.sleep(0);
		await terminal.flush();
		expect(component.render(40).join("\n")).toContain("frame-one");
		await Bun.sleep(30);
		expect(component.render(40).join("\n")).toContain("frame-one");

		expect(controlMediaPlayback("play", "latest")?.state).toBe("playing");
		await Bun.sleep(45);
		expect(component.render(40).join("\n")).toContain("frame-two");
		expect(controlMediaPlayback("stop", message.media.id)?.state).toBe("stopped");
		expect(component.render(40).join("\n")).toContain("frame-one");

		container.clear();
		expect(controlMediaPlayback("play", message.media.id)).toBeNull();
		tui.stop();
	});
});
