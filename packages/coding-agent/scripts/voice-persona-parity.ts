/** Live tool-capable comparison of native TUI and iPhone WebRTC-v3 delegated behavior. */
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
try {
	await registry.refreshProvider("openai-codex", "online");
	const model = registry.find("openai-codex", "gpt-5.6-sol");
	if (!model) throw new Error("Sol is unavailable");
	const userKnowledge = (await readMemorySummary(agentDir, settings)) ?? "";
	type Observation = ReturnType<typeof scorePersonaResponse> & { memoryRead: boolean };
	const results: Record<string, Observation[]> = {};
	for (const surface of ["tui", "iphone-webrtc-v3-delegated-agent"] as const) {
		results[surface] = [];
		for (let repetition = 0; repetition < samples; repetition++) {
			const { session } = await createAgentSession({
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
				toolNames: ["read"],
			});
			try {
				if (!session.getActiveToolNames().includes("read")) throw new Error("The read tool is unavailable");
				if (surface === "iphone-webrtc-v3-delegated-agent") {
					const voiceConfig = voiceCallConfig(
						{
							threadId: session.sessionId,
							version: "v3",
							outputModality: "audio",
							includeStartupContext: false,
							transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
						},
						{
							systemPrompt: session.systemPrompt,
							userKnowledge,
							tools: session.getActiveToolNames().map(name => ({ name })),
							history: "",
						},
					);
					const voicePrompt = String((voiceConfig.session as { instructions?: unknown }).instructions ?? "");
					if (!voicePrompt.includes("MUST delegate the user's exact request"))
						throw new Error("Voice configuration does not require attached-agent self-inspection");
				}
				await session.prompt(surface === "tui" ? PROBE : voiceDelegation(PROBE, `user: ${PROBE}`));
				const messages = session.messages as Array<{
					role: string;
					content?: Array<{ type?: string; text?: string; name?: string; arguments?: { path?: string } }>;
				}>;
				const response = messages.findLast(message => message.role === "assistant");
				const text = (response?.content ?? [])
					.filter(block => block.type === "text")
					.map(block => block.text ?? "")
					.join("\n");
				const memoryRead = messages.some(
					message =>
						message.role === "assistant" &&
						(message.content ?? []).some(
							block =>
								block.type === "toolCall" &&
								block.name === "read" &&
								block.arguments?.path === "memory://root/memory_summary.md",
						),
				);
				results[surface].push({ ...scorePersonaResponse(text, userKnowledge), memoryRead });
			} finally {
				await session.dispose();
			}
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
					{
						passed: scores.filter(score => score.passed && (surface === "tui" || score.memoryRead)).length,
						memoryReads: scores.filter(score => score.memoryRead).length,
						samples,
						scores,
					},
				]),
			),
			rawTranscriptsRetained: false,
			rawAudioRetained: false,
		}),
	);
} finally {
	auth.close();
}
