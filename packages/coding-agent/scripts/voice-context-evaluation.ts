/** Live executing-agent evaluation with synthetic tenant transport; no real tenant calls. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir } from "@f5-sales-demo/pi-utils";
import { type ContextFlowEvent, scoreContextFlow } from "../src/remote-control/context-evaluation";

const source = resolve(process.env.XCSH_CONTEXT_EVAL_SOURCE ?? join(import.meta.dir, "../../.."));
const baseline = process.argv.includes("--baseline");
const scenarioFilter = process.argv.find(value => value.startsWith("--scenario="))?.slice("--scenario=".length);
const surfaceFilter = process.argv.find(value => value.startsWith("--surface="))?.slice("--surface=".length);
const output = process.env.XCSH_CONTEXT_EVAL_OUTPUT;
if (!output) throw new Error("Set XCSH_CONTEXT_EVAL_OUTPUT to a private evidence directory");
await mkdir(output, { recursive: true, mode: 0o700 });
const modulePath = (file: string) => join(source, "packages/coding-agent/src", file);
const { createAgentSession, discoverAuthStorage, Settings } = await import(modulePath("sdk.ts"));
const { ContextService } = await import(modulePath("services/xcsh-context.ts"));
const { ModelRegistry } = await import(modulePath("config/model-registry.ts"));
const { SessionManager } = await import(modulePath("session/session-manager.ts"));
const { voiceDelegation } = await import(modulePath("remote-control/voice-delegation.ts"));
const { PersonProfileService } = await import(modulePath("person-profile/service.ts"));
const root = await mkdtemp(join(tmpdir(), "xcsh-context-evaluation-"));
const originalFetch = globalThis.fetch;
const savedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("XCSH_")));
for (const key of Object.keys(savedEnv)) delete process.env[key];
const auth = await discoverAuthStorage(getAgentDir());
const registry = new ModelRegistry(auth);
const results: unknown[] = [];
try {
	await registry.refreshProvider("openai-codex", "online");
	const model = registry.find("openai-codex", savedEnv.XCSH_CONTEXT_EVAL_MODEL ?? "gpt-5.6-sol");
	if (!model) throw new Error("Evaluation model unavailable");
	const scenarios = [
		{
			id: "profile-identity",
			turns: [
				"Apply the beta context and tell me which HTTP load balancers in its default namespace have my creator ID.",
			],
			identity: false,
		},
		{
			id: "combined",
			turns: [
				"Apply the beta context and tell me which HTTP load balancers in its default namespace have my creator ID.",
			],
			identity: true,
		},
		{
			id: "follow-up",
			turns: ["Apply the beta context.", "Which HTTP load balancers in its default namespace have my creator ID?"],
			identity: true,
		},
		{
			id: "missing-context",
			turns: [
				"Apply the gamma-demo context and tell me which HTTP load balancers in its default namespace have my creator ID.",
			],
			identity: true,
		},
		{
			id: "auth-failure",
			turns: [
				"Apply the beta context and tell me which HTTP load balancers in its default namespace have my creator ID.",
			],
			identity: true,
		},
		{
			id: "unknown-identity",
			turns: [
				"Apply the beta context and tell me which HTTP load balancers in its default namespace have my creator ID.",
			],
			identity: false,
		},
	];
	for (const surface of ["tui", "voice-delegated-agent"]) {
		if (surfaceFilter && surface !== surfaceFilter) continue;
		for (const scenario of scenarios) {
			if (scenarioFilter && scenario.id !== scenarioFilter) continue;
			ContextService._resetForTest();
			const cwd = join(root, `${surface}-${scenario.id}`);
			await mkdir(cwd, { recursive: true });
			const settings = await Settings.init({ cwd, agentDir: cwd, inMemory: true });
			const service = ContextService.init(join(cwd, "contexts"));
			// Isolate the existing cross-session API cache between fixtures and evaluation runs.
			const fixtureKey = crypto.randomUUID();
			let turn = 0;
			const trace: Array<Record<string, unknown>> = [];
			const flow: ContextFlowEvent[] = [];
			globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
				const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
				if (url.hostname.endsWith(".console.ves.volterra.io")) {
					if (
						!["synthetic-alpha.console.ves.volterra.io", "synthetic-beta.console.ves.volterra.io"].includes(
							url.hostname,
						)
					) {
						throw new Error("Evaluation blocks real tenant traffic");
					}
					const method = init?.method ?? "GET";
					if (method !== "GET" && method !== "HEAD") throw new Error("Evaluation permits tenant reads only");
					const selected = url.hostname.includes("synthetic-beta") ? "beta" : "alpha";
					const credentialMatches =
						new Headers(init?.headers).get("Authorization") === `APIToken synthetic-${fixtureKey}-${selected}`;
					const inventory = /http_loadbalancers/.test(url.pathname);
					trace.push({ kind: "tenant-request", turn, selected, inventory, credentialMatches, path: url.pathname });
					if (inventory) flow.push({ kind: "query", context: selected, credentialMatches });
					if (!credentialMatches || (scenario.id === "auth-failure" && selected === "beta"))
						return Response.json({}, { status: 401 });
					if (url.pathname.endsWith("/namespaces")) return Response.json({ items: [{ name: "default" }] });
					if (inventory) {
						const items = [
							{ name: "synthetic-owned", namespace: "default", creator_id: "synthetic-human" },
							{ name: "synthetic-other", namespace: "default", creator_id: "synthetic-other-human" },
						];
						const item = items.find(value => url.pathname.endsWith(`/${value.name}`));
						return Response.json(
							item ? { metadata: item, system_metadata: { creator_id: item.creator_id }, spec: {} } : { items },
						);
					}
					return Response.json({ message: "Synthetic fixture has no identity mapping" }, { status: 403 });
				}
				return originalFetch(input, init);
			}) as typeof fetch;
			for (const name of ["alpha", "beta"])
				await service.createContext({
					name,
					apiUrl: `https://synthetic-${name}.console.ves.volterra.io`,
					apiToken: `synthetic-${fixtureKey}-${name}`,
					defaultNamespace: "default",
				});
			await service.activate("alpha");
			const manager = SessionManager.inMemory();
			const person = new PersonProfileService(join(cwd, "person.json"));
			if (scenario.id === "profile-identity")
				await person.update(
					{
						additionalProperty: [
							{
								propertyID: "f5_creator_id_synthetic_beta",
								name: "Confirmed creator ID in F5 XC tenant synthetic-beta (context beta)",
								value: "synthetic-human",
							},
						],
					},
					0,
				);
			if (scenario.identity)
				manager.appendMessage({
					role: "user",
					content: [
						{
							type: "text",
							text: "For this synthetic evaluation, my creator ID in the beta tenant is synthetic-human.",
						},
					],
					timestamp: Date.now(),
				});
			const { session } = await createAgentSession({
				cwd,
				agentDir: cwd,
				authStorage: auth,
				modelRegistry: registry,
				model,
				settings,
				sessionManager: manager,
				thinkingLevel: "medium",
				disableExtensionDiscovery: true,
				enableMCP: false,
				enableLsp: false,
				rules: [],
				contextFiles: [],
				skills: [],
				promptTemplates: [],
				slashCommands: [],
				profileDiscovery: false,
				personProfileService: person,
				toolNames: ["read", "xcsh_api", ...(baseline ? [] : ["xcsh_context"])],
				extensions: [
					(api: any) =>
						api.on("tool_call", (event: any) => {
							if (
								event.toolName === "read" &&
								event.input?.path !== "xcsh://user" &&
								!String(event.input?.path ?? "").startsWith("xcsh://api-catalog")
							) {
								return {
									block: true,
									reason:
										"This evaluation permits API catalog reads and its isolated synthetic person profile only.",
								};
							}
						}),
				],
			});
			trace.length = 0;
			let answer = "";
			let providerError = false;
			const unsubscribe = session.subscribe((event: any) => {
				if (event.type === "tool_execution_start")
					trace.push({ kind: "tool-start", turn, tool: event.toolName, id: event.toolCallId, args: event.args });
				if (event.type === "tool_execution_end") {
					trace.push({ kind: "tool-end", turn, id: event.toolCallId, success: !event.isError });
					const start = trace.find(row => row.kind === "tool-start" && row.id === event.toolCallId);
					const args = start?.args as { action?: string; name?: string } | undefined;
					if (start?.tool === "xcsh_context" && args?.action === "activate") {
						flow.push({
							kind: "selection",
							context: args.name ?? "",
							outcome: event.isError
								? "failed"
								: event.result?.details?.authStatus === "connected"
									? "connected"
									: "auth_error",
						});
					}
					if (
						start?.tool === "xcsh_context" &&
						args?.action === "list" &&
						scenario.id === "missing-context" &&
						!event.isError
					) {
						// The complete fixture list proves the explicitly requested name is absent.
						flow.push({ kind: "selection", context: "gamma-demo", outcome: "failed" });
					}
				}
				if (event.type === "message_end" && event.message.role === "assistant") {
					answer = event.message.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("\n");
					providerError ||= Boolean(event.message.errorMessage);
					trace.push({
						kind: "assistant-turn",
						turn,
						stopReason: event.message.stopReason,
						answerWords: answer.split(/\s+/).filter(Boolean).length,
					});
				}
			});
			const timeout = setTimeout(() => void session.abort(), 120000);
			console.log(JSON.stringify({ surface, scenario: scenario.id, phase: "started", baseline }));
			try {
				for (const request of scenario.turns) {
					turn++;
					await session.prompt(surface === "tui" ? request : voiceDelegation(request, `user: ${request}`));
				}
				const inventory = trace.filter(row => row.kind === "tenant-request" && row.inventory);
				const activations = trace.filter(
					row =>
						row.kind === "tool-start" && row.tool === "xcsh_context" && (row.args as any)?.action === "activate",
				);
				const activationSucceeded = activations.some(row =>
					trace.some(end => end.kind === "tool-end" && end.id === row.id && end.success),
				);
				const blocked = ["missing-context", "auth-failure"].includes(scenario.id);
				const knownIdentity = (scenario.identity || scenario.id === "profile-identity") && !blocked;
				const score = scoreContextFlow(
					flow,
					scenario.id === "missing-context" ? "gamma-demo" : "beta",
					blocked ? "blocked" : knownIdentity ? "query" : "clarification",
				);
				const outcome = {
					surface,
					scenario: scenario.id,
					baseline,
					providerError,
					activationSucceeded,
					activeContextMatches: service.getStatus().activeContextName === "beta",
					inventoryRequests: inventory.length,
					wrongTenantRequests: inventory.filter(row => row.selected !== "beta" || !row.credentialMatches).length,
					ownedResourceReported: answer.includes("synthetic-owned"),
					clarificationRequested: /\?|provide|share|need your|creator ID.*needed/i.test(answer),
					answerWords: answer.split(/\s+/).filter(Boolean).length,
					toolCalls: trace.filter(row => row.kind === "tool-start").length,
					assistantTurns: trace.filter(row => row.kind === "assistant-turn").length,
					flow: score,
					passed:
						!providerError &&
						score.passed &&
						(blocked
							? inventory.length === 0 && !answer.includes("synthetic-owned")
							: activationSucceeded &&
								service.getStatus().activeContextName === "beta" &&
								inventory.every(row => row.selected === "beta" && row.credentialMatches) &&
								(knownIdentity
									? inventory.length > 0 && answer.includes("synthetic-owned")
									: /\?|provide|share|need your/i.test(answer))),
				};
				results.push(outcome);
				// Synthetic turns only. Never persist system prompts, provider payloads, credentials, or real session history.
				await writeFile(
					join(output, `${surface}-${scenario.id}.json`),
					JSON.stringify({ outcome, trace, syntheticAnswer: answer }, null, 2),
					{ mode: 0o600 },
				);
				console.log(JSON.stringify(outcome));
			} finally {
				clearTimeout(timeout);
				unsubscribe();
				await session.dispose();
			}
		}
	}
	await writeFile(join(output, "results.json"), JSON.stringify({ baseline, model: model.id, results }, null, 2), {
		mode: 0o600,
	});
} finally {
	ContextService._resetForTest();
	globalThis.fetch = originalFetch;
	for (const [key, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[key] = value;
	await rm(root, { recursive: true, force: true });
}
