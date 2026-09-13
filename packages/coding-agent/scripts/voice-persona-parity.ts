/** Executing-agent contract qualification; physical iPhone acceptance remains separate. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getAgentDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { PersonProfileService } from "../src/person-profile/service";
import { type PersonContractInvocation, scorePersonContract } from "../src/remote-control/persona-evaluation";
import { voiceDelegation } from "../src/remote-control/voice-delegation";
import { createAgentSession, discoverAuthStorage } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

const root = await mkdtemp(join(tmpdir(), "person-parity-"));
const agentDir = getAgentDir();
const auth = await discoverAuthStorage(agentDir);
const registry = new ModelRegistry(auth);
const service = new PersonProfileService(join(root, "private", "user-profile.json"));
await service.update({ givenName: `Person-${crypto.randomUUID().slice(0, 8)}`, jobTitle: "Systems engineer" });
const results: unknown[] = [];
try {
	await registry.refreshProvider("openai-codex", "online");
	const model = registry.find("openai-codex", "gpt-5.6-sol");
	if (!model) throw new Error("Qualification model unavailable");
	const scenarios: {
		surface: string;
		sample: number;
		request: string;
		action: "get" | "update" | "forget";
		title?: string;
	}[] = [
		...["tui", "iphone-delegated-agent"].flatMap(surface =>
			Array.from({ length: 3 }, (_, sample) => ({
				surface,
				sample,
				request: "What do you know about me?",
				action: "get" as const,
			})),
		),
		{
			surface: "tui",
			sample: 3,
			request: "My job title is Solutions architect. Please remember my job title.",
			action: "update",
			title: "Solutions architect",
		},
		{ surface: "iphone-delegated-agent", sample: 3, request: "What is my current job title?", action: "get" },
		{
			surface: "iphone-delegated-agent",
			sample: 4,
			request: "My job title has changed to Infrastructure analyst. Please correct it.",
			action: "update",
			title: "Infrastructure analyst",
		},
		{ surface: "tui", sample: 4, request: "What is my current job title?", action: "get" },
		{
			surface: "tui",
			sample: 5,
			request: "Correction: my job title is Research engineer. Please remember the correction.",
			action: "update",
			title: "Research engineer",
		},
		{ surface: "iphone-delegated-agent", sample: 5, request: "What is my current job title?", action: "get" },
		{ surface: "iphone-delegated-agent", sample: 6, request: "Forget my job title.", action: "forget" },
		{ surface: "tui", sample: 6, request: "What do you know about my job title?", action: "get" },
	];
	for (const { surface, sample, request, action, title } of scenarios) {
		const cwd = join(root, surface);
		await mkdir(cwd, { recursive: true });
		const settings = await Settings.init({ agentDir, cwd, inMemory: true });
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
			toolNames: ["person_profile"],
			personProfileService: service,
		});
		const calls = new Map<string, PersonContractInvocation>();
		let stopReason: string | undefined;
		let providerError = false;
		const started = Date.now();
		console.log(
			JSON.stringify({
				surface,
				sample,
				phase: "started",
				tools: session.getActiveToolNames(),
				hasPersonGuidance: session.systemPrompt.includes("xcsh://user"),
			}),
		);
		const unsubscribe = session.subscribe(event => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				stopReason = event.message.stopReason;
				providerError = Boolean(event.message.errorMessage);
			}
			if (event.type === "tool_execution_start") {
				const args = event.args as Record<string, unknown>;
				calls.set(event.toolCallId, {
					toolName: event.toolName,
					action: typeof args.action === "string" ? args.action : undefined,
					resource: typeof args.path === "string" ? args.path : undefined,
					success: false,
				});
			}
			if (event.type === "tool_execution_end") {
				const call = calls.get(event.toolCallId);
				if (!call) return;
				call.success = !event.isError;
				try {
					const result = event.result as { content?: { type: string; text?: string }[] };
					const text = result.content?.find(c => c.type === "text")?.text;
					call.profile = text ? JSON.parse(text) : undefined;
				} catch {
					call.success = false;
				}
			}
		});
		const timeout = setTimeout(() => void session.abort(), 120000);
		try {
			await session.prompt(surface === "tui" ? request : voiceDelegation(request, `user: ${request}`));
			const current = await service.get();
			const relevant = [...calls.values()].filter(
				c => c.toolName === "person_profile" && c.action === action && c.success,
			);
			const matching = relevant.filter(c => isDeepStrictEqual(c.profile, current)).length;
			const score =
				action === "get"
					? scorePersonContract([...calls.values()], current)
					: {
							passed:
								matching > 0 &&
								(action === "forget"
									? current.facts.jobTitle === undefined && Boolean(current.suppressed.jobTitle)
									: current.facts.jobTitle === title && current.provenance.jobTitle?.owner === "user"),
							canonicalCalls: relevant.length,
							matchingOutcomes: matching,
							schemaVersion: current.schemaVersion,
						};
			if (action === "get" && [...calls.values()].some(c => c.action !== "get")) score.passed = false;
			results.push({ surface, sample, ...score });
			console.log(
				JSON.stringify({
					surface,
					sample,
					phase: "completed",
					factFields: Object.keys(current.facts),
					suppressedFields: Object.keys(current.suppressed),
					titleMatches: action !== "update" || current.facts.jobTitle === title,
					elapsedMs: Date.now() - started,
					stopReason,
					providerError,
					tools: [...calls.values()].map(c => ({
						name: c.toolName,
						action: c.action,
						success: c.success,
						structured: c.profile !== undefined,
					})),
					...score,
				}),
			);
			if (!score.passed) throw new Error("Canonical person qualification failed");
		} finally {
			clearTimeout(timeout);
			unsubscribe();
			await session.dispose();
		}
	}
	console.log(
		JSON.stringify({
			samples: scenarios.length,
			results,
			rawPromptsRetained: false,
			rawTranscriptsRetained: false,
			physicalPhoneAcceptance: false,
		}),
	);
} finally {
	auth.close();
	await rm(root, { recursive: true, force: true });
}
