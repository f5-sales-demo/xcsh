/** Test-process-only native service fixture. Never loaded by normal xcsh startup. */
import { hookFetch } from "@f5-sales-demo/pi-utils";
import { registerOAuthProvider } from "../../../../ai/src/utils/oauth";
import { createKiroOAuth } from "../../../../ai/src/utils/oauth/kiro";

const profile = { arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test", name: "Test corporate profile" };
let polls = 0;
function crc(b: Uint8Array) {
	let c = 0xffffffff;
	for (const v of b) {
		c ^= v;
		for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
	}
	return (c ^ 0xffffffff) >>> 0;
}
function frame(content: string) {
	const bytes = new TextEncoder().encode(JSON.stringify({ content }));
	const b = new Uint8Array(16 + bytes.length);
	const v = new DataView(b.buffer);
	v.setUint32(0, b.length);
	v.setUint32(4, 0);
	v.setUint32(8, crc(b.subarray(0, 8)));
	b.set(bytes, 12);
	v.setUint32(b.length - 4, crc(b.subarray(0, b.length - 4)));
	return b;
}
async function mock(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url = new URL(String(input));
	init?.signal?.throwIfAborted();
	if (url.pathname === "/client/register")
		return Response.json({
			clientId: "synthetic-client",
			clientSecret: "synthetic-secret",
			clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400,
		});
	if (url.pathname === "/device_authorization")
		return Response.json({
			deviceCode: "synthetic-device",
			userCode: "TEST-ONLY",
			verificationUri: "https://example.invalid/kiro-test",
			expiresIn: 60,
			interval: 1,
		});
	if (url.pathname === "/token")
		return polls++ === 0
			? Response.json({ error: "authorization_pending" }, { status: 400 })
			: Response.json({ accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600 });
	if (url.pathname === "/ListAvailableProfiles") return Response.json({ profiles: [profile] });
	if (url.pathname === "/ListAvailableModels")
		return Response.json({
			models: [
				{
					modelId: "kiro/claude-haiku-4.5",
					modelName: "Synthetic Haiku",
					tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 64000 },
					supportedInputTypes: ["TEXT"],
				},
			],
			defaultModel: { modelId: "kiro/claude-haiku-4.5" },
		});
	if (url.pathname === "/generateAssistantResponse")
		return new Response(frame("4"), {
			headers: { "content-type": "application/vnd.amazon.eventstream" },
		});
	throw new Error(`Unexpected external request in Kiro UAT fixture: ${url.hostname}`);
}
// Keep the fixture hook alive until this dedicated test process exits.
const hook = hookFetch(mock);
process.on("exit", () => hook[Symbol.dispose]());
registerOAuthProvider({
	...createKiroOAuth({
		fetch: mock,
		readSources: async () => [],
		now: () => Date.now(),
		sleep: async (ms, signal) => {
			await Bun.sleep(Math.min(ms, 1100));
			signal?.throwIfAborted();
		},
	}),
	sourceId: "kiro-tui-fixture",
});
