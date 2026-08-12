#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentEvent, ThinkingLevel as ThinkingLevelType } from "@f5-sales-demo/pi-agent-core";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { ImageContent, Model } from "@f5-sales-demo/pi-ai";
import { parse as parseYaml } from "yaml";
import { defineRpcClientTool, RpcClient, type RpcClientOptions } from "../src/modes/rpc/rpc-client";

export type AuthProfileUatId = "litellm-gpt" | "litellm-opus" | "google-enterprise";
export type RpcUatLaunchMode = "source" | "native";

export interface AuthProfileUatProfile {
	id: AuthProfileUatId;
	label: string;
	provider: "litellm" | "anthropic" | "google-antigravity";
	modelId: "gpt-5.6-sol" | "claude-opus-5" | "gemini-3.6-flash-high";
	thinkingLevel: ThinkingLevelType;
	kind: "litellm" | "google-enterprise";
	requiredTier?: "standard-tier";
}

export const AUTH_PROFILE_UAT_PROFILES: readonly AuthProfileUatProfile[] = [
	{
		id: "litellm-gpt",
		label: "LiteLLM / GPT-5.6 Sol High",
		provider: "litellm",
		modelId: "gpt-5.6-sol",
		thinkingLevel: ThinkingLevel.High,
		kind: "litellm",
	},
	{
		id: "litellm-opus",
		label: "LiteLLM / Claude Opus 5 High",
		provider: "anthropic",
		modelId: "claude-opus-5",
		thinkingLevel: ThinkingLevel.High,
		kind: "litellm",
	},
	{
		id: "google-enterprise",
		label: "Google Antigravity Enterprise / Gemini 3.6 Flash High",
		provider: "google-antigravity",
		modelId: "gemini-3.6-flash-high",
		thinkingLevel: ThinkingLevel.High,
		kind: "google-enterprise",
		requiredTier: "standard-tier",
	},
];

interface RpcProfileState {
	model?: Pick<Model, "provider" | "id">;
	thinkingLevel: ThinkingLevelType | undefined;
}

interface AvailableModel {
	provider: string;
	id: string;
}

export interface RpcProfileScenarioClient {
	promptAndWait(message: string, images?: ImageContent[], timeout?: number): Promise<AgentEvent[]>;
	getLastAssistantText(): Promise<string | null>;
}

export interface RpcProfileScenarioCheck {
	name: string;
	status: "PASS";
	durationMs: number;
}

export interface RpcProfileScenarioReport {
	profile: AuthProfileUatId;
	checks: RpcProfileScenarioCheck[];
}

interface EnterpriseCredentialContract {
	type?: string;
	projectId?: string;
	tierId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	const record = asRecord(value);
	if (!record) throw new Error(`${label} is missing or invalid`);
	return record;
}

function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

export function resolveRpcUatLaunch(
	mode: RpcUatLaunchMode,
	repoRoot: string,
): Required<Pick<RpcClientOptions, "cliPath" | "launchMode">> {
	return mode === "native"
		? {
				cliPath: path.join(repoRoot, "packages/coding-agent/dist/xcsh"),
				launchMode: "native",
			}
		: {
				cliPath: path.join(repoRoot, "packages/coding-agent/src/cli.ts"),
				launchMode: "bun",
			};
}

export function assertRpcProfileState(
	profile: AuthProfileUatProfile,
	state: RpcProfileState,
	availableModels: readonly AvailableModel[],
): void {
	const expectedModel = `${profile.provider}/${profile.modelId}`;
	const activeModel = state.model ? `${state.model.provider}/${state.model.id}` : "(none)";
	if (activeModel !== expectedModel) {
		throw new Error(`Expected active model ${expectedModel}; received ${activeModel}`);
	}
	if (state.thinkingLevel !== profile.thinkingLevel) {
		throw new Error(
			`Expected ${profile.thinkingLevel} thinking level for ${expectedModel}; received ${state.thinkingLevel}`,
		);
	}
	if (!availableModels.some(model => model.provider === profile.provider && model.id === profile.modelId)) {
		throw new Error(`Certified model is absent from discovery: ${expectedModel}`);
	}
}

export function assertLiteLLMDocumentContract(
	profile: AuthProfileUatProfile,
	document: unknown,
	expectedBaseUrl: string,
): void {
	if (profile.kind !== "litellm") throw new Error(`${profile.id} is not a LiteLLM profile`);
	const providers = requireRecord(requireRecord(document, "models.yml").providers, "models.yml providers");
	const root = normalizeBaseUrl(expectedBaseUrl);

	if (profile.provider === "anthropic") {
		const provider = requireRecord(providers.anthropic, "Anthropic provider");
		if (provider.baseUrl !== `${root}/anthropic`) {
			throw new Error("Anthropic base URL does not match the certified LiteLLM route");
		}
		return;
	}

	const provider = requireRecord(providers.litellm, "LiteLLM provider");
	if (typeof provider.baseUrl !== "string" || !provider.baseUrl.startsWith(`${root}/`)) {
		throw new Error("GPT base URL does not match the certified LiteLLM route");
	}
	if (provider.api !== "openai-completions") {
		throw new Error("GPT profile must use the openai-completions API contract");
	}
	const overrides = requireRecord(provider.modelOverrides, "LiteLLM model overrides");
	const gpt = requireRecord(overrides["gpt-5.6-sol"], "GPT-5.6 Sol override");
	if (gpt.reasoning !== true || !Array.isArray(gpt.input) || !gpt.input.includes("image")) {
		throw new Error("GPT-5.6 Sol profile must enable reasoning and image input");
	}
}

export function assertEnterpriseCredentialContract(
	credential: EnterpriseCredentialContract | undefined,
	expectedProjectId: string,
): void {
	if (credential?.type !== "oauth") throw new Error("Canonical google-antigravity OAuth credential is missing");
	if (credential.projectId !== expectedProjectId) {
		throw new Error(`Enterprise credential project does not match ${expectedProjectId}`);
	}
	if (credential.tierId !== "standard-tier") {
		throw new Error("Enterprise credential was not certified for standard-tier");
	}
}

function requireAssistantText(text: string | null, expected: RegExp, check: string): void {
	if (!text || !expected.test(text)) throw new Error(`${check} response did not satisfy ${expected}`);
}

function requireAssistantIncludes(text: string | null, expected: string, check: string): void {
	if (!text?.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) {
		throw new Error(`${check} response did not include the expected literal text`);
	}
}

function requireSuccessfulTool(events: AgentEvent[], toolName: string, expectedText?: string): void {
	const event = events.find(
		(candidate): candidate is Extract<AgentEvent, { type: "tool_execution_end" }> =>
			candidate.type === "tool_execution_end" && candidate.toolName === toolName,
	);
	if (!event) throw new Error(`Required tool was not called: ${toolName}`);
	if (event.isError) throw new Error(`${toolName} returned an error`);
	if (expectedText && !JSON.stringify(event.result).includes(expectedText)) {
		throw new Error(`${toolName} result did not contain the expected marker`);
	}
}

export async function runRpcProfileScenario(options: {
	client: RpcProfileScenarioClient;
	profile: AuthProfileUatProfile;
	image: ImageContent;
	imagePath: string;
	nonce?: string;
}): Promise<RpcProfileScenarioReport> {
	const { client, profile, image, imagePath } = options;
	const nonce = options.nonce ?? `uat-${profile.id}-${Date.now()}`;
	const checks: RpcProfileScenarioCheck[] = [];
	const run = async (name: string, operation: () => Promise<void>) => {
		const startedAt = performance.now();
		await operation();
		checks.push({ name, status: "PASS", durationMs: performance.now() - startedAt });
	};

	await run("multi-turn seed", async () => {
		await client.promptAndWait(
			`Store this nonce for the next turn: ${nonce}. Do not call tools. Reply with the nonce.`,
			undefined,
			180_000,
		);
		requireAssistantIncludes(await client.getLastAssistantText(), nonce, "multi-turn seed");
	});

	await run("multi-turn recall", async () => {
		await client.promptAndWait(
			"Reply with only the nonce from the previous turn. Do not call tools.",
			undefined,
			180_000,
		);
		requireAssistantIncludes(await client.getLastAssistantText(), nonce, "multi-turn recall");
	});

	await run("host tool call", async () => {
		const events = await client.promptAndWait(
			`You MUST call uat_echo exactly once with message ${nonce}. After the tool returns, include its exact result in your answer.`,
			undefined,
			180_000,
		);
		requireSuccessfulTool(events, "uat_echo", `echo:${nonce}`);
		requireAssistantIncludes(await client.getLastAssistantText(), `echo:${nonce}`, "host tool");
	});

	await run("direct image input", async () => {
		await client.promptAndWait(
			"Identify the colored shape in this attached image. Include both its color and shape in one short sentence.",
			[image],
			180_000,
		);
		requireAssistantText(await client.getLastAssistantText(), /red[\s\S]*circle|circle[\s\S]*red/i, "direct image");
	});

	await run("inspect_image tool call", async () => {
		const events = await client.promptAndWait(
			`You MUST call inspect_image on ${JSON.stringify(imagePath)} and ask for the color and shape. Then summarize its result.`,
			undefined,
			180_000,
		);
		requireSuccessfulTool(events, "inspect_image");
		requireAssistantText(await client.getLastAssistantText(), /red[\s\S]*circle|circle[\s\S]*red/i, "inspect_image");
	});

	return { profile: profile.id, checks };
}

async function validatePersistedContract(
	profile: AuthProfileUatProfile,
	agentDir: string,
	expectedProjectId?: string,
): Promise<void> {
	if (profile.kind === "litellm") {
		const expectedBaseUrl = Bun.env.LITELLM_BASE_URL?.trim();
		if (!expectedBaseUrl) throw new Error("LITELLM_BASE_URL is required for LiteLLM UAT");
		const modelsPath = path.join(agentDir, "models.yml");
		const [content, stat] = await Promise.all([fs.readFile(modelsPath, "utf8"), fs.stat(modelsPath)]);
		if ((stat.mode & 0o077) !== 0)
			throw new Error("models.yml must be owner-only because it can contain a credential");
		assertLiteLLMDocumentContract(profile, parseYaml(content), expectedBaseUrl);
		return;
	}

	if (!expectedProjectId) throw new Error("--project is required for Google enterprise UAT");
	const { discoverAuthStorage } = await import("../src/sdk");
	const storage = await discoverAuthStorage(agentDir);
	try {
		assertEnterpriseCredentialContract(storage.get("google-antigravity"), expectedProjectId);
		if (storage.list().includes("google-antigravity-enterprise")) {
			throw new Error("Enterprise alias was persisted instead of the canonical provider");
		}
	} finally {
		storage.close();
	}
}

interface CliOptions {
	profile: AuthProfileUatProfile;
	launch: RpcUatLaunchMode;
	project?: string;
}

function parseCliOptions(argv: string[]): CliOptions {
	const value = (flag: string) => {
		const index = argv.indexOf(flag);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const profileId = value("--profile");
	const profile = AUTH_PROFILE_UAT_PROFILES.find(candidate => candidate.id === profileId);
	if (!profile) {
		throw new Error(
			`--profile must be one of: ${AUTH_PROFILE_UAT_PROFILES.map(candidate => candidate.id).join(", ")}`,
		);
	}
	const launch = value("--launch") ?? "source";
	if (launch !== "source" && launch !== "native") throw new Error("--launch must be source or native");
	return { profile, launch, project: value("--project") };
}

export async function runAuthProfileRpcUat(options: CliOptions): Promise<{
	profile: AuthProfileUatId;
	launch: RpcUatLaunchMode;
	model: string;
	checks: RpcProfileScenarioCheck[];
}> {
	const repoRoot = path.resolve(import.meta.dir, "../../..");
	const agentDir = Bun.env.PI_CODING_AGENT_DIR?.trim();
	if (!agentDir) throw new Error("PI_CODING_AGENT_DIR must point to the isolated authenticated UAT profile");
	const imagePath = path.join(repoRoot, "packages/ai/test/data/red-circle.png");
	const image: ImageContent = {
		type: "image",
		data: Buffer.from(await fs.readFile(imagePath)).toString("base64"),
		mimeType: "image/png",
	};
	const launch = resolveRpcUatLaunch(options.launch, repoRoot);
	const client = new RpcClient({
		...launch,
		cwd: repoRoot,
		env: { PI_CODING_AGENT_DIR: agentDir },
		args: ["--no-session"],
		customTools: [
			defineRpcClientTool<{ message: string }>({
				name: "uat_echo",
				description: "Echoes a UAT marker verbatim so RPC host tool transport can be certified.",
				parameters: {
					type: "object",
					properties: { message: { type: "string" } },
					required: ["message"],
					additionalProperties: false,
				},
				execute: ({ message }) => `echo:${message}`,
			}),
		],
	});

	try {
		await client.start();
		const [state, availableModels] = await Promise.all([client.getState(), client.getAvailableModels()]);
		assertRpcProfileState(options.profile, state, availableModels);
		await validatePersistedContract(options.profile, agentDir, options.project);
		const scenario = await runRpcProfileScenario({ client, profile: options.profile, image, imagePath });
		return {
			profile: options.profile.id,
			launch: options.launch,
			model: `${options.profile.provider}/${options.profile.modelId}`,
			checks: scenario.checks,
		};
	} finally {
		client.stop();
	}
}

function redactError(error: unknown): string {
	let message = error instanceof Error ? error.message : String(error);
	for (const secret of [Bun.env.LITELLM_API_KEY, Bun.env.OPENAI_API_KEY, Bun.env.GEMINI_API_KEY]) {
		if (secret) message = message.split(secret).join("[REDACTED]");
	}
	return message.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]");
}

if (import.meta.main) {
	runAuthProfileRpcUat(parseCliOptions(process.argv.slice(2)))
		.then(report => console.log(JSON.stringify(report, null, 2)))
		.catch(error => {
			console.error(`FAIL: ${redactError(error)}`);
			process.exitCode = 1;
		});
}
