/**
 * Issue #2340 — provider-side tool activity must reach the panel.
 *
 * On an Anthropic web-search turn the provider runs the search itself, which takes several
 * seconds before ANY token streams. Those `server_tool_*` events used to stop dead in the
 * provider, so the Office pane showed a bare "Thinking…" for ~6s with no indication a search
 * was even happening (the symptom the operator reported as a hang).
 *
 * This drives the REAL chain — a stub model pushing `server_tool_start`/`server_tool_end` into
 * a real agent loop, a real `AgentSession`, and a real `ChatHandler` — and asserts the events
 * surface as `chat_tool_notice` frames on the wire (which the panel already renders as activity
 * rows, and which also re-arm its first-token timer).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { ChatHandler } from "../../src/browser/chat-handler";
import type { BridgeServer } from "../../src/browser/extension-bridge";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

class FakeBridgeServer {
	readonly serveKind = "office" as const;
	readonly clientHost = "excel" as const;
	sent: Array<Record<string, unknown>> = [];
	#onMessage: Array<(m: Record<string, unknown>) => void> = [];
	#onDisconnected: Array<() => void> = [];

	send(payload: unknown): void {
		this.sent.push(payload as Record<string, unknown>);
	}
	onMessage(cb: (m: Record<string, unknown>) => void): void {
		this.#onMessage.push(cb);
	}
	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	emit(msg: Record<string, unknown>): void {
		for (const cb of this.#onMessage) cb(msg);
	}
	ofType(type: string): Array<Record<string, unknown>> {
		return this.sent.filter(frame => frame.type === type);
	}
	indexOf(type: string): number {
		return this.sent.findIndex(frame => frame.type === type);
	}
}

const QUERY = "latest F5 NGINX Plus release";
const ANSWER = "NGINX Plus R34 is the latest release.";

function baseAssistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]) {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	} as AssistantMessage;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Timed out waiting for condition");
}

describe("#2340 — provider-side tool activity reaches the panel", () => {
	let session: AgentSession;
	let handler: ChatHandler;
	let server: FakeBridgeServer;
	let tempDir: string;
	const authStorages: AuthStorage[] = [];

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-2340-server-tools-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		handler?.dispose();
		if (session) await session.dispose();
		for (const authStorage of authStorages.splice(0)) authStorage.close();
		if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
	});

	/**
	 * @param outcome "results" → the search returns 2 hits; "error" → the provider rejects it.
	 */
	async function makeSession(outcome: "results" | "error"): Promise<AgentSession> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: () => {
				const stream = new AssistantMessageEventStream();
				queueMicrotask(() => {
					const partial = baseAssistant([], "stop");
					stream.push({ type: "start", partial });
					stream.push({
						type: "server_tool_start",
						toolName: "web_search",
						toolId: "srvtoolu_1",
						query: QUERY,
						partial,
					});
					stream.push({
						type: "server_tool_end",
						toolName: "web_search",
						toolId: "srvtoolu_1",
						...(outcome === "results" ? { resultCount: 2 } : { errorCode: "max_uses_exceeded" }),
						partial,
					});
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: ANSWER,
						partial: baseAssistant([{ type: "text", text: ANSWER }], "stop"),
					});
					stream.push({
						type: "done",
						reason: "stop",
						message: baseAssistant(
							[
								{
									type: "text",
									text: ANSWER,
									citations: [
										{
											type: "web_search_result_location",
											url: "https://docs.nginx.com/nginx/releases/",
											title: "NGINX Plus Releases",
											citedText: "R34 is the latest",
										},
									],
								},
							],
							"stop",
						),
					});
				});
				return stream;
			},
		});

		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		authStorages.push(authStorage);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

		return new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry,
		});
	}

	async function runTurn(outcome: "results" | "error"): Promise<void> {
		session = await makeSession(outcome);
		server = new FakeBridgeServer();
		handler = new ChatHandler(server as unknown as BridgeServer, session);
		handler.attach();
		server.emit({
			type: "chat_request",
			id: "c-websearch-1",
			text: QUERY,
			context: null,
			mode: "configuration",
		});
		await waitFor(() => server.ofType("chat_done").length === 1);
	}

	it("announces the search — with the query — as a tool notice", async () => {
		await runTurn("results");

		const notices = server.ofType("chat_tool_notice").filter(f => f.tool === "web_search");
		expect(notices.length).toBeGreaterThanOrEqual(1);
		expect(notices[0].ok).toBe(true);
		expect(String(notices[0].detail)).toContain("Searching the web");
		expect(String(notices[0].detail)).toContain(QUERY);
	});

	it("reports the result count when the search returns", async () => {
		await runTurn("results");

		const notices = server.ofType("chat_tool_notice").filter(f => f.tool === "web_search");
		expect(notices).toHaveLength(2);
		expect(notices[1].ok).toBe(true);
		expect(String(notices[1].detail)).toContain("2 results");
	});

	it("shows the activity BEFORE the first answer token (the point of the fix)", async () => {
		await runTurn("results");

		const noticeIdx = server.indexOf("chat_tool_notice");
		const deltaIdx = server.sent.findIndex(f => f.type === "chat_delta");
		expect(noticeIdx).toBeGreaterThanOrEqual(0);
		expect(deltaIdx).toBeGreaterThanOrEqual(0);
		expect(noticeIdx).toBeLessThan(deltaIdx);
	});

	it("marks a failed search not-ok and names the error", async () => {
		await runTurn("error");

		const notices = server.ofType("chat_tool_notice").filter(f => f.tool === "web_search");
		expect(notices).toHaveLength(2);
		expect(notices[1].ok).toBe(false);
		expect(String(notices[1].detail)).toContain("max_uses_exceeded");
	});

	it("still completes the turn exactly once, with no error", async () => {
		await runTurn("results");

		expect(server.ofType("chat_done")).toHaveLength(1);
		expect(server.ofType("chat_error")).toHaveLength(0);
	});

	it("sends Sources from the structured citation, not a regex scrape of the prose", async () => {
		await runTurn("results");

		const done = server.ofType("chat_done")[0];
		const references = done.references as Array<{ title: string; url: string }> | undefined;
		expect(references).toBeDefined();
		expect(references).toHaveLength(1);
		// The prose contains no URL at all — a regex scrape would have found nothing.
		expect(ANSWER).not.toContain("http");
		expect(references?.[0].url).toBe("https://docs.nginx.com/nginx/releases/");
		expect(references?.[0].title).toBe("NGINX Plus Releases");
	});
});
