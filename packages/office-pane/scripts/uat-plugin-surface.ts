#!/usr/bin/env bun
/**
 * Automated UAT for the pane's marketplace-plugin surface (UAT.md rows P1, P3, P4).
 *
 * There is no headless Office runtime, so the pane's *rendering* has to be checked by a
 * human. Everything underneath it does not: the `/` menu is populated by a `list_commands`
 * frame, the Skills submenu by `list_skills`, and invoking a command is a `chat_request`
 * whose text the engine expands. All three are bridge traffic, so all three can be
 * asserted against a real running `xcsh office serve` instead of clicked by hand.
 *
 *   cd <a folder holding your data> && xcsh office sideload excel   # in one terminal
 *   bun packages/office-pane/scripts/uat-plugin-surface.ts meddpicc # in another
 *
 * Enumeration is free and offline. Pass `--turn` to also send a real prompt, which costs
 * a model call — that is the part that proves expansion end to end, so it is opt-in
 * rather than on by default.
 *
 * Connects over the bridge's plain ws port, not its wss one. The pane needs wss because it
 * runs in a WebView with a real origin; a local script does not, and using ws avoids
 * weakening TLS verification to accept the bridge's cert. Nothing leaves 127.0.0.1.
 */

/**
 * `xcsh office serve` binds ws in a dedicated sub-range, disjoint from the Chrome
 * worker's, and its paired wss listeners sit at +100. Mirrors
 * `src/core/transport/bridge-discovery.ts`; this script scans the ws side.
 */
const OFFICE_WS_RANGE_START = 19242;
const OFFICE_WS_RANGE_END = 19261;

/** How long to give one port before deciding nothing is listening. */
const PROBE_TIMEOUT_MS = 700;
/** A real turn can think for a while before its first token. */
const TURN_TIMEOUT_MS = 180_000;

interface Frame {
	type?: string;
	[key: string]: unknown;
}

interface Bridge {
	port: number;
	ws: WebSocket;
	ack: Frame;
}

/** Open a port and complete the hello handshake, or resolve null if nothing answers. */
function probe(port: number): Promise<Bridge | null> {
	return new Promise(resolve => {
		let ws: WebSocket;
		try {
			ws = new WebSocket(`ws://127.0.0.1:${port}`);
		} catch {
			resolve(null);
			return;
		}
		let settled = false;
		const give_up = (): void => {
			if (settled) return;
			settled = true;
			try {
				ws.close();
			} catch {
				/* already closing */
			}
			resolve(null);
		};
		const timer = setTimeout(give_up, PROBE_TIMEOUT_MS);
		ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "hello", host: "excel" })));
		ws.addEventListener("message", ev => {
			const msg = JSON.parse(String(ev.data)) as Frame;
			if (msg.type !== "hello_ack" || settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ port, ws, ack: msg });
		});
		ws.addEventListener("error", give_up);
		ws.addEventListener("close", give_up);
	});
}

/**
 * Find the office-serve bridge. Filters on `serveKind === "office"` for the same reason
 * the pane's own discovery does: a Chrome worker must never be adopted, even if one
 * somehow answers inside this range.
 */
async function discover(): Promise<Bridge> {
	for (let port = OFFICE_WS_RANGE_START; port <= OFFICE_WS_RANGE_END; port++) {
		const bridge = await probe(port);
		if (!bridge) continue;
		if (bridge.ack.serveKind === "office") return bridge;
		bridge.ws.close();
	}
	throw new Error(
		`No 'xcsh office serve' bridge answered on ws://127.0.0.1:${OFFICE_WS_RANGE_START}-${OFFICE_WS_RANGE_END}.\n` +
			"Start one first:  cd <your folder> && xcsh office sideload excel",
	);
}

/** Send a frame and wait for the first reply of `expect`. */
function request(ws: WebSocket, send: Frame, expect: string, timeoutMs: number): Promise<Frame> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.removeEventListener("message", onMessage);
			reject(new Error(`timed out after ${timeoutMs}ms waiting for a '${expect}' frame`));
		}, timeoutMs);
		function onMessage(ev: MessageEvent): void {
			const msg = JSON.parse(String(ev.data)) as Frame;
			if (msg.type !== expect) return;
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
			resolve(msg);
		}
		ws.addEventListener("message", onMessage);
		ws.send(JSON.stringify(send));
	});
}

/** Stream one turn, returning the assistant's text and how it ended. */
function turn(ws: WebSocket, text: string): Promise<{ reply: string; ended: string; error?: string }> {
	return new Promise((resolve, reject) => {
		let reply = "";
		const timer = setTimeout(() => {
			ws.removeEventListener("message", onMessage);
			reject(new Error(`turn did not finish within ${TURN_TIMEOUT_MS}ms`));
		}, TURN_TIMEOUT_MS);
		function onMessage(ev: MessageEvent): void {
			const msg = JSON.parse(String(ev.data)) as Frame;
			if (msg.type === "chat_delta") reply += String(msg.delta ?? "");
			if (msg.type !== "chat_done" && msg.type !== "chat_error") return;
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
			resolve({ reply, ended: String(msg.type), error: msg.error ? String(msg.error) : undefined });
		}
		ws.addEventListener("message", onMessage);
		ws.send(JSON.stringify({ type: "chat_request", id: "c-uat-1", text, mode: "educational" }));
	});
}

const failures: string[] = [];
function check(ok: boolean, label: string, detail = ""): void {
	console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures.push(label);
}

const plugin = process.argv.slice(2).find(a => !a.startsWith("--"));
const withTurn = process.argv.includes("--turn");
if (!plugin) {
	console.error("usage: bun uat-plugin-surface.ts <plugin-name> [--turn]");
	console.error("  e.g. bun uat-plugin-surface.ts meddpicc --turn");
	process.exit(2);
}

const bridge = await discover();
console.log(`Bridge: ws://127.0.0.1:${bridge.port} (serveKind=${bridge.ack.serveKind}, pid=${bridge.ack.pid})`);
console.log(`Contract: ${bridge.ack.contractVersion}\n`);

console.log(`P2 — skills from "${plugin}"`);
const skills = (
	await request(bridge.ws, { type: "list_skills" }, "skills", 10_000).then(
		m => m.skills as Array<{ name: string; description: string }>,
	)
).filter(s => s.name.startsWith(`${plugin}:`));
for (const s of skills) console.log(`      ${s.name}`);
check(skills.length > 0, "the plugin's skills load", `${skills.length} found`);
check(
	skills.every(s => s.description.trim() !== ""),
	"every skill carries a description (the menu needs a label)",
);

console.log(`\nP1 — slash commands from "${plugin}"`);
const commands = (
	await request(bridge.ws, { type: "list_commands" }, "commands", 10_000).then(
		m => m.commands as Array<{ name: string; description: string }>,
	)
).filter(c => c.name.startsWith(`${plugin}:`));
for (const c of commands) console.log(`      /${c.name} — ${c.description.slice(0, 66)}`);
check(commands.length > 0, "the plugin's slash commands are enumerable", `${commands.length} found`);
check(
	commands.every(c => c.description.trim() !== ""),
	"every command carries a description",
);
check(
	!JSON.stringify(commands).includes("$ARGUMENTS"),
	"template bodies stay off the wire (a menu needs a label, not a prompt)",
);

if (!withTurn) {
	console.log("\nP3/P4 skipped — pass --turn to send a real prompt (costs a model call).");
} else if (commands.length === 0) {
	console.log("\nP3/P4 skipped — no commands to invoke.");
} else {
	const target = commands.find(c => c.name.endsWith(":meddpicc-status")) ?? commands[0];
	console.log(`\nP3 — invoking /${target.name}`);
	const t = await turn(bridge.ws, `/${target.name}`);
	check(t.ended === "chat_done", "the turn completed", t.error ?? "");
	// If expansion did not happen the model receives the literal "/name" and tends to
	// echo or question it, so a reply that quotes the command back is the failure mode.
	check(t.reply.trim().length > 0, "the assistant replied");
	check(!t.reply.includes(`/${target.name}`), "the reply follows the command rather than quoting it back");
	console.log("      --- first 400 chars ---");
	console.log(
		t.reply
			.slice(0, 400)
			.split("\n")
			.map(l => `      ${l}`)
			.join("\n"),
	);
}

bridge.ws.close();
console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILED: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
