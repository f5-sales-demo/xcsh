/**
 * Plugin slash commands over the Office bridge: enumeration (`list_commands`) and
 * expansion (a `/name` chat_request becomes the command's body before it is composed).
 *
 * The engine already discovers these — `discoverSlashCommands` returns every
 * `commands/*.md` from an installed plugin, prefixed with the plugin name — and the TUI
 * expands them inside `AgentSession.prompt`. The pane got neither: no frame advertised
 * them, and `chat-handler` calls `prompt` with `expandPromptTemplates: false`, which
 * skips the expansion branch entirely. Even with that flag on it would not have worked,
 * because `composeChatPrompt` appends the user's text LAST, so the string reaching
 * `prompt` no longer starts with `/`.
 *
 * Expansion therefore belongs here, on `req.text`, before composition.
 */
import { expect, test } from "bun:test";
import { ChatHandler } from "../src/browser/chat-handler";
import { isListCommands } from "../src/browser/chat-protocol";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { FileSlashCommand } from "../src/extensibility/slash-commands";
import type { AgentSession } from "../src/session/agent-session";

const QUALIFY: FileSlashCommand = {
	name: "meddpicc:qualify-deal",
	description: "Score and qualify a deal using the MEDDPICC framework",
	content: 'Invoke the `meddpicc:deal-qualification` skill for the deal "$ARGUMENTS".',
	source: "via xcsh Marketplace User",
};

const STATUS: FileSlashCommand = {
	name: "meddpicc:meddpicc-status",
	description: "Check MEDDPICC framework readiness and deal data availability",
	content: "Report MEDDPICC framework readiness and per-deal status.",
	source: "via xcsh Marketplace User",
};

function harness(slashCommands: FileSlashCommand[] = []) {
	const sent: Record<string, unknown>[] = [];
	const prompts: string[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	const server = {
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
		clientHost: "excel",
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		skills: [],
		slashCommands,
		agent: { replaceMessages() {}, abort() {} },
		subscribe: () => () => {},
		prompt: async (text: string) => {
			prompts.push(text);
		},
	} as unknown as AgentSession;
	return { sent, prompts, server, session, fire: (m: Record<string, unknown>) => onMsg(m) };
}

const flush = (ms = 10) => new Promise(r => setTimeout(r, ms));

test("isListCommands guard", () => {
	expect(isListCommands({ type: "list_commands" })).toBe(true);
	expect(isListCommands({ type: "list_skills" })).toBe(false);
	expect(isListCommands({})).toBe(false);
});

test("list_commands replies projecting name + description, never the command body", async () => {
	// The body is a prompt template that can run to hundreds of lines; a menu needs a
	// label. Shipping `content` would also put the plugin author's instructions on the
	// wire for no reason.
	const h = harness([QUALIFY, STATUS]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "list_commands" });
	await flush();

	const reply = h.sent.find(m => m.type === "commands");
	expect(reply).toBeDefined();
	expect(reply?.commands).toEqual([
		{ name: "meddpicc:qualify-deal", description: "Score and qualify a deal using the MEDDPICC framework" },
		{
			name: "meddpicc:meddpicc-status",
			description: "Check MEDDPICC framework readiness and deal data availability",
		},
	]);
	expect(JSON.stringify(reply)).not.toContain("deal-qualification` skill");
});

test("list_commands with none loaded replies with an empty list", async () => {
	const h = harness([]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "list_commands" });
	await flush();
	expect(h.sent.find(m => m.type === "commands")?.commands).toEqual([]);
});

test("a /command chat_request is expanded into the command body", async () => {
	const h = harness([QUALIFY, STATUS]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-1", text: "/meddpicc:meddpicc-status", mode: "educational" });
	await flush();

	expect(h.prompts).toHaveLength(1);
	expect(h.prompts[0]).toContain("Report MEDDPICC framework readiness");
	// The raw command name must not survive — if it did, the model would be answering
	// "/meddpicc:meddpicc-status" as prose instead of following the command.
	expect(h.prompts[0]).not.toContain("/meddpicc:meddpicc-status");
});

test("arguments after the command name are substituted into $ARGUMENTS", async () => {
	const h = harness([QUALIFY]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-2", text: "/meddpicc:qualify-deal Example Corp", mode: "educational" });
	await flush();

	expect(h.prompts[0]).toContain('the deal "Example Corp"');
	expect(h.prompts[0]).not.toContain("$ARGUMENTS");
});

test("an unknown /name is left alone so the skill convention still applies", async () => {
	// Skills are invoked by the same `/name` spelling but handled by the system prompt,
	// not by expansion. Rewriting or rejecting an unmatched name would break them.
	const h = harness([QUALIFY]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-3", text: "/meddpicc:deal-review Example Corp", mode: "educational" });
	await flush();

	expect(h.prompts[0]).toContain("/meddpicc:deal-review Example Corp");
});

test("ordinary prose is untouched", async () => {
	const h = harness([QUALIFY]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-4", text: "generate a meddpicc report", mode: "educational" });
	await flush();

	expect(h.prompts[0]).toContain("generate a meddpicc report");
});

test("a mid-text slash is not a command", async () => {
	const h = harness([QUALIFY]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-5", text: "run /meddpicc:qualify-deal for me", mode: "educational" });
	await flush();

	expect(h.prompts[0]).toContain("run /meddpicc:qualify-deal for me");
	expect(h.prompts[0]).not.toContain("Invoke the `meddpicc:deal-qualification`");
});

test("the expanded body still rides inside the host prompt, not instead of it", async () => {
	// composeChatPrompt wraps the text with the Excel/Word/PowerPoint self-awareness
	// directive. Expanding must not bypass that — the command body replaces the user's
	// text, not the whole prompt.
	const h = harness([STATUS]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-6", text: "/meddpicc:meddpicc-status", mode: "educational" });
	await flush();

	expect(h.prompts[0]).toContain("<system-directive>");
	expect(h.prompts[0]).toContain("Report MEDDPICC framework readiness");
});
