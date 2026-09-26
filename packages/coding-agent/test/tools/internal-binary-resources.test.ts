import { describe, expect, it } from "bun:test";
import * as os from "node:os";
import { Settings } from "../../src/config/settings";
import { InternalUrlRouter } from "../../src/internal-urls/router";
import type { ToolSession } from "../../src/tools";
import { GrepTool } from "../../src/tools/grep";
import { ReadTool } from "../../src/tools/read";

function session(router: InternalUrlRouter): ToolSession {
	return {
		cwd: os.tmpdir(),
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({
			"edit.mode": "line",
			"images.autoResize": false,
			"inspect_image.enabled": false,
			"read.defaultLimit": 2000,
			"read.prosechunks": false,
			"read.explorechunks": false,
			"grep.contextBefore": 0,
			"grep.contextAfter": 0,
		}),
		internalRouter: router,
	};
}

function binaryRouter(mimeType: "image/png" | "image/jpeg" | "image/svg+xml" = "image/png") {
	const router = new InternalUrlRouter();
	router.register({
		scheme: "fixture",
		async resolve() {
			return {
				url: "fixture://image",
				content: Buffer.from(
					mimeType === "image/svg+xml"
						? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
						: "binary-image",
				).toString("base64"),
				contentType: mimeType,
				encoding: "base64" as const,
			};
		},
	});
	return router;
}

describe("binary internal resources", () => {
	it("read emits normal ImageContent for a PNG", async () => {
		const result = await new ReadTool(session(binaryRouter())).execute("read", { path: "fixture://image" });
		expect(result.content).toEqual([
			{ type: "text", text: "Read image resource [image/png]" },
			{ type: "image", data: Buffer.from("binary-image").toString("base64"), mimeType: "image/png" },
		]);
	});

	it("read converts SVG resources to PNG", async () => {
		const result = await new ReadTool(session(binaryRouter("image/svg+xml"))).execute("read", {
			path: "fixture://image",
		});
		const image = result.content.find(block => block.type === "image");
		expect(image?.mimeType).toBe("image/png");
	});

	it("grep rejects binary internal resources", async () => {
		const tool = new GrepTool(session(binaryRouter()));
		await expect(tool.execute("grep", { pattern: "image", path: "fixture://image" })).rejects.toThrow(
			"Cannot grep binary internal resource",
		);
	});
});
