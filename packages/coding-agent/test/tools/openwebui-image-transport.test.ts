import { afterEach, expect, test } from "bun:test";
import { requestOpenAIImage } from "../../src/tools/openai-image-transport";

const original = global.fetch;
afterEach(() => {
	global.fetch = original;
});

test("explicit gateway passthrough rejection falls back once to native images without changing its configured model", async () => {
	const calls: { url: string; body?: unknown; authorization?: string }[] = [];
	global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			authorization: new Headers(init?.headers).get("authorization") ?? undefined,
		});
		if (url.endsWith("/openai/v1/images/generations"))
			return Response.json(
				{ detail: "Direct API passthrough is disabled. Set ENABLE_OPENAI_API_PASSTHROUGH=True to enable." },
				{ status: 403 },
			);
		if (url.endsWith("/images/models")) return Response.json([{ id: "gpt-image-1" }, { id: "gpt-image-1.5" }]);
		if (url.endsWith("/api/v1/images/generations")) return Response.json([{ url: "/api/v1/files/file-one/content" }]);
		if (url.endsWith("/files/file-one")) return Response.json({ meta: { data: { model: "gpt-image-1.5" } } });
		return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
	}) as unknown as typeof fetch;
	const image = await requestOpenAIImage(
		"https://gateway.example.invalid",
		"synthetic",
		{
			model: "gpt-image-1",
			prompt: "Synthetic blue circle",
			n: 1,
			size: "1024x1024",
			quality: "low",
		},
		true,
	);
	expect(image?.model).toBe("gpt-image-1.5");
	expect(image?.mimeType).toBe("image/png");
	expect(calls.filter(call => call.url.endsWith("/api/v1/images/generations"))).toHaveLength(1);
	expect(calls.find(call => call.url.endsWith("/api/v1/images/generations"))?.body).toEqual({
		prompt: "Synthetic blue circle",
		n: 1,
		size: "1024x1024",
	});
	expect(calls.every(call => !call.url.includes("/config"))).toBe(true);
});

test("ordinary authorization rejection does not replay the generation on another endpoint", async () => {
	let calls = 0;
	global.fetch = (async () => {
		calls++;
		return Response.json({ error: { message: "Not authorized" } }, { status: 403 });
	}) as unknown as typeof fetch;
	await expect(
		requestOpenAIImage(
			"https://gateway.example.invalid",
			"synthetic",
			{ model: "gpt-image-1", prompt: "Synthetic", n: 1 },
			true,
		),
	).rejects.toThrow("Not authorized");
	expect(calls).toBe(1);
});
