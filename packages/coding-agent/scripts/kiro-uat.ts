/** Run from a managed Herdr pane. Captures rendered checkpoints privately.
 * Usage: bun packages/coding-agent/scripts/kiro-uat.ts --method builder|company --evidence /absolute/private/path
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const method = args[args.indexOf("--method") + 1];
const evidence = resolve(args[args.indexOf("--evidence") + 1] ?? "");
if (process.env.HERDR_ENV !== "1")
	throw new Error("Run in a managed Herdr pane; an external worker requires explicit pairing.");
if (!["builder", "company", "desktop", "fresh"].includes(method) || !args.includes("--evidence"))
	throw new Error("Specify --method builder|company and --evidence PATH");
const root = resolve(import.meta.dir, "../../..");
await mkdir(evidence, { recursive: true, mode: 0o700 });
async function command(argv: string[]): Promise<string> {
	const child = Bun.spawn(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (status !== 0) throw new Error(`${argv[0]} ${argv[1]} failed: ${stderr}`);
	return stdout;
}
await command(["bun", "scripts/ensure-dev-native.ts"]);
const parent = JSON.parse(await command(["herdr", "pane", "current", "--current"])).result.pane;
const layout = JSON.parse(await command(["herdr", "pane", "layout", "--pane", parent.pane_id])).result.layout;
const direction =
	layout.panes.find((p: { pane_id: string; rect: { width: number } }) => p.pane_id === parent.pane_id).rect.width >=
	120
		? "right"
		: "down";
const created = JSON.parse(
	await command([
		"herdr",
		"pane",
		"split",
		"--pane",
		parent.pane_id,
		"--direction",
		direction,
		"--cwd",
		root,
		"--no-focus",
	]),
);
const pane = created.result.pane.pane_id;
const paneInfo = {
	pane,
	parent: parent.pane_id,
	workspace: parent.workspace_id,
	tab: parent.tab_id,
	method,
	root,
	gitCommit: (await command(["git", "rev-parse", "HEAD"])).trim(),
	bunVersion: Bun.version,
	bunExecutableSha256: createHash("sha256")
		.update(await readFile(process.execPath))
		.digest("hex"),
	sourceSha256: createHash("sha256")
		.update(
			JSON.stringify(
				await Promise.all(
					(
						await Array.fromAsync(
							new Bun.Glob("packages/{ai,coding-agent,tui,agent,utils}/src/**/*.{ts,js}").scan({
								cwd: root,
								onlyFiles: true,
							}),
						)
					)
						.concat([
							"packages/coding-agent/scripts/kiro-uat.ts",
							"packages/coding-agent/test/fixtures/kiro/oidc-preload.ts",
							"scripts/dev-vertex-credentials.ts",
						])
						.sort()
						.map(async path => ({
							path,
							sha256: createHash("sha256")
								.update(await readFile(join(root, path)))
								.digest("hex"),
						})),
				),
			),
		)
		.digest("hex"),
	nativeReceiptSha256: createHash("sha256")
		.update(await readFile(join(root, "node_modules/.cache/xcsh-native-ready.json")))
		.digest("hex"),
	createdAt: new Date().toISOString(),
};
await writeFile(join(evidence, "owner.json"), JSON.stringify(paneInfo, null, 2));
let sequence = 0;
async function wait(pattern: RegExp, label: string, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const screen = await command(["herdr", "pane", "read", pane, "--source", "visible", "--lines", "80"]);
		if (pattern.test(screen)) {
			await writeFile(join(evidence, `${++sequence}-${label}.txt`), screen);
			return screen;
		}
		await Bun.sleep(250);
	}
	throw new Error(`Timeout waiting for ${label}; inspect task pane ${pane}`);
}
async function keys(...keys: string[]) {
	await command(["herdr", "pane", "send-keys", pane, ...keys]);
}
async function input(value: string) {
	await command(["herdr", "pane", "send-text", pane, value]);
	await keys("enter");
}
function quote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
const agentDir = join(evidence, "agent");
await mkdir(agentDir, { recursive: true, mode: 0o700 });
const fixture = ["builder", "company"].includes(method)
	? `--preload ${quote(join(root, "packages/coding-agent/test/fixtures/kiro/oidc-preload.ts"))}`
	: "";
const executable = ["builder", "company"].includes(method)
	? `${quote(process.execPath)} ${fixture} ${quote(join(root, "packages/coding-agent/src/cli.ts"))}`
	: `${quote(process.execPath)} dev`;
const launch = `PATH=${quote(dirname(process.execPath))}:$PATH PI_CODING_AGENT_DIR=${quote(agentDir)} ${executable} --no-extensions --no-skills --no-rules`;
async function currentSessionPath(): Promise<string | undefined> {
	try {
		for (const entry of await readdir(join(agentDir, "terminal-sessions"))) {
			const lines = (await readFile(join(agentDir, "terminal-sessions", entry), "utf8")).trim().split("\n");
			if (lines[1]) return lines[1];
		}
	} catch {}
	return undefined;
}
async function launchCandidate(label: string) {
	const before = await currentSessionPath();
	await command(["herdr", "pane", "run", pane, launch]);
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const path = await currentSessionPath();
		if (path && path !== before) {
			await wait(/╰─.*▏/, label);
			return path;
		}
		await Bun.sleep(250);
	}
	throw new Error(`No fresh native session after ${label}`);
}

try {
	await launchCandidate("startup");
	await input("/login kiro");
	await wait(/Review provider sign-in/, "credential-review");
	await keys("down", "enter");
	await wait(/Kiro account/, "account-method");
	await input(method === "company" ? "Company SSO" : method === "desktop" ? "1" : "AWS Builder ID");
	if (method === "company") {
		await wait(/Company SSO start URL/, "company-url");
		await input("https://company.awsapps.com/start");
		await wait(/Company SSO issuer region/, "company-region");
		await input("eu-west-1");
	}
	await wait(/Use recommended model|Browse models/, "connected", method === "fresh" ? 600000 : 30000);
	await keys("enter");
	await wait(/Choose reasoning for this model/, "reasoning");
	await keys("enter");
	await wait(/Choose where this model applies/, "scope");
	await keys("down", "enter");
	await wait(/Review model selection/, "model-review");
	await keys("down", "enter");
	await wait(/Saved default/, "model-saved");
	async function files(dir: string): Promise<string[]> {
		const entries = await readdir(dir, { withFileTypes: true });
		return (
			await Promise.all(
				entries.map(e =>
					e.isDirectory()
						? files(join(dir, e.name))
						: Promise.resolve(e.name.endsWith(".jsonl") ? [join(dir, e.name)] : []),
				),
			)
		).flat();
	}
	async function inference(label: string, fixture?: { path: string; value: string }) {
		const marker = crypto.randomUUID();
		const expected = fixture?.value ?? "4";
		const sessionPath = await currentSessionPath();
		const beforeCount =
			sessionPath && (await Bun.file(sessionPath).exists())
				? (await readFile(sessionPath, "utf8")).split("\n").filter(Boolean).length
				: 0;
		const promptText = fixture
			? "Read packages/ai/README.md using the read tool and tell me its first Markdown heading."
			: "What is 2 + 2? Reply with only the number.";
		await writeFile(
			join(evidence, `${label}-admission.json`),
			JSON.stringify(
				{ marker, sessionPath, beforeCount, promptSha256: createHash("sha256").update(promptText).digest("hex") },
				null,
				2,
			),
		);
		await input(promptText);
		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			for (const file of await files(join(agentDir, "sessions"))) {
				if (file !== sessionPath) continue;
				const records = (await readFile(file, "utf8"))
					.split("\n")
					.filter(Boolean)
					.map(line => JSON.parse(line));
				const userIndex = records.findIndex(
					(r, index) =>
						index >= beforeCount &&
						r.message?.role === "user" &&
						JSON.stringify(r.message.content).includes(promptText),
				);
				if (userIndex < 0) continue;
				const afterUser = records.slice(userIndex + 1);
				const assistant = afterUser.find(
					r => r.message?.role === "assistant" && r.message.stopReason !== "toolUse",
				);
				if (!assistant) continue;
				const started = records
					.slice(0, userIndex + 1)
					.reverse()
					.find(r => r.customType === "remote-history" && r.data?.kind === "turnStarted");
				const completed =
					started &&
					records
						.slice(userIndex + 1)
						.find(
							r =>
								r.customType === "remote-history" &&
								r.data?.kind === "turnCompleted" &&
								r.data.id === started.data.id,
						);
				if (!completed) continue;
				if (completed.data.status !== "completed") throw new Error("Kiro native turn did not complete");
				if (
					assistant.message.stopReason !== "stop" ||
					!JSON.stringify(assistant.message.content).includes(expected)
				)
					throw new Error(
						`Kiro ${label} inference failed: ${assistant.message.errorMessage ?? assistant.message.stopReason}`,
					);
				if (assistant.message.provider !== "kiro" || assistant.message.api !== "kiro-api")
					throw new Error("Inference was served by the wrong provider");
				if (fixture) {
					const calls = afterUser.flatMap(r =>
						r.message?.role === "assistant"
							? r.message.content.filter((c: { type: string }) => c.type === "toolCall")
							: [],
					);
					const call = calls.find(c => c.name === "read" && resolve(root, c.arguments.path) === fixture.path);
					const result =
						call &&
						afterUser.find(
							r =>
								r.message?.role === "toolResult" &&
								r.message.toolCallId === call.id &&
								!r.message.isError &&
								JSON.stringify(r.message.content).includes(fixture.value),
						);
					if (!result) throw new Error("Native read tool and its continuation were not verified");
				}
				const screen = await command(["herdr", "pane", "read", pane, "--source", "visible", "--lines", "80"]);
				await writeFile(join(evidence, `${++sequence}-${label}.txt`), screen);
				return {
					sessionId: records[0].id,
					turnId: started.data.id,
					userMessageId: records[userIndex].id,
					assistantMessageId: assistant.id,
					provider: assistant.message.provider,
					api: assistant.message.api,
					model: assistant.message.model,
					stopReason: assistant.message.stopReason,
					tokenSource: assistant.message.usage.tokenSource,
				};
			}
			await Bun.sleep(250);
		}
		throw new Error(`Timed out waiting for ${label} session evidence`);
	}
	const first = await inference("inference");
	let tool: Awaited<ReturnType<typeof inference>> | undefined;
	if (["desktop", "fresh"].includes(method)) {
		const path = join(root, "packages/ai/README.md");
		const value = (await readFile(path, "utf8"))
			.split("\n")
			.find(line => line.startsWith("# "))!
			.slice(2);
		const fixture = { path, value };
		tool = await inference("read-only-tool", fixture);
	}
	await input("/quit");
	await Bun.sleep(500);
	await launchCandidate("restart");
	const second = await inference("restart-inference");
	await input("/logout");
	await wait(/Disconnect a provider/, "logout-provider");
	await input("kiro");
	await wait(/Review provider credential removal/, "logout-review");
	await keys("down", "enter");
	await wait(/Logged out|logged out|removed|Removed/, "logout");
	await input("/quit");
	await writeFile(
		join(evidence, "status.json"),
		JSON.stringify({ ...paneInfo, status: "passed", first, second, tool }, null, 2),
	);
	console.log(JSON.stringify({ pane, method, evidence, status: "passed", first, second, tool }));
} catch (error) {
	const screen = await command(["herdr", "pane", "read", pane, "--source", "visible", "--lines", "80"]);
	await writeFile(join(evidence, "failure.txt"), screen);
	throw error;
}
