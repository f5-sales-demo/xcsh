/**
 * `list_skills` over the Office bridge → the composer `+` → Skills submenu.
 *
 * The handler answers with the session's LIVE skills (name + description) so the
 * pane can populate the submenu. Skills already work end-to-end via the enabled
 * `read` tool + system prompt (Phase 2A); this frame is enumeration only.
 */
import { expect, test } from "bun:test";
import { ChatHandler } from "../src/browser/chat-handler";
import { isListSkills } from "../src/browser/chat-protocol";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { AgentSession } from "../src/session/agent-session";

function harness(skills: Array<{ name: string; description: string }> = []) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	const server = {
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		// Skills carry more fields in reality (filePath/baseDir/source); the handler
		// projects only name + description onto the wire.
		skills: skills.map(s => ({
			...s,
			filePath: `/skills/${s.name}/SKILL.md`,
			baseDir: "/skills",
			source: "native:project",
		})),
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: () => () => {},
		prompt: async () => {},
	} as unknown as AgentSession;
	return { sent, server, session, fire: (m: Record<string, unknown>) => onMsg(m) };
}

const flush = (ms = 10) => new Promise(r => setTimeout(r, ms));

test("isListSkills guard", () => {
	expect(isListSkills({ type: "list_skills" })).toBe(true);
	expect(isListSkills({ type: "chat_request" })).toBe(false);
	expect(isListSkills({})).toBe(false);
});

test("list_skills replies with a skills frame projecting name + description from session.skills", async () => {
	const h = harness([
		{ name: "competitive", description: "F5 XC competitive battlecards" },
		{ name: "roi-calculator", description: "ROI / TCO business case" },
	]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "list_skills" });
	await flush();
	const reply = h.sent.find(m => m.type === "skills");
	expect(reply).toBeDefined();
	expect(reply?.skills).toEqual([
		{ name: "competitive", description: "F5 XC competitive battlecards" },
		{ name: "roi-calculator", description: "ROI / TCO business case" },
	]);
});

test("list_skills with no loaded skills replies with an empty list (menu shows empty-safe)", async () => {
	const h = harness([]);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "list_skills" });
	await flush();
	const reply = h.sent.find(m => m.type === "skills");
	expect(reply).toBeDefined();
	expect(reply?.skills).toEqual([]);
});
