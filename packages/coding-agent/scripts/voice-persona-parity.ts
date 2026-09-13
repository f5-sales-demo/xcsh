/** Executing-agent contract qualification; physical iPhone acceptance remains separate. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getAgentDir } from "@f5-sales-demo/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { MachineProfileService } from "../src/person-profile/machine-profile";
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
const machine = new MachineProfileService(join(root, "private", "computer-profile.json"), async () => ({
	hostname: "synthetic-device",
	platform: "synthetic",
	cpuLogicalCores: 4,
}));
let bootstrapRegistered = false;
// Start empty to expose history/project-memory fallback before testing learning.
const results: unknown[] = [];
try {
	await registry.refreshProvider("openai-codex", "online");
	const modelId = process.env.XCSH_PERSON_QUALIFICATION_MODEL ?? "gpt-5.6-sol";
	const model = registry.find("openai-codex", modelId);
	if (!model) throw new Error("Qualification model unavailable");
	const scenarios: {
		surface: string;
		sample: number;
		request: string;
		action: "get" | "update" | "forget" | "machine-get";
		title?: string;
		propertyValue?: string;
		propertyForget?: boolean;
		bootstrap?: boolean;
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
		...["tui", "iphone-delegated-agent"].flatMap(surface =>
			Array.from({ length: 3 }, (_, index) => ({
				surface,
				sample: 7 + index,
				request: "What do you know about me?",
				action: "get" as const,
				bootstrap: true,
			})),
		),
		...["tui", "iphone-delegated-agent"].flatMap(surface =>
			Array.from({ length: 3 }, (_, index) => ({
				surface,
				sample: 10 + index,
				request: "What machine am I using to interact with you? Retrieve its current structured profile.",
				action: "machine-get" as const,
			})),
		),
		{
			surface: "tui",
			sample: 13,
			request:
				"My favorite color is green. Remember this as a personal attribute with propertyID favorite_color. Also remember that my preferred editor is synthetic-editor, using propertyID preferred_editor.",
			action: "update",
			propertyValue: "green",
		},
		{ surface: "iphone-delegated-agent", sample: 13, request: "What is my favorite color?", action: "get" },
		{
			surface: "iphone-delegated-agent",
			sample: 14,
			request: "Correct my favorite_color personal attribute: my favorite color is now blue.",
			action: "update",
			propertyValue: "blue",
		},
		{ surface: "tui", sample: 14, request: "What is my favorite color?", action: "get" },
		{
			surface: "iphone-delegated-agent",
			sample: 15,
			request: "Forget only my favorite_color personal attribute, keeping everything else.",
			action: "forget",
			propertyForget: true,
		},
		{ surface: "tui", sample: 15, request: "What do you know about my favorite color?", action: "get" },
	];
	for (const { surface, sample, request, action, title, bootstrap, propertyValue, propertyForget } of scenarios) {
		if (bootstrap && !bootstrapRegistered) {
			service.registerProfileCollector({
				id: "synthetic_bootstrap",
				name: "Synthetic bootstrap",
				available: async () => true,
				collect: async () => ({
					givenName: "Synthetic",
					worksFor: { name: "Synthetic Research" },
					interactionDevices: [{ identifier: "xcsh://computer", relationship: "uses" }],
				}),
			});
			bootstrapRegistered = true;
		}
		const cwd = join(root, surface);
		await mkdir(cwd, { recursive: true });
		const settings = await Settings.init({ agentDir, cwd, inMemory: true });
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({
			role: "user",
			content: [
				{
					type: "text",
					text: "An earlier software test is complete: the synthetic clockwork checker wrote a marker file and exercised a delay. This describes test activity, not personal information.",
				},
			],
			timestamp: Date.now(),
		});
		const { session } = await createAgentSession({
			agentDir,
			authStorage: auth,
			cwd,
			disableExtensionDiscovery: true,
			enableMCP: false,
			model,
			modelRegistry: registry,
			rules: [],
			sessionManager,
			settings,
			skills: [],
			toolNames: ["person_profile", "machine_profile", "read"],
			personProfileService: service,
			machineProfileService: machine,
			profileDiscovery: true,
		});
		const calls = new Map<string, PersonContractInvocation>();
		let stopReason: string | undefined;
		let providerError = false;
		let providerErrorCategory: string | undefined;
		let answerText = "";
		const started = Date.now();
		console.log(
			JSON.stringify({
				surface,
				sample,
				model: model.id,
				phase: "started",
				tools: session.getActiveToolNames(),
				hasPersonGuidance: session.systemPrompt.includes("xcsh://user"),
			}),
		);
		const unsubscribe = session.subscribe(event => {
			if (event.type === "message_end" && event.message.role === "assistant") {
				stopReason = event.message.stopReason;
				answerText = event.message.content
					.filter(c => c.type === "text")
					.map(c => c.text)
					.join("\n");
				providerError = Boolean(event.message.errorMessage);
				if (providerError) {
					const error = event.message.errorMessage ?? "";
					providerErrorCategory = /429|rate.limit|quota|capacity/i.test(error)
						? "capacity"
						: /401|403|auth/i.test(error)
							? "authentication"
							: /timeout|network|socket|connection/i.test(error)
								? "transport"
								: "other";
				}
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
			const device = action === "machine-get" ? await machine.get() : undefined;
			const relevant = [...calls.values()].filter(
				c =>
					c.success &&
					(device
						? (c.toolName === "machine_profile" && c.action === "get") ||
							(c.toolName === "read" && c.resource === "xcsh://computer")
						: c.toolName === "person_profile" && c.action === action),
			);
			const matching = relevant.filter(c => isDeepStrictEqual(c.profile, device ?? current)).length;
			const score = device
				? {
						passed: matching > 0,
						canonicalCalls: relevant.length,
						matchingOutcomes: matching,
						schemaVersion: device.schemaVersion,
					}
				: action === "get"
					? scorePersonContract([...calls.values()], current)
					: {
							passed:
								matching > 0 &&
								(propertyForget
									? Boolean(current.suppressedProperties?.favorite_color) &&
										!current.suppressed.additionalProperty &&
										current.facts.additionalProperty?.some(
											p => p.propertyID === "preferred_editor" && p.value === "synthetic-editor",
										) === true &&
										!current.facts.additionalProperty?.some(p => p.propertyID === "favorite_color")
									: propertyValue
										? current.facts.additionalProperty?.some(
												p => p.propertyID === "favorite_color" && p.value === propertyValue,
											) === true && current.propertyProvenance?.favorite_color?.owner === "user"
										: action === "forget"
											? current.facts.jobTitle === undefined && Boolean(current.suppressed.jobTitle)
											: current.facts.jobTitle === title && current.provenance.jobTitle?.owner === "user"),
							canonicalCalls: relevant.length,
							matchingOutcomes: matching,
							schemaVersion: current.schemaVersion,
						};
			if (
				(action === "get" || device) &&
				[...calls.values()].some(
					c => c.toolName === "person_profile" && !["get", "sources"].includes(c.action ?? ""),
				)
			)
				score.passed = false;
			const historyRecapDetected = /clockwork|marker file|earlier software test/i.test(answerText);
			const answerWords = answerText.trim().split(/\s+/).length;
			if (action === "get" && (historyRecapDetected || (current.state === "empty" && answerWords > 50)))
				score.passed = false;
			results.push({ surface, sample, ...score });
			console.log(
				JSON.stringify({
					surface,
					sample,
					phase: "completed",
					factFields: Object.keys(current.facts),
					suppressedFields: Object.keys(current.suppressed),
					titleMatches: action !== "update" || propertyValue !== undefined || current.facts.jobTitle === title,
					historyRecapDetected,
					answerWords,
					elapsedMs: Date.now() - started,
					stopReason,
					providerError,
					providerErrorCategory,
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
