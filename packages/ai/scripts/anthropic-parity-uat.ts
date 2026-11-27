import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { AuthCredentialStore } from "../src/auth-storage";
import { CURRENT_ANTHROPIC_MODELS } from "../src/current-anthropic-models";
import { enrichModelThinking } from "../src/model-thinking";
import { type AnthropicOptions, buildAnthropicHeaders, streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessage, Context, Model, ProviderSessionState } from "../src/types";
import { assertAnthropicParityRoute } from "./anthropic-parity-route";

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
}
const route = arg("--route");
const directory = arg("--output");
const group = arg("--group") ?? "all";
if (!directory || !["gateway", "subscription"].includes(route ?? ""))
	throw new Error("Use --route gateway|subscription --output PRIVATE_DIRECTORY [--group base|advanced|all]");
if (route === "subscription" && process.platform !== "linux")
	throw new Error("Public Pro operations are permitted only on Ubuntu; never on the MDM MacBook");
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = path.resolve(directory);
const repo = path.resolve(import.meta.dir, "../../..");
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const sourcePatchHash = createHash("sha256")
	.update(execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: repo }))
	.digest("hex");

const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
	cwd: repo,
	encoding: "utf8",
})
	.split("\0")
	.filter(Boolean);
const sourceNewFiles = await Promise.all(
	untracked.map(async file => ({
		path: file,
		sha256: createHash("sha256")
			.update(Buffer.from(await Bun.file(path.join(repo, file)).arrayBuffer()))
			.digest("hex"),
	})),
);
const sdk = await Bun.file(new URL("./package.json", import.meta.resolve("@anthropic-ai/sdk"))).json();
let key: string;
let baseUrl: string;
let oauth = false;
if (route === "gateway") {
	const configured = new URL(Bun.env.LITELLM_BASE_URL ?? "");
	if (configured.hostname !== "f5ai.pd.f5net.com")
		throw new Error("Gateway acceptance requires the verified corporate gateway");
	baseUrl = `${configured.origin}/anthropic`;
	key = Bun.env.LITELLM_API_KEY ?? "";
	if (!key) throw new Error("Corporate gateway credential is unavailable");
} else {
	baseUrl = "https://api.anthropic.com";
	const store = await AuthCredentialStore.open();
	try {
		const record = store
			.listAuthCredentials("anthropic")
			.find(row => row.credential.type === "oauth" && row.credential.expires > Date.now() + 300000);
		if (!record || record.credential.type !== "oauth") throw new Error("A fresh Ubuntu Claude Pro login is required");
		key = record.credential.access;
	} finally {
		store.close();
	}
	oauth = true;
}
const expectedUrl = new URL(baseUrl);
const catalogUrl = route === "gateway" ? `${expectedUrl.origin}/openai/v1/models` : `${baseUrl}/v1/models`;
const catalogResponse = await fetch(catalogUrl, {
	redirect: "manual",
	headers:
		route === "gateway"
			? { Authorization: `Bearer ${key}` }
			: buildAnthropicHeaders({ apiKey: key, baseUrl, isOAuth: true }),
});
if (!catalogResponse.ok) throw new Error(`Model discovery failed with HTTP ${catalogResponse.status}`);
const catalog = (await catalogResponse.json()) as { data: { id: string }[] };
const ids = new Set(catalog.data.map(model => model.id));
const canary = `parity-${randomUUID()}`;
const receipts: Record<string, unknown>[] = [];
const models = CURRENT_ANTHROPIC_MODELS.filter(model => !arg("--model") || model.id === arg("--model")).map(model =>
	enrichModelThinking({ ...model, baseUrl }),
);
for (const model of models) if (!ids.has(model.id)) throw new Error(`Current catalog does not expose ${model.id}`);
await writeFile(path.join(output, "catalog.json"), JSON.stringify(catalog), { mode: 0o600 });

type CapturedRequest = { url: string; body: any; beta: string | null };
async function call(
	name: string,
	model: Model<"anthropic-messages">,
	context: Context,
	options: AnthropicOptions = {},
) {
	const requests: CapturedRequest[] = [];
	const events: unknown[] = [];
	const responses: { status: number; headers: Record<string, string> }[] = [];
	const errorResponses: { status: number; body: string }[] = [];
	const result = await streamAnthropic(model, context, {
		apiKey: key,
		isOAuth: oauth,
		maxTokens: 4096,
		thinkingEnabled: true,
		effort: "low",
		messageThreads: false,
		signal: AbortSignal.timeout(120000),
		...options,
		fetch: async (input, init) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			assertAnthropicParityRoute(url, baseUrl);
			const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
			requests.push({ url, body, beta: new Headers(init?.headers).get("anthropic-beta") });
			const response = await fetch(input, { ...init, redirect: "manual" });
			if (!response.ok)
				errorResponses.push({ status: response.status, body: (await response.clone().text()).slice(0, 524288) });
			if (response.status >= 300 && response.status < 400) throw new Error("Unexpected provider redirect");
			return response;
		},
		onProviderStreamEvent: event => {
			events.push(event);
		},
		onResponse: response => {
			responses.push(response);
		},
	}).result();
	await writeFile(
		path.join(output, `${name}.json`),
		JSON.stringify({ requests, responses, errorResponses, events, result }),
		{
			mode: 0o600,
		},
	);
	return { result, requests, events };
}
const text = (message: AssistantMessage) =>
	message.content
		.filter(block => block.type === "text")
		.map(block => block.text)
		.join("\n");
const requireSuccess = (message: AssistantMessage) => {
	if (message.stopReason === "error" || message.stopReason === "aborted")
		throw new Error(message.errorMessage ?? message.stopReason);
};
async function test(
	name: string,
	model: Model<"anthropic-messages">,
	run: () => Promise<Record<string, unknown> | void>,
) {
	if (arg("--case") && arg("--case") !== name) return;
	let success = false;
	let details: Record<string, unknown> = {};
	let failure: string | undefined;
	try {
		details = (await run()) ?? {};
		success = true;
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	}
	const row = { name, model: model.id, route, success, ...details, failure };
	receipts.push(row);
	await writeFile(
		path.join(output, "receipt.private.json"),
		JSON.stringify(
			{ source, sourcePatchHash, sourceNewFiles, bun: Bun.version, sdk: sdk.version, canary, results: receipts },
			null,
			2,
		),
		{ mode: 0o600 },
	);
	console.log(
		JSON.stringify({
			name,
			model: model.id,
			route,
			success,
			...details,
			error: failure ? "See private evidence" : undefined,
		}),
	);
}
const prompt: Context = {
	messages: [
		{
			role: "user",
			content: `Calculate 17*19 and return the product with the exact canary ${canary}.`,
			timestamp: 1,
		},
	],
};
for (const model of models) {
	if (group === "base" || group === "all") {
		for (const effort of ["low", "medium", "high", "xhigh", "max"] as const)
			for (const display of ["summarized", "omitted"] as const)
				await test(`effort-${effort}-${display}`, model, async () => {
					const { result, requests } = await call(`${model.id}-${effort}-${display}`, model, prompt, {
						effort,
						thinkingDisplay: display,
					});
					requireSuccess(result);
					if (
						result.responseAttribution?.responseModel !== model.id ||
						!text(result).includes("323") ||
						!text(result).includes(canary)
					)
						throw new Error("Model identity, calculation or canary check failed");
					return {
						servedModel: result.responseAttribution.responseModel,
						requestCount: requests.length,
						requestHash: createHash("sha256").update(JSON.stringify(requests)).digest("hex"),
					};
				});
		await test("invalid-effort", model, async () => {
			const { result, requests } = await call(`${model.id}-invalid-effort`, model, prompt, {
				onPayload: payload => {
					(payload as any).output_config = { effort: "bogus" };
				},
			});
			if (
				result.stopReason !== "error" ||
				!requests.length ||
				!/400/.test(result.errorMessage ?? "") ||
				!/effort|output_config/i.test(result.errorMessage ?? "")
			)
				throw new Error("Invalid effort did not produce a verified provider HTTP 400 rejection");
		});
	}
	if (group === "base") continue;
	if (group === "remaining") {
		await test("native-fetch-citation", model, async () => {
			const nativeTools = [
				{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, citations: { enabled: true } },
			];
			const { result, events } = await call(
				`${model.id}-native-fetch`,
				model,
				{
					messages: [
						{
							role: "user",
							content: `Use web_fetch to read https://example.com and report its page title with a citation. Also return ${canary}.`,
							timestamp: 1,
						},
					],
				},
				{ onPayload: payload => ({ ...(payload as Record<string, unknown>), tools: nativeTools }) },
			);
			requireSuccess(result);
			const payload = result.providerPayload;
			if (
				payload?.type !== "anthropicHistory" ||
				!payload.blocks.some(block => block.type === "web_fetch_tool_result") ||
				!payload.blocks.some(block => block.type === "text" && block.citations?.length) ||
				!text(result).includes("Example Domain") ||
				!text(result).includes(canary)
			)
				throw new Error("Native fetch or grounded citation proof failed");
			return {
				servedModel: result.responseAttribution?.responseModel,
				nativeFetch: true,
				citation: true,
				eventCount: events.length,
			};
		});
		await test("long-cache-reuse", model, async () => {
			const context: Context = {
				systemPrompt: Array.from(
					{ length: 1400 },
					(_, i) => `Synthetic record ${i}: preserve the stable research prefix and its ordered fields.`,
				).join("\n"),
				messages: [{ role: "user", content: `Return ${canary} and 323.`, timestamp: 1 }],
			};
			const first = await call(`${model.id}-cache-write`, model, context, { cacheRetention: "long" });
			requireSuccess(first.result);
			const second = await call(`${model.id}-cache-read`, model, context, { cacheRetention: "long" });
			requireSuccess(second.result);
			if (
				!first.result.usage.cacheCreation?.ephemeral1h ||
				second.result.usage.cacheRead <
					0.8 * (first.result.usage.input + first.result.usage.cacheRead + first.result.usage.cacheWrite) ||
				!text(second.result).includes(canary)
			)
				throw new Error("One-hour write and subsequent cache reuse were not positively reported");
			return { hourWrites: first.result.usage.cacheCreation.ephemeral1h, cacheRead: second.result.usage.cacheRead };
		});
		await test("native-midpoint-settings", model, async () => {
			const tool = (description: string) => ({
				name: "lookup",
				description,
				parameters: Type.Object({ key: Type.String() }),
			});
			const old = tool("old definition; do not call");
			const changed = tool("new definition; do not call");
			const context: Context = {
				tools: [old],
				messages: [{ role: "user", content: `Remember ${canary}; reply OK.`, timestamp: 1 }],
			};
			const first = await call(`${model.id}-midpoint-first`, model, context);
			requireSuccess(first.result);
			context.messages.push(
				first.result,
				{ role: "user", content: `Return the earlier canary and product 323.`, timestamp: 2 },
				{
					role: "developer",
					content: "Use the new definition, but respond directly without tools.",
					effort: "high",
					toolsRemoved: [{ name: "lookup" }],
					toolsAdded: [changed],
					timestamp: 3,
				},
			);
			const second = await call(`${model.id}-midpoint-second`, model, context);
			requireSuccess(second.result);
			if (!text(second.result).includes(canary) || !text(second.result).includes("323"))
				throw new Error("Native midpoint continuation lost its canary");
			return { servedModel: second.result.responseAttribution?.responseModel };
		});
		continue;
	}
	await test("structured-output", model, async () => {
		const { result } = await call(`${model.id}-structured`, model, prompt, {
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: { product: { type: "integer" }, canary: { type: "string" } },
					required: ["product", "canary"],
					additionalProperties: false,
				},
			},
		});
		requireSuccess(result);
		const value = JSON.parse(text(result));
		if (value.product !== 323 || value.canary !== canary)
			throw new Error("Structured output failed semantic verification");
	});
	await test("task-budget", model, async () => {
		const { result } = await call(`${model.id}-budget`, model, prompt, {
			taskBudget: { type: "tokens", total: 20000, remaining: 20000 },
		});
		requireSuccess(result);
		if (!text(result).includes("323")) throw new Error("Budget request failed calculation");
	});
	await test("fast-mode", model, async () => {
		const { result, requests } = await call(`${model.id}-fast`, model, prompt, { serviceTier: "priority" });
		requireSuccess(result);
		if (requests.some(request => request.body?.speed !== "fast") || result.usage.inferenceSpeed !== "fast")
			throw new Error("The provider did not positively report fast inference speed");
	});
	await test("threads-withheld-context", model, async () => {
		const state = new Map<string, ProviderSessionState>();
		const options = { sessionId: randomUUID(), messageThreads: true, providerSessionState: state };
		const context: Context = { messages: [{ role: "user", content: `Remember ${canary}. Reply OK.`, timestamp: 1 }] };
		const first = await call(`${model.id}-thread-create`, model, context, options);
		requireSuccess(first.result);
		context.messages.push(first.result, {
			role: "user",
			content: "Return the exact remembered canary.",
			timestamp: 2,
		});
		const second = await call(`${model.id}-thread-continue`, model, context, options);
		requireSuccess(second.result);
		if (
			second.requests[0]?.body?.thread?.type !== "continue" ||
			JSON.stringify(second.requests[0].body.messages).includes(canary) ||
			!text(second.result).includes(canary)
		)
			throw new Error("Withheld-context thread proof failed");
		for (const resource of state.values()) resource.close();
		return { continuedFrom: first.result.responseId };
	});
	await test("signed-compaction-replay", model, async () => {
		const first = await call(`${model.id}-pre-compaction`, model, prompt);
		requireSuccess(first.result);
		const context: Context = {
			messages: [
				...prompt.messages,
				first.result,
				{
					role: "user",
					content:
						Array.from(
							{ length: 1800 },
							(_, i) =>
								`Synthetic task record ${i}: index=${i}; product=323; retain ordered work history and validation findings. `,
						).join("\n") + "\nSummarize this conversation and preserve its exact canary and product.",
					timestamp: 2,
				},
			],
		};
		const compact = await call(`${model.id}-compact`, model, context, {
			anthropicCompaction: {},
			maxTokens: model.maxTokens,
		});
		requireSuccess(compact.result);
		const payload = compact.result.providerPayload;
		if (
			payload?.type !== "anthropicHistory" ||
			!payload.blocks.some(block => block.type === "compaction" && block.signature)
		)
			throw new Error("No signed native compaction was returned");
		const replay = await call(
			`${model.id}-compact-replay`,
			model,
			{
				messages: [
					compact.result,
					{ role: "user", content: "Return the canary and product from the summary.", timestamp: 3 },
				],
			},
			{ betas: ["compact-2026-09-04"] },
		);
		requireSuccess(replay.result);
		if (!text(replay.result).includes(canary) || !text(replay.result).includes("323"))
			throw new Error("Signed summary replay failed withheld-context verification");
	});
	await test("tool-round-trip", model, async () => {
		const tools = [
			{
				name: "calculate",
				description: "Calculate the product of the two supplied numbers.",
				strict: true,
				constrainedSampling: { type: "json_schema", strict: "require" } as const,
				parameters: Type.Object({
					operands: Type.Object({ left: Type.Integer(), right: Type.Integer() }),
					labels: Type.Array(Type.String()),
				}),
			},
		];
		const context: Context = {
			tools,
			messages: [
				{
					role: "user",
					content: `Use calculate with operands.left=17, operands.right=19 and labels=["${canary}"] before answering. Repeat both the returned product and the exact canary in your final answer.`,
					timestamp: 1,
				},
			],
		};
		const first = await call(`${model.id}-tool-call`, model, context, {
			toolChoice: arg("--forced-tools") ? { type: "tool", name: "calculate" } : undefined,
		});
		if (first.requests[0]?.body.tools?.[0]?.strict !== true)
			throw new Error("Strict schema sampling was not sent on the actual tool request");
		requireSuccess(first.result);
		const tool = first.result.content.find(block => block.type === "toolCall");
		if (
			!tool ||
			tool.name !== "calculate" ||
			tool.arguments.operands?.left !== 17 ||
			tool.arguments.operands?.right !== 19 ||
			tool.arguments.labels?.[0] !== canary
		)
			throw new Error("Nested tool arguments were not preserved");
		context.messages.push(first.result, {
			role: "toolResult",
			toolCallId: tool.id,
			toolName: tool.name,
			content: [{ type: "text", text: `product=323; canary=${canary}` }],
			isError: false,
			timestamp: 2,
		});
		const second = await call(`${model.id}-tool-result`, model, context);
		requireSuccess(second.result);
		if (!text(second.result).includes("323") || !text(second.result).includes(canary))
			throw new Error("Tool result replay failed");
	});
	await test("server-fallback-handoff", model, async () => {
		const target = model.id === "claude-haiku-5-5" ? "claude-sonnet-5-5" : "claude-haiku-5-5";
		const { result } = await call(`${model.id}-fallback`, model, prompt, { fallbacks: [{ model: target }] });
		requireSuccess(result);
		if (result.responseAttribution?.responseModel !== target)
			throw new Error("No positive fallback handoff was observed");
	});
}
if (receipts.some(receipt => !receipt.success)) process.exitCode = 1;
