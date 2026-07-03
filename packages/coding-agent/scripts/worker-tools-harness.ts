// Headless worker-tool harness — no Chrome, no F5 login.
//
// Spawns a real `xcsh worker`, connects a MOCK extension bridge client (exactly
// the hello handshake + origin the real service worker uses), sends a chat_request
// asking it to navigate, and observes:
//   (a) which tools the worker's agent actually has (from the daily log), and
//   (b) whether the agent emits a `navigate` tool_request over the bridge.
//
// This isolates the "agent responds but never drives" bug to the WORKER's tool
// registration, deterministically and repeatably.
import { homedir } from "node:os";
import { join } from "node:path";

// XCSH_DEV=1 → run the local source build (`bun src/cli.ts worker`) so source
// edits are testable; otherwise the installed Homebrew binary.
const XCSH_REPO = new URL("..", import.meta.url).pathname; // packages/coding-agent
const DEV = process.env.XCSH_DEV === "1";
const SPAWN_CMD = DEV ? ["bun", "src/cli.ts", "worker"] : ["/opt/homebrew/bin/xcsh", "worker"];
const SPAWN_CWD = DEV ? XCSH_REPO : process.cwd();
const EXT_ID = "klajkjdoehjidngligegnpknogmjjhkc";
const ORIGIN = `chrome-extension://${EXT_ID}`; // bridge origin check: exact, no trailing slash
const PORT = 19260; // away from the real backend range (19222-19241)
const TENANT = process.env.HARNESS_TENANT ?? "f5-sales-demo|production";
const PROMPT = process.env.HARNESS_PROMPT ?? "Navigate the browser to the origin pools list.";

function log(...a: unknown[]) {
	console.log("[harness]", ...a);
}

// 1) Spawn the worker with a forced bridge port + tenant identity.
const worker = Bun.spawn(SPAWN_CMD, {
	cwd: SPAWN_CWD,
	env: {
		...process.env,
		XCSH_BRIDGE_PORT: String(PORT),
		XCSH_SESSION_ID: "tab-9999",
		XCSH_SESSION_TENANT: TENANT,
	},
	stdout: "pipe",
	stderr: "pipe",
});
log(`spawned worker pid=${worker.pid} (${DEV ? "DEV build" : "homebrew"}), port=${PORT}, tenant=${TENANT}`);

// Stream worker stderr; resolve when the bridge is listening.
let bridgeUp = false;
const decoder = new TextDecoder();
(async () => {
	for await (const chunk of worker.stderr) {
		const s = decoder.decode(chunk);
		for (const line of s.split("\n")) {
			if (line.trim()) log("worker⟩", line.trim());
			if (line.includes("extension bridge listening")) bridgeUp = true;
		}
	}
})();

// Wait for the bridge, then give the (heavier) agent session time to init + attach
// the chat handler (chatHandler.attach() runs AFTER createAgentSession).
for (let i = 0; i < 120 && !bridgeUp; i++) await Bun.sleep(250);
if (!bridgeUp) {
	log("FAIL: bridge never came up");
	worker.kill();
	process.exit(1);
}
log("bridge up; waiting 12s for agent session init…");
await Bun.sleep(12_000);

// 2) Connect the mock extension client with the correct Origin.
const toolRequests: string[] = [];
let chatText = "";
let chatErr: string | null = null;
let done = false;

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Origin: ORIGIN } } as unknown as string[]);
ws.onopen = () => {
	log("client connected; sending hello");
	ws.send(JSON.stringify({ type: "hello", contractVersion: "1.5.0", extensionId: "harness" }));
};
ws.onerror = () => log("client ws error (origin rejected?)");
ws.onmessage = e => {
	let m: Record<string, unknown>;
	try {
		m = JSON.parse(e.data as string);
	} catch {
		return;
	}
	switch (m.type) {
		case "hello_ack":
			log(`hello_ack: tenant=${m.tenant} sessionId=${m.sessionId} contractVersion=${m.contractVersion}`);
			log(`sending chat_request: "${PROMPT}"`);
			ws.send(
				JSON.stringify({
					type: "chat_request",
					id: "c-harness-1",
					text: PROMPT,
					context: null,
					mode: "configuration",
				}),
			);
			break;
		case "tool_request":
			log(`◆ TOOL_REQUEST from agent: tool="${m.tool}" id=${m.id}`);
			toolRequests.push(m.tool as string);
			// Reply so the agent's turn can proceed.
			ws.send(JSON.stringify({ type: "tool_result", id: m.id, content: "ok (harness stub)", is_error: false }));
			break;
		case "chat_delta":
			chatText += (m.delta as string) ?? "";
			break;
		case "chat_done":
			done = true;
			break;
		case "chat_error":
			chatErr = (m.error as string) ?? "unknown";
			done = true;
			break;
	}
};

// 3) Wait for the turn to finish (or time out).
for (let i = 0; i < 240 && !done; i++) await Bun.sleep(250);

// 4) Read the worker's actual tool set from the daily log.
let activeTools = "(not found in daily log)";
try {
	const logPath = join(homedir(), ".xcsh", "logs", `xcsh.${new Date().toISOString().slice(0, 10)}.log`);
	const text = await Bun.file(logPath).text();
	const lines = text.split("\n").filter(l => l.includes(`"pid":${worker.pid}`) && l.includes("activeToolNames"));
	if (lines.length) {
		const parsed = JSON.parse(lines[lines.length - 1]);
		activeTools = JSON.stringify(parsed.activeToolNames);
	}
} catch {}

console.log("\n==================== RESULT ====================");
console.log("agent tool_requests emitted :", toolRequests.length ? toolRequests.join(", ") : "(none)");
console.log("worker activeToolNames       :", activeTools);
console.log("has navigate tool?           :", activeTools.includes('"navigate"') ? "YES" : "NO");
console.log("emitted a navigate?          :", toolRequests.includes("navigate") ? "YES" : "NO");
console.log("chat error                   :", chatErr ?? "(none)");
console.log("agent said (first 240 chars) :", chatText.slice(0, 240).replace(/\n/g, " "));
if (toolRequests.includes("navigate")) console.log("\n[PASS] worker agent HAS + CALLS navigate — tool registration OK");
else console.log("\n[FAIL] worker never called navigate — browser tools missing from the agent");
console.log("===============================================");

try {
	ws.close();
} catch {}
worker.kill();
await Bun.sleep(300);
process.exit(0);
