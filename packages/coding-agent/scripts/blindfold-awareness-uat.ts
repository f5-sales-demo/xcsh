#!/usr/bin/env bun
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { Settings } from "../src/config/settings";
import type { ExtensionFactory } from "../src/extensibility/extensions";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

const mode = process.argv[2] as "eager" | "progressive";
const output = process.argv[3];
if (!["eager", "progressive"].includes(mode) || !output)
	throw new Error("Usage: bun blindfold-awareness-uat.ts eager|progressive receipt.json");
const settings = await Settings.init();
settings.override("context.loadingMode", mode);
settings.override("compaction.enabled", false);
settings.override("memories.enabled", false);
const root = mkdtempSync(path.join(tmpdir(), "blindfold-awareness-uat-"));
writeFileSync(path.join(root, "neutral.txt"), "READ_OK\n", { mode: 0o600 });
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
writeFileSync(
	path.join(root, "public.json"),
	JSON.stringify({
		data: {
			tenant: "example-tenant",
			key_version: 1,
			modulus_base64: Buffer.from(key.n!, "base64url").toString("base64"),
			public_exponent_base64: Buffer.from(key.e!, "base64url").toString("base64"),
		},
	}),
	{ mode: 0o600 },
);
writeFileSync(
	path.join(root, "policy.json"),
	JSON.stringify({ data: { tenant: "example-tenant", policy_id: "101" } }),
	{ mode: 0o600 },
);
const privateInput = randomBytes(48).toString("hex");
writeFileSync(path.join(root, "input.pem"), privateInput, { mode: 0o600 });
const corpus = [
	{ id: "neutral", text: "Respond exactly PONG.", expected: "PONG" },
	{ id: "read", text: "Read neutral.txt and return exactly its contents.", expected: "READ_OK" },
	{
		id: "certificate-question",
		text: "Can I bring my own certificate with an encrypted PEM private key? Use native xcsh task documentation to verify the answer. Do not deploy anything. End with CERT_OK.",
		expected: "CERT_OK",
	},
	{
		id: "offline",
		text: "Encrypt my private key from input.pem offline using supplied public.json and policy.json into output.location. Do not read or echo private inputs or encrypted output; return only public status. End with OFFLINE_OK.",
		expected: "OFFLINE_OK",
	},
	{
		id: "plugin",
		text: "Use the installed synthetic plugin tool to return its greeting. End with PLUGIN_OK.",
		expected: "PLUGIN_OK",
	},
	{ id: "rpc-host", text: "Use the RPC host tool to return its greeting. End with HOST_OK.", expected: "HOST_OK" },
];
const corpusHash = createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
const samples: unknown[] = [];
try {
	for (const task of corpus) {
		let containment = true;
		let mutations = 0;
		const calls: string[] = [];
		const extension: ExtensionFactory = pi => {
			pi.registerTool({
				name: "synthetic_plugin_greeting",
				label: "Synthetic plugin",
				description: "Installed synthetic plugin tool returns a greeting",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "PLUGIN_OK" }] }),
			});
			pi.on("before_provider_request", event => {
				const payload = JSON.stringify(event.payload);
				const artifact = path.join(root, "output.location");
				if (
					payload.includes(privateInput) ||
					(existsSync(artifact) && payload.includes(readFileSync(artifact, "utf8").trim()))
				)
					containment = false;
			});
			pi.on("tool_call", event => {
				calls.push(event.toolName);
				if (
					event.toolName === "xcsh_api" &&
					!["GET", "HEAD", "OPTIONS"].includes(String(event.input.method).toUpperCase())
				) {
					mutations++;
					return { block: true, reason: "Read-only awareness acceptance forbids live mutation" };
				}
				if (
					event.toolName === "xcsh_blindfold" &&
					!["encrypt", "certificate", "public-key", "policy"].includes(String(event.input.operation))
				) {
					mutations++;
					return { block: true, reason: "Awareness acceptance forbids live certificate mutation" };
				}
			});
		};
		const { session } = await createAgentSession({
			cwd: root,
			settings,
			modelPattern: "openai-codex/gpt-6.1-sol",
			thinkingLevel: ThinkingLevel.Medium,
			sessionManager: SessionManager.inMemory(),
			disableExtensionDiscovery: true,
			extensions: [extension],
			contextFiles: [],
			skills: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});
		const initial = session.getContextProfile();
		let failure = false;
		try {
			if (task.id === "rpc-host")
				await session.refreshRpcHostTools([
					{
						name: "synthetic_host_greeting",
						label: "RPC host",
						description: "RPC host tool returns a greeting",
						parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text", text: "HOST_OK" }] }),
					},
				]);
			await session.prompt(task.text);
		} catch {
			failure = true;
		}
		const profile = session.getContextProfile();
		const reply =
			session
				.getLastAssistantMessage()
				?.content.filter(block => block.type === "text")
				.map(block => block.text)
				.join("") ?? "";
		const artifact = path.join(root, "output.location");
		const prepared =
			existsSync(artifact) &&
			(statSync(artifact).mode & 0o777) === 0o600 &&
			readFileSync(artifact, "utf8").startsWith("string:///");
		const routeRead = session.messages.some(
			message =>
				message.role === "toolResult" &&
				message.toolName === "read" &&
				JSON.stringify(message.content).includes("blindfold-certificates"),
		);
		const success =
			!failure &&
			reply.trim().endsWith(task.expected) &&
			containment &&
			mutations === 0 &&
			(task.id !== "offline" || (prepared && calls.includes("xcsh_blindfold"))) &&
			(task.id !== "certificate-question" || routeRead) &&
			(task.id !== "plugin" || calls.includes("synthetic_plugin_greeting")) &&
			(task.id !== "rpc-host" || calls.includes("synthetic_host_greeting"));
		const measured = profile.providerCalls.map(call => call.providerPromptTokens);
		samples.push({
			id: task.id,
			success,
			failure,
			containment,
			mutations,
			model: session.model ? `${session.model.provider}/${session.model.id}` : "unavailable",
			thinking: session.thinkingLevel,
			systemPromptBytes: initial.systemPromptBytes,
			initialToolBytes: initial.initialToolBytes,
			discoveryCalls: calls.filter(name => name === "search_tool_bm25").length,
			toolCalls: calls,
			firstInputTokens: measured[0] ?? null,
			totalInputTokens: measured.every(value => value !== undefined)
				? measured.reduce((sum, value) => sum! + value!, 0)
				: null,
			providerCalls: measured.length,
		});
		await session.dispose();
		process.stderr.write(`${task.id}: ${success ? "pass" : "fail"}\n`);
	}
	writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, mode, corpusHash, samples }, null, 2)}\n`, {
		mode: 0o600,
	});
} finally {
	rmSync(root, { recursive: true, force: true });
}
