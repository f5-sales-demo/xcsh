import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";

const provider = process.argv[2];
if (provider !== "litellm" && provider !== "openai-codex") throw new Error("Select litellm or openai-codex");
const root = await mkdtemp(join(tmpdir(), `xcsh-sol-uat-${provider}-`));
const advanced = process.argv.includes("--advanced");
const probeExtension = join(root, "transport-probe.ts");
if (advanced)
	await writeFile(
		probeExtension,
		`
export default function(api) {
 const root = ${JSON.stringify(root)};
 const receipt = {requests: [], frames: [], events: []};
 const save = () => Bun.write(root + "/transport.json", JSON.stringify(receipt));
 let pendingSteer;
 const original = globalThis.WebSocket;
 globalThis.WebSocket = new Proxy(original, {construct(Target, args) {
  const socket = Reflect.construct(Target, args);
  const send = socket.send.bind(socket);
  socket.send = data => { try { receipt.frames.push(JSON.parse(String(data)).type); void save(); } catch {} return send(data); };
  socket.addEventListener("message", event => { try { const type=JSON.parse(String(event.data)).type; if(type.startsWith("response.steer") || type === "response.created") {receipt.events.push(type); void save(); if (type === "response.created" && pendingSteer) {const text=pendingSteer; pendingSteer=undefined; setTimeout(()=>api.sendUserMessage(text,{deliverAs:"steer"}),300);}} } catch {} });
  return socket;
 }});
 let tier = "default";
 api.registerCommand("sol-steer", {handler: async args => {pendingSteer="Keep the answer brief and end with "+args.trim(); api.sendUserMessage("Write a detailed 600-word explanation of binary search invariants using synthetic arrays. No tools.");}});
 api.registerCommand("sol-effort", {handler: async args => {api.setThinkingLevel(args.trim());}});
 api.registerCommand("sol-speed", {handler: async args => {tier=args.trim() === "fast" ? "priority" : "default";}});
 api.on("before_provider_request", event => {
  const payload = event.payload;
  payload.service_tier=tier;
  receipt.requests.push({model:payload.model,effort:payload.reasoning?.effort,summary:payload.reasoning?.summary,tier,cache:payload.prompt_cache_options});
  void save();
  return payload;
 });
 api.on("session_shutdown", () => {globalThis.WebSocket=original;});
}
`,
	);
await writeFile(join(root, "synthetic.txt"), "SYNTHETIC_TOOL_CONTEXT_4611\n");
await writeFile(
	join(root, "red.png"),
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
		"base64",
	),
);
const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const session = new PtySession();
let transcript = "";
let exited = false;
let callbackError: Error | undefined;
const target = `${provider}/gpt-6.1-sol`;
const run = session
	.start(
		{
			command: [
				"bun",
				"run",
				"dev",
				"--model",
				target,
				"--thinking",
				"medium",
				"--session-dir",
				root,
				...(advanced ? ["--extension", probeExtension] : []),
			]
				.map(shellQuote)
				.join(" "),
			cwd: process.cwd(),
			cols: 150,
			rows: 45,
			timeoutMs: 600_000,
		},
		(error, text) => {
			if (error) callbackError = error;
			if (text) {
				transcript += text;
			}
		},
	)
	.finally(() => {
		exited = true;
	});
const visible = () => Bun.stripANSI(transcript).replace(/\r/g, "\n");
async function waitFor(predicate: (value: string) => boolean, label: string, start = 0, timeout = 90_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (predicate(visible().slice(start))) return;
		if (exited) throw new Error(`Terminal exited during ${label}`);
		await Bun.sleep(100);
	}
	throw new Error(`Terminal timed out during ${label}`);
}

async function waitForAssistant(marker: string, requireRead = false) {
	const deadline = Date.now() + 180_000;
	while (Date.now() < deadline) {
		for (const name of await readdir(root)) {
			if (!name.endsWith(".jsonl")) continue;
			const lines = (await readFile(join(root, name), "utf8")).split("\n").filter(Boolean);
			let sawRead = false;
			for (const line of lines) {
				let item: { message?: import("@f5-sales-demo/pi-ai").AssistantMessage };
				try {
					item = JSON.parse(line);
				} catch {
					continue;
				}
				const message = item.message;
				if (
					message?.role === "assistant" &&
					message.content?.some((part: any) => part.type === "toolCall" && part.name === "read")
				)
					sawRead = true;
				if (
					message?.role !== "assistant" ||
					message.model !== "gpt-6.1-sol" ||
					message.provider !== provider ||
					message.stopReason !== "stop"
				)
					continue;
				const text =
					message.content
						?.filter((part: any) => part.type === "text")
						.map((part: any) => part.text)
						.join("\n") ?? "";
				if (text.includes(marker) && (!requireRead || (sawRead && text.includes("SYNTHETIC_TOOL_CONTEXT_4611"))))
					return;
			}
		}
		if (exited) throw new Error("Terminal exited before persisted assistant acceptance");
		await Bun.sleep(200);
	}
	throw new Error("No persisted assistant acceptance marker");
}

const rows: { step: string; outcome: string }[] = [];
try {
	await waitFor(value => value.includes("gpt-6.1-sol") && value.includes("idle"), "startup");
	await Bun.sleep(2000);
	rows.push({ step: "startup", outcome: "pass" });
	console.log("Terminal startup ready");
	let start = visible().length;
	for (const character of "/model") {
		session.write(character);
		await Bun.sleep(10);
	}
	session.write("\r");
	await waitFor(value => value.includes("gpt-6.1-sol") && value.includes("Ctrl+R: refresh"), "picker", start);
	session.write("\x1b");
	await Bun.sleep(500);
	if (visible().slice(-6000).includes("Ctrl+R: refresh")) {
		session.write("\x1b");
		await Bun.sleep(500);
	}
	rows.push({ step: "picker", outcome: "pass" });
	start = visible().length;
	const marker = `XCSH_SOL_TOOL_${provider.toUpperCase()}_${Bun.hash(root).toString(36)}_OK`;
	for (const character of `Read ${join(root, "synthetic.txt")} with the read tool. Then answer ${marker} followed by the file marker.`) {
		session.write(character);
		await Bun.sleep(5);
	}
	session.write("\r");
	await waitForAssistant(marker, true);
	rows.push({ step: "read-tool-follow-up", outcome: "pass" });
	start = visible().length;
	const imageMarker = `XCSH_SOL_IMAGE_${provider.toUpperCase()}_${Bun.hash(root).toString(36)}_OK`;
	session.write("\x1b[200~");
	session.write(`@${join(root, "red.png")} Describe the synthetic image briefly, then print ${imageMarker}.`);
	session.write("\x1b[201~");
	await Bun.sleep(500);
	session.write("\x1b");
	await Bun.sleep(500);
	session.write("\r");
	await waitForAssistant(imageMarker);
	rows.push({ step: "image-input", outcome: "pass" });
	if (advanced) {
		const submit = async (text: string) => {
			session.write("\x1b[200~");
			session.write(text);
			session.write("\x1b[201~");
			await Bun.sleep(200);
			session.write("\r");
		};
		for (const effort of process.argv.includes("--steering-only")
			? []
			: ["low", "medium", "high", "xhigh", "max", ...(provider === "openai-codex" ? ["ultra"] : [])]) {
			await submit(`/sol-effort ${effort}`);
			await Bun.sleep(500);
			const marker = `XCSH_SOL_${effort.toUpperCase()}_${Bun.hash(root).toString(36)}_OK`;
			await submit(`Answer exactly ${marker}.`);
			await waitForAssistant(marker);
			rows.push({ step: `reasoning-${effort}`, outcome: "pass" });
		}
		await submit("/sol-effort medium");
		await Bun.sleep(500);
		await submit("/sol-speed fast");
		await Bun.sleep(500);
		const fastMarker = `XCSH_SOL_FAST_${Bun.hash(root).toString(36)}_OK`;
		await submit(`Answer exactly ${fastMarker}.`);
		await waitForAssistant(fastMarker);
		rows.push({ step: "fast", outcome: "pass" });
		await submit("/sol-speed standard");
		await Bun.sleep(500);
		if (provider === "openai-codex") {
			const marker = `XCSH_SOL_STEER_${Bun.hash(root).toString(36)}_OK`;
			const before = JSON.parse(await readFile(join(root, "transport.json"), "utf8"));
			await submit(`/sol-steer ${marker}`);
			await waitForAssistant(marker);
			const after = JSON.parse(await readFile(join(root, "transport.json"), "utf8"));
			const accepted = after.events.slice(before.events.length).includes("response.steer.accepted");
			rows.push({ step: "websocket-steering", outcome: accepted ? "pass" : "unsupported-or-fallback" });
		}
		const receipt = JSON.parse(await readFile(join(root, "transport.json"), "utf8"));
		if (!receipt.requests.some((request: any) => request.tier === "priority"))
			throw new Error("Fast request was not observed");
	}
	session.write("\x04");
	await run;
	if (callbackError) throw callbackError;
	console.log(
		JSON.stringify({
			provider,
			model: "gpt-6.1-sol",
			launcher: "bun run dev",
			terminal: "repository PtySession",
			sessionDirectory: root,
			rows,
		}),
	);
} finally {
	if (!exited) {
		session.write("\x03");
		session.write("\x04");
		session.kill();
	}
}
