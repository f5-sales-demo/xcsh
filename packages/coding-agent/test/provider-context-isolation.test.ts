import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import type { Rule } from "../src/capability/rule";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { getMemoryRoot } from "../src/memories";
import { createAgentSession } from "../src/sdk";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { prepareSystemPromptInputs } from "../src/system-prompt";

const deadline = "ALPHA_ONLY: demo due in 23 hours";
const created: string[] = [];

afterEach(async () => {
	for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-context-isolation-"));
	created.push(root);
	const alpha = path.join(root, "alpha-beta");
	const beta = path.join(root, "alpha", "beta");
	const agentDir = path.join(root, "agent");
	await fs.mkdir(alpha, { recursive: true });
	await fs.mkdir(beta, { recursive: true });
	await fs.mkdir(agentDir, { recursive: true });
	return { root, alpha, beta, agentDir };
}

async function seedMemory(agentDir: string, cwd: string, text: string) {
	const memoryRoot = getMemoryRoot(agentDir, cwd);
	await fs.mkdir(memoryRoot, { recursive: true });
	await fs.writeFile(path.join(memoryRoot, "memory_summary.md"), text);
}

async function capture(agentDir: string, cwd: string, manager = SessionManager.inMemory(cwd), rules: Rule[] = []) {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Missing test model");
	const auth = await AuthStorage.create(path.join(agentDir, "capture-auth.db"));
	auth.setRuntimeApiKey(model.provider, "synthetic-test-key");
	const preparedSystemPromptInputs = await prepareSystemPromptInputs(
		{
			cwd,
			skills: [],
			contextFiles: [],
			agentsMdSearch: { scopePath: ".", files: [], limit: 0, pattern: "XCSH.md" },
		},
		{
			loadSystemPromptFiles: async () => null,
			loadPluginSummaries: async () => ({ summaries: [], cacheStatus: "completed" }),
			getEnvironmentInfo: async () => [],
			resolveStartFolder: async () => ({ kind: "plain" }),
		},
	);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model,
		authStorage: auth,
		modelRegistry: new ModelRegistry(auth),
		sessionManager: manager,
		preparedSystemPromptInputs,
		settings: Settings.isolated({ "memories.enabled": true, "compaction.enabled": false, "secrets.enabled": false }),
		disableExtensionDiscovery: true,
		rules,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		toolNames: [],
		enableLsp: false,
	});
	const requests: string[] = [];
	session.agent.streamFn = (requestModel, context) => {
		requests.push(JSON.stringify(context));
		const stream = new AssistantMessageEventStream();
		queueMicrotask(() =>
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Synthetic response" }],
					api: requestModel.api,
					provider: requestModel.provider,
					model: requestModel.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
			}),
		);
		return stream;
	};
	return {
		session,
		requests,
		close: async () => {
			await session.dispose();
			auth.close();
		},
	};
}

describe("provider context ownership", () => {
	it("does not inject memory from a workspace with a colliding legacy path", async () => {
		const { alpha, beta, agentDir } = await fixture();
		await seedMemory(agentDir, alpha, deadline);
		const owner = await capture(agentDir, alpha);
		try {
			await owner.session.prompt("Read my context");
			expect(owner.requests.at(-1)).toContain(deadline);
		} finally {
			await owner.close();
		}
		const other = await capture(agentDir, beta);
		try {
			await other.session.prompt("Unrelated task");
			expect(other.requests.at(-1)).not.toContain(deadline);
		} finally {
			await other.close();
		}
	});

	it("isolates users sharing a workspace and retains an explicit deadline within its session", async () => {
		const { alpha, agentDir, root } = await fixture();
		await seedMemory(agentDir, alpha, deadline);
		const otherAgentDir = path.join(root, "other-agent");
		await fs.mkdir(otherAgentDir);
		const other = await capture(otherAgentDir, alpha);
		try {
			await other.session.prompt("Unrelated task");
			expect(other.requests.at(-1)).not.toContain(deadline);
			await other.session.prompt(deadline);
			await other.session.prompt("What is my deadline?");
			expect(other.requests.at(-1)).toContain(deadline);
			await other.session.newSession();
			await other.session.prompt("A fresh task");
			expect(other.requests.at(-1)).not.toContain(deadline);
		} finally {
			await other.close();
		}
	});

	it("refreshes workspace rules when reusing a session object for a different workspace", async () => {
		const { alpha, beta, agentDir } = await fixture();
		const rule = {
			name: "alpha-deadline",
			path: path.join(alpha, "deadline.md"),
			content: deadline,
			alwaysApply: true,
		} as Rule;
		const conditional = {
			...rule,
			name: "alpha-conditional",
			alwaysApply: false,
			condition: ["forbidden"],
			scope: ["text"],
		} as Rule;
		const owner = await capture(agentDir, alpha, SessionManager.inMemory(alpha), [rule, conditional]);
		try {
			await owner.session.prompt("Read my workspace rules");
			expect(owner.requests.at(-1)).toContain(deadline);
			expect(
				owner.session.ttsrManager
					?.checkDelta("forbidden", { source: "text" })
					.some(rule => rule.name === conditional.name),
			).toBe(true);
			await owner.session.sessionManager.moveTo(beta);
			await owner.session.newSession();
			await owner.session.prompt("Unrelated task");
			expect(owner.requests.at(-1)).not.toContain(deadline);
			expect(
				owner.session.ttsrManager
					?.checkDelta("forbidden", { source: "text" })
					.some(rule => rule.name === conditional.name),
			).toBe(false);
		} finally {
			await owner.close();
		}
	});

	it("continues only the requested workspace from a shared legacy session directory", async () => {
		const { alpha, beta, agentDir } = await fixture();
		const dir = SessionManager.getDefaultSessionDir(alpha, agentDir);
		const saved = SessionManager.create(alpha, dir);
		const firstKept = saved.appendMessage({
			role: "user",
			content: [{ type: "text", text: deadline }],
			timestamp: Date.now(),
		});
		saved.appendCompaction(deadline, undefined, firstKept, 64);
		await saved.ensureOnDisk();
		await saved.flush();
		const savedPath = saved.getSessionFile();
		await saved.close();
		const resumed = await SessionManager.continueRecent(beta, SessionManager.getDefaultSessionDir(beta, agentDir));
		const other = await capture(agentDir, beta, resumed);
		try {
			await other.session.prompt("Unrelated task");
			expect(other.requests.at(-1)).not.toContain(deadline);
			expect(resumed.getSessionFile()).not.toBe(savedPath);
		} finally {
			await other.close();
		}
		const owner = await SessionManager.continueRecent(alpha, dir);
		try {
			expect(owner.getSessionFile()).toBe(savedPath);
			expect(JSON.stringify(owner.buildSessionContext())).toContain(deadline);
		} finally {
			await owner.close();
		}
	});
});
