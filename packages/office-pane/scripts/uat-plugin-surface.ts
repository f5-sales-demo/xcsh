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
 * runs in a WebView; a local script does not, and using ws avoids weakening TLS
 * verification to accept the bridge's cert. Nothing leaves 127.0.0.1.
 *
 * The bridge gates BOTH listeners on an Origin allowlist (`isAllowedBridgeOrigin`), so this
 * sends the pane's own origin — without it the upgrade is refused with "Expected 101 status
 * code", which reads like nothing is listening. That gate exists to stop a random web page
 * opening the loopback socket, which browsers enforce by refusing to forge Origin; a local
 * process is already inside the trust boundary the gate assumes, so presenting the origin
 * here is identifying the caller, not defeating a check.
 */
import { discoverOfficeBridge } from "./uat/bridge-client";

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

const bridge = await discoverOfficeBridge();
console.log(`Bridge: ws://127.0.0.1:${bridge.port} (serveKind=${bridge.ack.serveKind})`);
console.log(`Contract: ${bridge.ack.contractVersion}\n`);

console.log(`P2 — skills from "${plugin}"`);
const skills = (
	await bridge
		.request({ type: "list_skills" }, "skills", 10_000)
		.then(m => m.skills as Array<{ name: string; description: string }>)
).filter(s => s.name.startsWith(`${plugin}:`));
for (const s of skills) console.log(`      ${s.name}`);
check(skills.length > 0, "the plugin's skills load", `${skills.length} found`);
check(
	skills.every(s => s.description.trim() !== ""),
	"every skill carries a description (the menu needs a label)",
);

console.log(`\nP1 — slash commands from "${plugin}"`);
const commands = (
	await bridge
		.request({ type: "list_commands" }, "commands", 10_000)
		.then(m => m.commands as Array<{ name: string; description: string }>)
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
	const t = await bridge.turn(`/${target.name}`, "c-uat-plugin-1");
	check(t.ended === "chat_done", "the turn completed", t.reason ?? "");
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

bridge.dispose();
console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILED: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
