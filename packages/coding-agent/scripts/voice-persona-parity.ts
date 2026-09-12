/** Live text-only comparison of the native TUI prompt and the iPhone WebRTC-v3 voice prompt. */
import { completeSimple, Effort } from "@f5-sales-demo/pi-ai";
import { getAgentDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { readMemorySummary } from "../src/memories";
import { scorePersonaResponse } from "../src/remote-control/persona-evaluation";
import { voiceCallConfig } from "../src/remote-control/voice-call";
import { voiceDelegation } from "../src/remote-control/voice-delegation";
import { createAgentSession, discoverAuthStorage } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

const PROBE = "what do you know about me";
const cwd = process.argv[2] ?? process.cwd();
const samples = Number(process.argv[3] ?? "3");
if (!Number.isInteger(samples) || samples < 1 || samples > 10)
	throw new Error("samples must be an integer from 1 to 10");

const agentDir = getAgentDir();
const settings = await Settings.init({ agentDir, cwd, inMemory: true });
const auth = await discoverAuthStorage(agentDir);
const registry = new ModelRegistry(auth);
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
try {
	await registry.refreshProvider("openai-codex", "online");
	const model = registry.find("openai-codex", "gpt-5.6-sol");
	if (!model) throw new Error("Sol is unavailable");
	const apiKey = await registry.getApiKey(model);
	if (!apiKey) throw new Error("Sol authentication is unavailable");
	({ session } = await createAgentSession({
		agentDir,
		authStorage: auth,
		cwd,
		disableExtensionDiscovery: true,
		enableMCP: false,
		model,
		modelRegistry: registry,
		rules: [],
		sessionManager: SessionManager.inMemory(),
		settings,
		skills: [],
		toolNames: [],
	}));
	const userKnowledge = (await readMemorySummary(agentDir, settings)) ?? "";
	const snapshot = {
		systemPrompt: session.systemPrompt,
		userKnowledge,
		tools: session.getActiveToolNames().map(name => ({ name })),
		history: "",
	};
	const voiceConfig = voiceCallConfig(
		{
			threadId: session.sessionId,
			version: "v3",
			outputModality: "audio",
			includeStartupContext: false,
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		},
		snapshot,
	);
	const voicePrompt = String((voiceConfig.session as { instructions?: unknown }).instructions ?? "");
	if (!voicePrompt.includes("MUST delegate the user's exact request"))
		throw new Error("Voice configuration does not require attached-agent self-inspection");
	const surfaces = [
		["tui", session.systemPrompt, PROBE],
		["iphone-webrtc-v3-delegated-agent", session.systemPrompt, voiceDelegation(PROBE, `user: ${PROBE}`)],
	] as const;
	const results: Record<string, ReturnType<typeof scorePersonaResponse>[]> = {};
	for (const [surface, systemPrompt, userPrompt] of surfaces) {
		results[surface] = [];
		for (let repetition = 0; repetition < samples; repetition++) {
			const response = await completeSimple(
				model,
				{ systemPrompt, messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }] },
				{ apiKey, maxTokens: 384, reasoning: Effort.Medium, signal: AbortSignal.timeout(120_000) },
			);
			const text = response.content
				.filter((block): block is { type: "text"; text: string } => block.type === "text")
				.map(block => block.text)
				.join("\n");
			results[surface].push(scorePersonaResponse(text, userKnowledge));
		}
	}
	console.log(
		JSON.stringify({
			probe: PROBE,
			model: `${model.provider}/${model.id}`,
			simulation: "iPhone WebRTC-v3 self-inspection delegated to the attached Sol work model",
			samples,
			memory: { present: Boolean(userKnowledge), bytes: Buffer.byteLength(userKnowledge) },
			surfaces: Object.fromEntries(
				Object.entries(results).map(([surface, scores]) => [
					surface,
					{ passed: scores.filter(score => score.passed).length, samples, scores },
				]),
			),
			rawTranscriptsRetained: false,
			rawAudioRetained: false,
		}),
	);
} finally {
	await session?.dispose();
	auth.close();
}
