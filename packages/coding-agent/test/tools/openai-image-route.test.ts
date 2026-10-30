import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiImageTool, setPreferredImageProvider } from "../../src/tools/gemini-image";

const originalFetch = global.fetch;
const keys = ["LITELLM_BASE_URL", "LITELLM_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_KEY"];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
afterEach(() => {
	global.fetch = originalFetch;
	setPreferredImageProvider("auto");
	for (const key of keys) {
		if (original[key] === undefined) delete process.env[key];
		else process.env[key] = original[key];
	}
});

test.each([
	"https://gateway.example.invalid",
	"https://gateway.example.invalid/v1/",
	"https://gateway.example.invalid/openai/v1",
])("image generation uses the supported native endpoint for %s", async baseUrl => {
	process.env.OPENAI_BASE_URL = baseUrl;
	process.env.OPENAI_API_KEY = "synthetic-image-key";
	delete process.env.LITELLM_API_KEY;
	setPreferredImageProvider("openai");
	let requested = "";
	global.fetch = (async (input: string | URL | Request) => {
		requested = String(input);
		return Response.json({
			data: [
				{
					b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhcUAAAAASUVORK5CYII=",
				},
			],
		});
	}) as typeof fetch;
	const directory = mkdtempSync(join(tmpdir(), "xcsh-image-route-"));
	try {
		await geminiImageTool.execute("route-test", { subject: "A synthetic blue circle" }, undefined, {
			sessionManager: { getCwd: () => directory },
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort() {},
		} as any);
		expect(requested).toBe("https://gateway.example.invalid/v1/images/generations");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
