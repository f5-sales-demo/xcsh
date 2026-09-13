import { createHash } from "node:crypto";
import { chmod, cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { getAgentDbPath } from "@f5-sales-demo/pi-utils";
import { YAML } from "bun";
import { MarketplaceManager } from "../src/extensibility/plugins/marketplace";
import { resolveLocalUrlToPath } from "../src/internal-urls";
import { getMemoryRoot, inspectMemoryClear, inspectMemoryConsolidation } from "../src/memories";
import { closeMemoryDb, openMemoryDb, upsertThreads } from "../src/memories/storage";
import { getSettingsForTab } from "../src/modes/components/settings-defs";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { createCaptureTerminal, terminalViewportAnsi, writeTerminalCapture } from "./terminal-capture";
import { createTerminalUatProfile, parseTerminalUatVariant } from "./terminal-uat-profile";

const forceFixture = process.argv.includes("--force-fixture");
const routeFixture = process.argv.includes("--route-fixture");
const planFixture = process.argv.includes("--plan-fixture");
const exportFixture = process.argv.includes("--export-fixture");
const publicationFixture = process.argv.includes("--publication-fixture");
const copyFixture = process.argv.includes("--copy-fixture");
const memoryFixture = process.argv.includes("--memory-fixture");
const compactFixture = process.argv.includes("--compact-fixture");
const reloadPluginsFixture = process.argv.includes("--reload-plugins-fixture");
const backgroundFixture = process.argv.includes("--background-fixture");
const exitFixture = process.argv.includes("--exit-fixture");
const browserFixture = process.argv.includes("--browser-fixture");
const reportsFixture = process.argv.includes("--reports-fixture");
const foundationFixture = process.argv.includes("--foundation-fixture");
const pluginFixture = process.argv.includes("--plugin-fixture");
const inventoriesFixture = process.argv.includes("--inventories-fixture");
const sessionsFixture = process.argv.includes("--sessions-fixture");
const resourcesFixture = process.argv.includes("--resources-fixture");
const connectionsFixture = process.argv.includes("--connections-fixture");
if (
	[
		forceFixture,
		routeFixture,
		planFixture,
		exportFixture,
		publicationFixture,
		copyFixture,
		memoryFixture,
		compactFixture,
		reloadPluginsFixture,
		backgroundFixture,
		exitFixture,
		browserFixture,
		reportsFixture,
		foundationFixture,
		pluginFixture,
		inventoriesFixture,
		sessionsFixture,
		resourcesFixture,
		connectionsFixture,
	].filter(Boolean).length > 1
)
	throw new Error("Choose one terminal fixture");
const providerFixture =
	forceFixture ||
	routeFixture ||
	planFixture ||
	exportFixture ||
	publicationFixture ||
	copyFixture ||
	compactFixture ||
	reloadPluginsFixture ||
	backgroundFixture ||
	exitFixture ||
	browserFixture ||
	reportsFixture ||
	foundationFixture ||
	pluginFixture;
// Session handoff uses the isolated provider; all other session operations remain local.
const usesSessionProviderFixture = sessionsFixture;
// Settings and inventory screens still need the isolated provider-backed editor shell.
const usesProviderFixture =
	providerFixture || inventoriesFixture || usesSessionProviderFixture || resourcesFixture || connectionsFixture;
const variant = parseTerminalUatVariant(
	process.argv
		.slice(2)
		.filter(
			arg =>
				![
					"--force-fixture",
					"--route-fixture",
					"--plan-fixture",
					"--export-fixture",
					"--publication-fixture",
					"--copy-fixture",
					"--memory-fixture",
					"--compact-fixture",
					"--reload-plugins-fixture",
					"--background-fixture",
					"--exit-fixture",
					"--browser-fixture",
					"--reports-fixture",
					"--foundation-fixture",
					"--plugin-fixture",
					"--inventories-fixture",
					"--sessions-fixture",
					"--resources-fixture",
					"--connections-fixture",
				].includes(arg),
		),
);
const profile = await createTerminalUatProfile(
	variant,
	publicationFixture
		? "publication"
		: exportFixture
			? "export"
			: connectionsFixture
				? "connections"
				: usesProviderFixture
					? "read"
					: "none",
);
if (reportsFixture) {
	const config = Bun.file(join(profile.agentDir, "config.yml"));
	await Bun.write(
		config,
		`${await config.text()}async:\n  enabled: true\nmedia:\n  reducedMotion: true\n  autoplay: true\n  fpsCap: 12\n`,
	);
	const logsDir = join(profile.root, "config", "logs");
	await mkdir(logsDir, { recursive: true });
	await Bun.write(
		join(logsDir, `xcsh.${new Date().toISOString().slice(0, 10)}.log`),
		`${JSON.stringify({ time: new Date().toISOString(), level: "info", pid: process.pid, message: "synthetic terminal report fixture" })}\n`,
	);
}
if (sessionsFixture) {
	const config = Bun.file(join(profile.agentDir, "config.yml"));
	await Bun.write(config, `${await config.text()}branchSummary:\n  enabled: true\n`);
}
const chromeRequests: Array<{ method: string; path: string; status: number }> = [];
let cleanupBrowserFixture = async () => {};
let stopBrowserEndpoint = async () => {};
let restartBrowserEndpoint = async () => {};
if (browserFixture) {
	profile.env.HOME = profile.root;
	const chromeExecutable = Bun.which("google-chrome") ?? Bun.which("chromium") ?? Bun.which("chromium-browser");
	if (!chromeExecutable) throw new Error("Browser fixture requires a local Chrome/Chromium executable");
	const chromeProfile = join(profile.root, "disposable-chrome-profile");
	await mkdir(chromeProfile, { recursive: true });
	const chromeCommand = (port: number) => [
		chromeExecutable,
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${chromeProfile}`,
		"about:blank",
	];
	let chrome = Bun.spawn(chromeCommand(0), {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	const portFilePath = join(chromeProfile, "DevToolsActivePort");
	const deadline = performance.now() + 15_000;
	while (!(await Bun.file(portFilePath).exists()) && chrome.exitCode === null && performance.now() < deadline)
		await Bun.sleep(25);
	if (!(await Bun.file(portFilePath).exists())) {
		chrome.kill();
		await chrome.exited;
		throw new Error("Disposable Chrome did not publish a DevTools endpoint");
	}
	const chromePort = Number((await Bun.file(portFilePath).text()).split("\n", 1)[0]);
	if (!Number.isInteger(chromePort) || chromePort < 1) throw new Error("Disposable Chrome published an invalid port");
	const chromeOrigin = `http://127.0.0.1:${chromePort}`;
	const proxy = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			let response: Response;
			try {
				// Do not forward the proxy Host header: Chrome rejects discovery
				// requests addressed to a different loopback port.
				response = await fetch(`${chromeOrigin}${url.pathname}${url.search}`, {
					method: request.method,
				});
			} catch {
				response = new Response("Disposable Chrome endpoint unavailable", {
					status: 503,
				});
			}
			chromeRequests.push({
				method: request.method,
				path: url.pathname,
				status: response.status,
			});
			await Bun.write(join(profile.root, "browser-proxy-requests.json"), JSON.stringify(chromeRequests, null, 2));
			return response;
		},
	});
	const proxyProbe = await fetch(new URL("/json/version", proxy.url));
	if (!proxyProbe.ok)
		throw new Error(`Disposable Chrome discovery proxy failed its self-check (${proxyProbe.status})`);
	chromeRequests.length = 0;
	const config = Bun.file(join(profile.agentDir, "config.yml"));
	await Bun.write(
		config,
		`${await config.text()}browser:\n  enabled: true\n  headless: true\n  connectUrl: ${proxy.url.toString()}\n  chromePath: ${JSON.stringify(chromeExecutable)}\n`,
	);
	stopBrowserEndpoint = async () => {
		if (chrome.exitCode === null) chrome.kill();
		await chrome.exited;
	};
	restartBrowserEndpoint = async () => {
		await stopBrowserEndpoint();
		chrome = Bun.spawn(chromeCommand(chromePort), {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		const retryDeadline = performance.now() + 15_000;
		while (chrome.exitCode === null && performance.now() < retryDeadline) {
			try {
				if ((await fetch(`${chromeOrigin}/json/version`)).ok) return;
			} catch {
				// The disposable endpoint is still starting.
			}
			await Bun.sleep(25);
		}
		throw new Error("Disposable Chrome did not restart on its reviewed endpoint");
	};
	cleanupBrowserFixture = async () => {
		await proxy.stop(true);
		await stopBrowserEndpoint();
	};
}
const exportMessage = "Synthetic terminal export conversation";
const approvalPlanText = "# Synthetic execution plan\n\n1. Read only disposable fixture state.\n2. Report completion.";
const typedPlanningPrompt = "Continue synthetic planning without leaving plan mode";
const copyUserMessage = "Synthetic clipboard user request";
const copyAssistantText =
	"Synthetic clipboard assistant response\n\n```text\nfirst copied block\n```\n\n```text\nsecond copied block\n```\n\n[Synthetic clipboard link](https://example.test/copy-target)";
const copyCommand = "printf synthetic-clipboard-command";
let copySessionFile: string | undefined;
let compactSessionFile: string | undefined;
let exitSessionFile: string | undefined;
let publicationSessionFile: string | undefined;
let reportsSessionFile: string | undefined;
let reportsSeedBytes: string | undefined;
const sessionFixtureUsage = () => ({
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});
let sessionFixture:
	| {
			activeFile: string;
			activeId: string;
			resumeFile: string;
			resumeId: string;
			branchUserId: string;
			treeAlternateId: string;
			moveDirectory: string;
	  }
	| undefined;
if (sessionsFixture) {
	// Seed the same canonical per-CWD store that the real /resume browser enumerates.
	// Passing an arbitrary --session path is sufficient to open one file, but it does
	// not make sibling fixtures discoverable through SessionManager.listAll().
	const sessionDirectory = SessionManager.getDefaultSessionDir(profile.cwd, profile.agentDir);
	const active = SessionManager.create(profile.cwd, sessionDirectory);
	const rootUser = active.appendMessage({ role: "user", content: "Synthetic root session request", timestamp: 1 });
	const rootAssistant = active.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic root response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: sessionFixtureUsage(),
		timestamp: 2,
	});
	const branchUserId = active.appendMessage({
		role: "user",
		content: "Synthetic primary branch request",
		timestamp: 3,
	});
	active.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic primary branch response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: sessionFixtureUsage(),
		timestamp: 4,
	});
	active.branch(rootAssistant);
	const treeAlternateId = active.appendMessage({
		role: "user",
		content: "Synthetic alternate tree request",
		timestamp: 5,
	});
	active.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic alternate tree response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: sessionFixtureUsage(),
		timestamp: 6,
	});
	await active.setSessionName("Synthetic active tree", "user");
	await active.retryPersistence();
	const activeFile = active.getSessionFile();
	if (!activeFile) throw new Error("Missing active session fixture file");
	const activeId = active.getSessionId();
	await active.close();

	const resume = SessionManager.create(profile.cwd, sessionDirectory);
	resume.appendMessage({ role: "user", content: "Synthetic resume target conversation", timestamp: 7 });
	resume.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic resume target response" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: sessionFixtureUsage(),
		timestamp: 8,
	});
	await resume.setSessionName("Synthetic resume target", "user");
	await resume.retryPersistence();
	const resumeFile = resume.getSessionFile();
	if (!resumeFile) throw new Error("Missing resume session fixture file");
	const resumeId = resume.getSessionId();
	await resume.close();

	const moveDirectory = join(profile.root, "moved-project");
	await mkdir(moveDirectory, { recursive: true });
	sessionFixture = { activeFile, activeId, resumeFile, resumeId, branchUserId, treeAlternateId, moveDirectory };
	await Bun.write(join(profile.root, "sessions-fixture.json"), JSON.stringify(sessionFixture, null, 2));
	profile.args.push("--session", activeFile);
	void rootUser;
}
if (memoryFixture) {
	const memoryRoot = getMemoryRoot(profile.agentDir, profile.cwd);
	await mkdir(memoryRoot, { recursive: true });
	await Bun.write(
		join(memoryRoot, "memory_summary.md"),
		Array.from(
			{ length: 72 },
			(_, index) => `Synthetic memory detail ${index + 1}: deterministic project-only fixture content.`,
		).join("\n"),
	);
	const db = openMemoryDb(getAgentDbPath(profile.agentDir));
	try {
		upsertThreads(db, [
			{
				id: "synthetic-memory-thread",
				updatedAt: 1,
				rolloutPath: "synthetic-rollout.jsonl",
				cwd: profile.cwd,
				sourceKind: "fixture",
			},
		]);
		db.run(
			"INSERT INTO stage1_outputs(thread_id,source_updated_at,raw_memory,rollout_summary,generated_at) VALUES (?,?,?,?,?)",
			["synthetic-memory-thread", 1, "synthetic raw memory", "synthetic rollout summary", 1],
		);
	} finally {
		closeMemoryDb(db);
	}
}
if (exportFixture || publicationFixture) {
	const seed = SessionManager.create(profile.cwd, join(profile.root, "sessions"));
	seed.appendMessage({
		role: "user",
		content: publicationFixture
			? `${exportMessage}\n\nOriginal link: https://example.test/original-before-review`
			: exportMessage,
		timestamp: 1,
	});
	await seed.retryPersistence();
	const sessionFile = seed.getSessionFile();
	if (!sessionFile) throw new Error("Missing disposable export session");
	if (publicationFixture) publicationSessionFile = sessionFile;
	await seed.close();
	profile.args.push("--session", sessionFile);
}
if (reportsFixture) {
	const seed = SessionManager.create(profile.cwd, join(profile.root, "sessions"));
	seed.appendMessage({
		role: "user",
		content: "Synthetic reports and conversation fixture",
		timestamp: 1,
	});
	seed.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic baseline response before reports." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: sessionFixtureUsage(),
		timestamp: 2,
	});
	seed.appendMessage({
		role: "media",
		media: {
			version: 1,
			id: "media_0123456789abcdef01234567",
			kind: "text-timeline",
			durationMs: 10_000,
			timeline: [
				{ text: "Synthetic media frame one", durationMs: 5_000 },
				{ text: "Synthetic media frame two", durationMs: 5_000 },
			],
			provenance: { sourceType: "timeline", source: "timeline:terminal-reports-fixture" },
			playback: { autoplay: true, loop: false, muted: true, fpsCap: 12 },
		},
		timestamp: 3,
	});
	await seed.retryPersistence();
	reportsSessionFile = seed.getSessionFile();
	if (!reportsSessionFile) throw new Error("Missing disposable reports session");
	await seed.close();
	reportsSeedBytes = await Bun.file(reportsSessionFile).text();
	profile.args.push("--session", reportsSessionFile);
}
if (copyFixture) {
	if (process.env.XCSH_UAT_ISOLATED_DISPLAY !== "1" || !process.env.DISPLAY)
		throw new Error("Copy fixture requires terminal-uat-matrix isolated Xvfb");
	profile.env.DISPLAY = process.env.DISPLAY;
	if (process.env.XAUTHORITY) profile.env.XAUTHORITY = process.env.XAUTHORITY;
	const seed = SessionManager.create(profile.cwd, join(profile.root, "sessions"));
	seed.appendMessage({ role: "user", content: copyUserMessage, timestamp: 1 });
	seed.appendMessage({
		role: "assistant",
		content: [
			{ type: "text", text: copyAssistantText },
			{
				type: "toolCall",
				id: "synthetic-copy-call",
				name: "bash",
				arguments: { command: copyCommand },
			},
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	});
	await seed.retryPersistence();
	copySessionFile = seed.getSessionFile();
	if (!copySessionFile) throw new Error("Missing disposable copy session");
	await seed.close();
	profile.args.push("--session", copySessionFile);
}
if (compactFixture) {
	const config = Bun.file(join(profile.agentDir, "config.yml"));
	await Bun.write(
		config,
		`${await config.text()}compaction:\n  keepRecentTokens: 1\n  reserveTokens: 1024\n  remoteEnabled: false\n`,
	);
	const seed = SessionManager.create(profile.cwd, join(profile.root, "sessions"));
	seed.appendMessage({
		role: "user",
		content: "Synthetic first compaction request",
		timestamp: 1,
	});
	seed.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic first response for compaction." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	});
	seed.appendMessage({
		role: "user",
		content: "Synthetic second compaction request",
		timestamp: 3,
	});
	seed.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "Synthetic second response for compaction." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 4,
	});
	await seed.retryPersistence();
	compactSessionFile = seed.getSessionFile();
	if (!compactSessionFile) throw new Error("Missing disposable compaction session");
	await seed.close();
	profile.args.push("--session", compactSessionFile);
}
if (exitFixture) {
	const seed = SessionManager.create(profile.cwd, join(profile.root, "sessions"));
	await seed.retryPersistence();
	exitSessionFile = seed.getSessionFile();
	if (!exitSessionFile) throw new Error("Missing disposable exit session");
	await seed.close();
	profile.args.push("--session", exitSessionFile);
}
const root = resolve(import.meta.dir, "../../..");
let pluginSource = "";
let pluginManager: MarketplaceManager | undefined;
let pluginManagerOptions: ConstructorParameters<typeof MarketplaceManager>[0] | undefined;
if (pluginFixture) {
	pluginSource = join(profile.root, "synthetic-marketplace");
	await cp(join(root, "packages/coding-agent/test/marketplace/fixtures/valid-marketplace"), pluginSource, {
		recursive: true,
	});
	const configRoot = join(profile.root, "config");
	const pluginsRoot = join(configRoot, "plugins");
	const projectRegistry = join(profile.cwd, ".xcsh", "plugins", "installed_plugins.json");
	await mkdir(resolve(projectRegistry, "../.."), { recursive: true });
	pluginManagerOptions = {
		marketplacesRegistryPath: join(configRoot, "marketplaces.json"),
		installedRegistryPath: join(pluginsRoot, "installed_plugins.json"),
		projectInstalledRegistryPath: projectRegistry,
		marketplacesCacheDir: join(pluginsRoot, "cache", "marketplaces"),
		pluginsCacheDir: join(pluginsRoot, "cache", "plugins"),
	};
	pluginManager = new MarketplaceManager(pluginManagerOptions);
	await pluginManager.addMarketplace(pluginSource);
}
if (inventoriesFixture) {
	const agentDirectory = join(profile.cwd, ".xcsh", "agents");
	const skillDirectory = join(profile.cwd, ".xcsh", "skills", "synthetic-inventory-skill");
	await mkdir(agentDirectory, { recursive: true });
	await mkdir(skillDirectory, { recursive: true });
	await Bun.write(
		join(agentDirectory, "synthetic-inventory-agent.md"),
		"---\nname: synthetic-inventory-agent\ndescription: Use this agent when deterministic inventory behavior needs verification.\n---\n\nInspect only the disposable inventory fixture.\n",
	);
	await Bun.write(
		join(skillDirectory, "SKILL.md"),
		"---\nname: synthetic-inventory-skill\ndescription: Synthetic disposable skill for terminal inventory acceptance.\n---\n\n# Synthetic inventory skill\n\nUse only in the disposable terminal UAT profile.\n",
	);
	const pluginDirectory = join(profile.root, "xdg-data", "xcsh", "plugins");
	const installedPluginDirectory = join(pluginDirectory, "node_modules", "synthetic-settings-plugin");
	await mkdir(installedPluginDirectory, { recursive: true });
	await Bun.write(
		join(pluginDirectory, "package.json"),
		`${JSON.stringify({ name: "xcsh-plugins", private: true, dependencies: { "synthetic-settings-plugin": "1.0.0" } }, null, 2)}\n`,
	);
	await Bun.write(
		join(installedPluginDirectory, "package.json"),
		`${JSON.stringify(
			{
				name: "synthetic-settings-plugin",
				version: "1.0.0",
				xcsh: {
					version: "1.0.0",
					description: "Disposable plugin settings fixture",
					settings: {
						mode: { type: "enum", values: ["safe", "verbose"], default: "safe", description: "Synthetic mode" },
						secret: { type: "string", secret: true, description: "Synthetic masked value" },
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	await Bun.write(
		join(pluginDirectory, "xcsh-plugins.lock.json"),
		`${JSON.stringify(
			{
				plugins: { "synthetic-settings-plugin": { version: "1.0.0", enabled: true, enabledFeatures: null } },
				settings: { "synthetic-settings-plugin": { mode: "safe", secret: "synthetic-redacted" } },
			},
			null,
			2,
		)}\n`,
	);
}
const connectionRequests: Array<{ method: string; path: string; authorized: boolean }> = [];
let connectionService: ReturnType<typeof Bun.serve> | undefined;
let connectionContextRoot = "";
let connectionProjectConfigRoot = "";
let connectionMcpPath = "";
let connectionSshPath = "";
let connectionLocalActivePath = "";
if (connectionsFixture) {
	connectionService = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			const authorized = request.headers.get("authorization") === "APIToken xcsh-uat-context-token";
			connectionRequests.push({ method: request.method, path, authorized });
			if (!authorized) return Response.json({ code: 16, message: "synthetic unauthorized" }, { status: 401 });
			if (request.method === "GET" && path === "/api/web/namespaces")
				return Response.json({ items: [{ name: "default" }, { name: "system" }] });
			return Response.json({ code: 5, message: "synthetic route not found" }, { status: 404 });
		},
	});
	connectionContextRoot = join(profile.env.XDG_CONFIG_HOME, "xcsh");
	connectionProjectConfigRoot = join(profile.cwd, ".xcsh");
	await mkdir(join(connectionContextRoot, "contexts"), { recursive: true, mode: 0o700 });
	await mkdir(join(connectionProjectConfigRoot, "contexts"), { recursive: true, mode: 0o700 });
	const context = (name: string, namespace: string) =>
		`${JSON.stringify(
			{
				name,
				apiUrl: connectionService!.url.origin,
				apiToken: "xcsh-uat-context-token",
				defaultNamespace: namespace,
				version: 1,
			},
			null,
			2,
		)}\n`;
	await Bun.write(join(connectionContextRoot, "contexts", "primary.json"), context("primary", "default"));
	await Bun.write(join(connectionContextRoot, "contexts", "secondary.json"), context("secondary", "system"));
	await Bun.write(join(connectionContextRoot, "active_context"), "primary\n");
	await Bun.write(
		join(connectionProjectConfigRoot, "contexts", "primary.json"),
		`${JSON.stringify({ context: "primary" }, null, 2)}\n`,
	);
	connectionLocalActivePath = join(connectionProjectConfigRoot, "contexts", "active_context");
	await Bun.write(connectionLocalActivePath, "primary\n");
	const mcpServer = resolve(import.meta.dir, "../test/fixtures/terminal-uat-mcp-server.mjs");
	connectionMcpPath = join(connectionProjectConfigRoot, "mcp.json");
	await Bun.write(
		connectionMcpPath,
		`${JSON.stringify(
			{
				mcpServers: {
					"synthetic-mcp": { type: "stdio", command: process.execPath, args: [mcpServer], timeout: 5_000 },
				},
			},
			null,
			2,
		)}\n`,
	);
	connectionSshPath = join(connectionProjectConfigRoot, "ssh.json");
	await Bun.write(
		connectionSshPath,
		`${JSON.stringify(
			{
				hosts: {
					loopback: {
						host: "127.0.0.1",
						username: "synthetic-user",
						port: connectionService.port,
						description: "Disposable loopback endpoint",
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	for (const file of [
		join(connectionContextRoot, "contexts", "primary.json"),
		join(connectionContextRoot, "contexts", "secondary.json"),
		join(connectionContextRoot, "active_context"),
		join(connectionProjectConfigRoot, "contexts", "primary.json"),
		connectionLocalActivePath,
		connectionMcpPath,
		connectionSshPath,
	])
		await chmod(file, 0o600);
}
const resourceRequests: Array<{ method: string; path: string; body?: unknown; status: number }> = [];
const resourceObjects = new Map<string, Record<string, unknown>>();
let failNextResourceMutation = false;
let failResourceReads = false;
let resourceService: ReturnType<typeof Bun.serve> | undefined;
let resourceManifestPath = "";
let resourceManifestOutput = "";
if (resourcesFixture) {
	resourceService = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json();
			const finish = (payload: unknown, status = 200) => {
				resourceRequests.push({ method: request.method, path: url.pathname, body, status });
				return Response.json(payload, { status });
			};
			if (request.headers.get("authorization") !== "APIToken xcsh-uat-resource-token")
				return finish({ code: 16, message: "synthetic unauthorized" }, 401);
			if (request.method === "GET" && url.pathname === "/api/web/namespaces")
				return finish({ items: [{ name: "demo" }, { name: "system" }] });
			const match = url.pathname.match(/^\/api\/config\/namespaces\/demo\/http_loadbalancers(?:\/([^/]+))?$/);
			if (!match) return finish({ code: 5, message: "synthetic route not found" }, 404);
			const name = match[1] ? decodeURIComponent(match[1]) : undefined;
			if (request.method === "GET" && failResourceReads)
				return finish({ code: 14, message: "synthetic resource service unavailable" }, 502);
			if (request.method === "GET" && !name) return finish({ items: [...resourceObjects.values()] });
			if (request.method === "GET" && name) {
				const value = resourceObjects.get(name);
				return value ? finish(value) : finish({ code: 5, message: "not found" }, 404);
			}
			if (["POST", "PUT", "DELETE"].includes(request.method)) {
				await Bun.sleep(650);
				if (failNextResourceMutation) {
					failNextResourceMutation = false;
					return finish({ code: 13, message: "synthetic mutation failure" }, 500);
				}
			}
			if (request.method === "POST" && body && typeof body === "object") {
				const record = body as Record<string, unknown>;
				const metadata = record.metadata as Record<string, unknown>;
				const objectName = String(metadata.name);
				const stored = { ...record, metadata: { ...metadata, namespace: "demo" } };
				resourceObjects.set(objectName, stored);
				return finish(stored);
			}
			if (request.method === "PUT" && name && body && typeof body === "object") {
				const record = body as Record<string, unknown>;
				const stored = {
					...record,
					metadata: { ...(record.metadata as Record<string, unknown>), name, namespace: "demo" },
				};
				resourceObjects.set(name, stored);
				return finish(stored);
			}
			if (request.method === "DELETE" && name) {
				if (!resourceObjects.delete(name)) return finish({ code: 5, message: "not found" }, 404);
				return finish({});
			}
			return finish({ code: 3, message: "unsupported synthetic request" }, 400);
		},
	});
	const contextRoot = join(profile.env.XDG_CONFIG_HOME, "xcsh");
	await mkdir(join(contextRoot, "contexts"), { recursive: true, mode: 0o700 });
	await Bun.write(
		join(contextRoot, "contexts", "synthetic-resource.json"),
		`${JSON.stringify(
			{
				name: "synthetic-resource",
				apiUrl: resourceService.url.origin,
				apiToken: "xcsh-uat-resource-token",
				defaultNamespace: "demo",
				version: 1,
			},
			null,
			2,
		)}\n`,
	);
	await Bun.write(join(contextRoot, "active_context"), "synthetic-resource\n");
	resourceManifestPath = join(profile.cwd, "synthetic-http-lb.yaml");
	resourceManifestOutput = join(profile.cwd, "exported-http-lb.yaml");
	await Bun.write(
		resourceManifestPath,
		"kind: http_loadbalancer\nmetadata:\n  name: reviewed-lb\n  namespace: demo\nspec:\n  domains:\n    - initial.example.test\n  routes: []\n  origin_pools: []\n",
	);
	const commandDir = join(profile.cwd, ".xcsh", "commands");
	await mkdir(commandDir, { recursive: true });
	await Bun.write(
		join(commandDir, "get.md"),
		"---\ndescription: Synthetic shadowed prompt command\n---\nThis must remain shadowed by built-in execution.\n",
	);
	await Bun.write(
		join(commandDir, "synthetic-expand.md"),
		"---\ndescription: Synthetic project prompt expansion\n---\nExpand this disposable fixture only.\n",
	);
}
const output = join(profile.root, "evidence");
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: root });
if (revision.exitCode || diff.exitCode) throw new Error("Missing source provenance");
const hash = createHash("sha256").update(diff.stdout);
for (const pattern of [
	"packages/coding-agent/src/**/*.ts",
	"packages/tui/src/**/*.ts",
	"packages/coding-agent/scripts/*terminal*.ts",
	"packages/coding-agent/test/fixtures/terminal-uat-opener.sh",
	"packages/coding-agent/test/fixtures/terminal-uat-mcp-server.mjs",
])
	for (const file of [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort())
		hash.update(file).update(await Bun.file(join(root, file)).bytes());
const fingerprint = hash.digest("hex");
const providerRequests: Array<{ method: string; path: string }> = [];
let usageRequestNumber = 0;
let foundationProbeDelaysRemaining = 2;
const exitProviderGate = Promise.withResolvers<void>();
let anthropicMessageNumber = 0;
const anthropicStream = (events: Array<Record<string, unknown>>) =>
	new Response(`${events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\n`, {
		headers: {
			"content-type": "text/event-stream",
			"request-id": `req_xcsh_uat_${anthropicMessageNumber}`,
		},
	});
const anthropicToolResponse = () => {
	const id = `msg_xcsh_uat_tool_${++anthropicMessageNumber}`;
	return anthropicStream([
		{
			type: "message_start",
			message: {
				id,
				model: "claude-sonnet-4-5",
				usage: {
					input_tokens: 1,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: `toolu_xcsh_uat_${anthropicMessageNumber}`,
				name: "exit_plan_mode",
				input: { title: "SYNTHETIC_EXECUTION_PLAN" },
			},
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	]);
};
const anthropicExecutionResponse = () => {
	const id = `msg_xcsh_uat_execution_${++anthropicMessageNumber}`;
	return anthropicStream([
		{
			type: "message_start",
			message: {
				id,
				model: "claude-sonnet-4-5",
				usage: {
					input_tokens: 1,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Synthetic execution accepted." },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	]);
};
const anthropicPlanningResponse = () => {
	const id = `msg_xcsh_uat_planning_${++anthropicMessageNumber}`;
	return anthropicStream([
		{
			type: "message_start",
			message: {
				id,
				model: "claude-sonnet-4-5",
				usage: {
					input_tokens: 1,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Synthetic planning continued." },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	]);
};
const anthropicTextResponse = (text: string) => {
	const id = `msg_xcsh_uat_text_${++anthropicMessageNumber}`;
	return anthropicStream([
		{
			type: "message_start",
			message: {
				id,
				model: "claude-sonnet-4-5",
				usage: {
					input_tokens: 1,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 1,
				output_tokens: 1,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
		{ type: "message_stop" },
	]);
};
const localProvider = usesProviderFixture
	? Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const requestPath = new URL(request.url).pathname;
				providerRequests.push({ method: request.method, path: requestPath });
				if (reportsFixture && request.method === "POST" && requestPath === "/v1/messages") {
					const body = await request.text();
					if (body.includes("trigger synthetic failure"))
						return new Response("Synthetic BTW provider failure", { status: 503 });
					await Bun.sleep(1_000);
					return anthropicTextResponse(
						body.includes("<btw>")
							? "Synthetic side answer from the isolated conversation snapshot."
							: "Synthetic main conversation response.",
					);
				}
				if (reportsFixture && request.method === "GET" && requestPath === "/wham/usage") {
					// Keep the real loading surface available for an immediate viewport
					// snapshot; account fetches may be serialized by the credential store.
					if (++usageRequestNumber === 1) await Bun.sleep(1_000);
					return Response.json({
						plan_type: "synthetic",
						rate_limit: {
							allowed: true,
							limit_reached: false,
							primary_window: {
								used_percent: 37,
								limit_window_seconds: 18_000,
								reset_after_seconds: 1_800,
							},
							secondary_window: {
								used_percent: 84,
								limit_window_seconds: 604_800,
								reset_after_seconds: 86_400,
							},
						},
					});
				}
				if (request.method === "GET" && ["/models", "/v1/models", "/anthropic/v1/models"].includes(requestPath)) {
					if (routeFixture) await Bun.sleep(750);
					if (
						foundationFixture &&
						request.headers.get("authorization") === "Bearer xcsh-uat-foundation-litellm-key" &&
						foundationProbeDelaysRemaining-- > 0
					)
						await Bun.sleep(750);
					return Response.json({
						data: (routeFixture
							? ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]
							: foundationFixture
								? requestPath === "/anthropic/v1/models"
									? ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-5"]
									: ["gpt-5.6-sol", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-5"]
								: ["claude-sonnet-4-5"]
						).map(id => ({
							id,
							display_name: `Synthetic fixture ${id}`,
							type: "model",
							created_at: "2026-01-01T00:00:00Z",
						})),
						has_more: false,
					});
				}
				if (foundationFixture && request.method === "POST" && requestPath === "/v1/chat/completions")
					return new Response("synthetic validation rejection", { status: 400 });
				if (planFixture && request.method === "POST" && requestPath === "/v1/messages") {
					const body = await request.text();
					if (body.includes("Plan approved. You")) return anthropicExecutionResponse();
					if (body.includes("Request approval of the prepared synthetic plan")) return anthropicToolResponse();
					if (body.includes(typedPlanningPrompt)) {
						await Bun.sleep(750);
						return anthropicPlanningResponse();
					}
					return new Response("Unexpected plan fixture prompt", {
						status: 503,
					});
				}
				if (compactFixture && request.method === "POST" && requestPath === "/v1/messages") {
					await Bun.sleep(750);
					return anthropicPlanningResponse();
				}
				if (backgroundFixture && request.method === "POST" && requestPath === "/v1/messages") {
					await Bun.sleep(4_000);
					return anthropicPlanningResponse();
				}
				if (sessionsFixture && request.method === "POST" && requestPath === "/v1/messages") {
					await Bun.sleep(750);
					return anthropicPlanningResponse();
				}
				if (exitFixture && request.method === "POST" && requestPath === "/v1/messages") {
					// PNG generation may cold-start the host font stack while the active
					// viewport is captured. Keep the disposable request outstanding long
					// enough for every capture host; confirmation aborts it immediately.
					await exitProviderGate.promise;
					return anthropicPlanningResponse();
				}
				return new Response("Unexpected provider request in queue-only fixture", { status: 503 });
			},
		})
	: undefined;
// The foundation fixture exercises LiteLLM persistence. Startup configuration
// health checks intentionally treat a configured environment endpoint as
// authoritative, so bind that endpoint to this disposable server as well.
// Otherwise a host-provided endpoint can rewrite the freshly saved loopback
// models.yml before the model browser opens, turning a fixture test into an
// external-network probe.
if (foundationFixture && localProvider) {
	profile.env.LITELLM_BASE_URL = localProvider.url.toString();
	profile.env.LITELLM_API_KEY = "xcsh-uat-foundation-litellm-key";
}
if (localProvider)
	await Bun.write(
		join(profile.agentDir, "models.yml"),
		JSON.stringify({
			providers: {
				anthropic: {
					baseUrl: localProvider.url.toString(),
					apiKey: "xcsh-uat-synthetic-not-a-secret",
				},
				...(reportsFixture ? { "openai-codex": { baseUrl: localProvider.url.toString() } } : {}),
			},
		}),
	);
if (reportsFixture) {
	const agentDb = getAgentDbPath(profile.agentDir);
	await mkdir(resolve(agentDb, ".."), { recursive: true });
	const auth = await AuthStorage.create(agentDb);
	try {
		await auth.set(
			"openai-codex",
			Array.from({ length: 6 }, (_, index) => ({
				type: "oauth" as const,
				access: `synthetic-access-${index + 1}`,
				refresh: `synthetic-refresh-${index + 1}`,
				expires: Date.now() + 3_600_000,
				accountId: String(index + 1),
				email: `account-${index + 1}@example.com`,
			})),
		);
	} finally {
		auth.close();
	}
}
if (foundationFixture) {
	const agentDb = getAgentDbPath(profile.agentDir);
	await mkdir(resolve(agentDb, ".."), { recursive: true });
	const auth = await AuthStorage.create(agentDb);
	try {
		await auth.set("anthropic", { type: "api_key", key: "xcsh-uat-synthetic-stored-key" });
	} finally {
		auth.close();
	}
}
const clipboardSentinel = "xcsh-uat-synthetic-clipboard-sentinel";
const readClipboard = () => {
	if (!copyFixture) throw new Error("Clipboard read requested outside copy fixture");
	const result = Bun.spawnSync(["xclip", "-selection", "clipboard", "-out"], {
		env: profile.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(`Isolated clipboard read failed: ${result.stderr.toString().trim() || result.exitCode}`);
	return result.stdout.toString();
};
const writeClipboard = async (text: string) => {
	if (!copyFixture) throw new Error("Clipboard write requested outside copy fixture");
	const child = Bun.spawn(["xclip", "-selection", "clipboard", "-in", "-loops", "0"], {
		env: profile.env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	child.stdin.write(text);
	child.stdin.end();
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(
			`Isolated clipboard seed failed: ${(await new Response(child.stderr).text()).trim() || exitCode}`,
		);
};
if (copyFixture) {
	await writeClipboard(clipboardSentinel);
	if (readClipboard() !== clipboardSentinel) throw new Error("Could not establish isolated clipboard sentinel");
}
const terminal = createCaptureTerminal(variant.columns, variant.rows);
const pty = new PtySession();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const xcshCommand = [
	"env",
	"-i",
	...Object.entries(profile.env).map(([key, value]) => `${key}=${value}`),
	...profile.args,
]
	.map(quote)
	.join(" ");
const shellFixture = backgroundFixture || exitFixture;
const candidateLauncher = join(profile.root, "run-candidate");
const candidateExitStatus = join(profile.root, "candidate-exit-status");
if (shellFixture) {
	await Bun.write(candidateLauncher, `#!/bin/sh\nexec ${xcshCommand}\n`);
	await chmod(candidateLauncher, 0o700);
}
const command = shellFixture
	? [
			"env",
			"-i",
			`HOME=${profile.root}`,
			`PATH=${profile.env.PATH}`,
			`TERM=${profile.env.TERM}`,
			"PS1=xcsh-UAT-SHELL> ",
			"zsh",
			"-f",
		]
			.map(quote)
			.join(" ")
	: xcshCommand;
const actions: string[] = [];
let stream = "",
	ended = false,
	error: Error | null = null;
let writes = Promise.resolve();
terminal.onData(data => {
	if (!ended) pty.write(data);
});
const done = pty
	.start(
		{
			command,
			cwd: profile.cwd,
			cols: variant.columns,
			rows: variant.rows,
			timeoutMs: 90_000,
		},
		(failure, chunk) => {
			if (failure) error = failure;
			stream += chunk ?? "";
			writes = writes.then(() => new Promise<void>(resolve => terminal.write(chunk ?? "", resolve)));
		},
	)
	.then(result => {
		ended = true;
		return result;
	});
const screen = () =>
	Array.from(
		{ length: terminal.rows },
		(_, row) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "",
	).join("\n");
const wait = async (predicate: () => boolean | Promise<boolean>, label: string) => {
	const deadline = performance.now() + 30_000;
	while (performance.now() < deadline) {
		await writes;
		if (error) throw error;
		if (await predicate()) return;
		if (ended) throw new Error(`Candidate exited before ${label}`);
		await Bun.sleep(25);
	}
	throw new Error(`Timed out waiting for ${label}`);
};
const send = (input: string, label: string) => {
	actions.push(label);
	pty.write(input);
};
const capture = async (name: string, persistenceProof = false, stableMilliseconds = 150) => {
	if (ended) await writes;
	else {
		let previous = "",
			stableSince = performance.now();
		await wait(() => {
			const current = screen();
			if (current !== previous) {
				previous = current;
				stableSince = performance.now();
			}
			return performance.now() - stableSince >= stableMilliseconds;
		}, `stable ${name} viewport`);
	}
	await writeTerminalCapture(
		output,
		name,
		terminalViewportAnsi(terminal),
		{ columns: variant.columns, rows: variant.rows },
		variant.theme === "dark"
			? { foreground: "#d8dee9", background: "#1f2430" }
			: { foreground: "#2e3440", background: "#f7f7f5" },
		{
			kind: "actual-terminal-viewport",
			fixture: browserFixture
				? "disposable-browser-chrome-v1"
				: publicationFixture
					? "disposable-publication-launcher-v1"
					: connectionsFixture
						? "disposable-connections-v1"
						: resourcesFixture
							? "disposable-resources-artifacts-v1"
							: sessionsFixture
								? "disposable-sessions-v1"
								: pluginFixture
									? "disposable-plugin-lifecycle-v1"
									: inventoriesFixture
										? "disposable-settings-inventories-v1"
										: foundationFixture
											? "disposable-foundation-login-model-v1"
											: reportsFixture
												? "disposable-reports-v1"
												: exportFixture
													? "disposable-export-v1"
													: copyFixture
														? "disposable-copy-clipboard-v1"
														: planFixture
															? "disposable-plan-mode-v2"
															: compactFixture
																? "disposable-manual-compaction-v1"
																: reloadPluginsFixture
																	? "disposable-plugin-metadata-refresh-v1"
																	: backgroundFixture
																		? "disposable-background-transfer-v1"
																		: exitFixture
																			? "disposable-reviewed-exit-v1"
																			: routeFixture
																				? "disposable-route-mode-v1"
																				: forceFixture
																					? "disposable-force-read-v1"
																					: memoryFixture
																						? "disposable-memory-actions-v1"
																						: "disposable-memory-fast-v1",
			theme: `xcsh-${variant.theme}`,
			symbols: variant.symbols,
			emulatorUnicodeVersion: terminal.unicode.activeVersion,
			actions: [...actions],
			revision: revision.stdout.toString().trim(),
			fingerprint,
			fingerprintScope: "tracked diff plus coding-agent/TUI/terminal script sources",
			expected: "actual candidate viewport at reached scenario state",
			observed: screen(),
			cursor: "hardware cursor not composited",
			persistenceProof,
			persistenceReceipt: persistenceProof ? "../walkthrough.json" : undefined,
		},
	);
};
let persistence: unknown;
let outcome: { status: "passed" | "failed"; error?: string } = {
	status: "failed",
	error: "Walkthrough did not finish",
};
try {
	if (shellFixture) {
		await wait(() => screen().includes("xcsh-UAT-SHELL>"), "isolated job-control shell");
		if (backgroundFixture) {
			send("stty -tostop\r", "Use the standard shell policy that permits background status output");
			await Bun.sleep(100);
		}
		send(
			exitFixture
				? `${quote(candidateLauncher)}; rc="$?"; printf '\\nXCSH-UAT-EXIT=%s\\n' "$rc"; printf '%s\\n' "$rc" > ${quote(candidateExitStatus)}\r`
				: `${quote(candidateLauncher)}\r`,
			"Launch the actual candidate under an isolated interactive job-control shell",
		);
	}
	if (!usesProviderFixture) {
		await wait(
			() => screen().includes("Connect a provider") && stream.includes("\x1b[?2004h"),
			"provider onboarding",
		);
		await capture("provider-onboarding");
		send("\x1b[6~", "PageDown provider catalog");
		await wait(() => screen().includes("Search providers (11/"), "next provider page");
		await capture("provider-paged");
		send("\x1b[5~", "PageUp restores first provider");
		await wait(() => screen().includes("Search providers (1/"), "first provider page");
		send("\x1b[200~xcsh-uat-no-such-provider\x1b[201~", "Bracketed paste into provider search");
		await wait(() => screen().includes("No matching providers") && screen().includes("(0/0)"), "empty search result");
		await capture("provider-no-match");
		send("\x1b", "First Escape clears provider search without closing");
		await wait(
			() => screen().includes("Connect a provider") && screen().includes("Search providers (1/"),
			"cleared search",
		);
		send("\x1b", "Escape onboarding without authentication");
		await wait(() => !screen().includes("Connect a provider"), "editor");
	} else {
		await wait(
			() =>
				// At 60 columns both the full cwd and the idle status are deliberately
				// elided from the status line. Bracketed-paste mode is enabled by the
				// interactive editor itself, so it remains a viewport-independent
				// readiness signal for every isolated provider fixture.
				stream.includes("\x1b[?2004h") &&
				((publicationFixture
					? screen().includes(exportMessage)
					: connectionsFixture
						? screen().includes("127:default")
						: resourcesFixture
							? screen().includes("127:demo")
							: reportsFixture
								? screen().includes("Synthetic media frame one")
								: screen().includes("idle")) ||
					screen().includes(profile.cwd) ||
					// A constrained status line may omit both values while the editor is
					// fully interactive. The application header is retained at every
					// supported viewport and, together with bracketed-paste mode above,
					// proves that the candidate editor rather than a launcher shell owns
					// the terminal.
					screen().includes("xcsh v")) &&
				!screen().includes("Connect a provider"),
			"isolated fixture editor",
		);
		await capture(
			browserFixture
				? "browser-editor"
				: publicationFixture
					? "publication-editor"
					: connectionsFixture
						? "connections-editor"
						: resourcesFixture
							? "resources-editor"
							: sessionsFixture
								? "sessions-editor"
								: pluginFixture
									? "plugin-editor"
									: inventoriesFixture
										? "inventories-editor"
										: exportFixture
											? "export-editor"
											: copyFixture
												? "copy-editor"
												: planFixture
													? "plan-editor"
													: compactFixture
														? "compact-editor"
														: reloadPluginsFixture
															? "reload-plugins-editor"
															: backgroundFixture
																? "background-editor"
																: exitFixture
																	? "exit-editor"
																	: reportsFixture
																		? "reports-editor"
																		: foundationFixture
																			? "foundation-editor"
																			: routeFixture
																				? "route-editor"
																				: "force-editor",
		);
	}
	if (connectionsFixture) {
		const primaryPath = join(connectionContextRoot, "contexts", "primary.json");
		const secondaryPath = join(connectionContextRoot, "contexts", "secondary.json");
		const globalActivePath = join(connectionContextRoot, "active_context");
		const localPointerPath = join(connectionProjectConfigRoot, "contexts", "primary.json");
		const primaryBytes = await Bun.file(primaryPath).text();
		const secondaryBytes = await Bun.file(secondaryPath).text();
		const globalActiveBytes = await Bun.file(globalActivePath).text();
		const localPointerBytes = await Bun.file(localPointerPath).text();
		const localActiveBytes = await Bun.file(connectionLocalActivePath).text();
		const mcpFixturePath = resolve(import.meta.dir, "../test/fixtures/terminal-uat-mcp-server.mjs");

		send("/context list\r", "Inspect isolated saved contexts and active runtime state");
		await wait(
			() => screen().includes("F5 XC contexts") && screen().includes("primary") && screen().includes("secondary"),
			"context list",
		);
		await capture("context-list", true);
		send("\x1b", "Close the context report");
		await wait(() => !screen().includes("F5 XC contexts"), "closed context list");

		send("/context validate primary\r", "Validate credentials against the disposable loopback tenant");
		await wait(
			() => screen().includes("primary (validation only)") && screen().toLowerCase().includes("connected"),
			"context validation report",
		);
		await capture("context-validation", true);
		send("\x1b", "Close context validation without changing saved credentials");
		await wait(() => !screen().includes("primary (validation only)"), "closed context validation");

		send("/context activate secondary\r", "Review runtime context activation");
		await wait(() => screen().includes("Review context change"), "context activation review");
		await capture("context-activation-review", true);
		send("\r", "Cancel activation from the initially selected action");
		await wait(() => !screen().includes("Review context change"), "cancelled context activation");
		if ((await Bun.file(globalActivePath).text()) !== globalActiveBytes)
			throw new Error("Cancelled context activation changed startup selection");
		send("/context activate secondary\r", "Reopen context activation review");
		await wait(() => screen().includes("Review context change"), "second context activation review");
		send("\x1b[B\r", "Confirm runtime-only context activation");
		await wait(() => screen().includes("secondary") && screen().includes("XCSH_API_URL"), "activated context status");
		await capture("context-activated", true);
		if ((await Bun.file(globalActivePath).text()) !== globalActiveBytes)
			throw new Error("Runtime context activation changed startup selection");

		send("/context unlink\r", "Review removal of project-local context pointers");
		await wait(
			() => screen().includes("Review context change") && screen().includes("Local active context"),
			"unlink review",
		);
		await capture("context-unlink-review", true);
		send("\r", "Cancel unlink first");
		await wait(() => !screen().includes("Review context change"), "cancelled context unlink");
		if (
			(await Bun.file(connectionLocalActivePath).text()) !== localActiveBytes ||
			(await Bun.file(localPointerPath).text()) !== localPointerBytes
		)
			throw new Error("Cancelled context unlink changed project-local pointers");
		send("/context unlink\r", "Review project-local context unlink again");
		await wait(
			() => screen().includes("Review context change") && screen().includes("Local active context"),
			"second unlink review",
		);
		send("\x1b[B\r", "Confirm exact project-local context unlink");
		await wait(() => screen().includes("Unlinked local context"), "context unlinked");
		if ((await Bun.file(connectionLocalActivePath).exists()) || (await Bun.file(localPointerPath).exists()))
			throw new Error("Confirmed context unlink retained project-local pointers");

		send("/mcp list\r", "Inspect isolated MCP saved configuration and runtime state");
		await wait(() => screen().includes("Configured MCP servers") && screen().includes("synthetic-mcp"), "MCP list");
		await capture("mcp-list", true);
		send("\x1b", "Close MCP list");
		await wait(() => !screen().includes("Configured MCP servers"), "closed MCP list");

		send("/mcp test synthetic-mcp\r", "Test connectivity without changing saved MCP configuration");
		await wait(() => screen().includes('Testing MCP connection "synthetic-mcp"'), "MCP test loader");
		await capture("mcp-test-loading", true, 0);
		await wait(
			() => screen().includes("MCP connection: synthetic-mcp") && screen().includes("Successfully connected"),
			"MCP test report",
		);
		await capture("mcp-test-success", true);
		send("\x1b", "Close MCP connectivity report");
		await wait(() => !screen().includes("MCP connection: synthetic-mcp"), "closed MCP test report");

		const addMcp = `/mcp add candidate --scope project -- ${process.execPath} ${mcpFixturePath}\r`;
		send(addMcp, "Review a second disposable MCP server addition");
		await wait(() => screen().includes("Review MCP server addition"), "MCP add review");
		await capture("mcp-add-review", true);
		send("\r", "Cancel MCP addition first");
		await wait(() => !screen().includes("Review MCP server addition"), "cancelled MCP add");
		send(addMcp, "Reopen the same MCP server addition review");
		await wait(() => screen().includes("Review MCP server addition"), "second MCP add review");
		send("\x1b[B\r", "Confirm the exact MCP configuration write");
		await wait(() => screen().includes('Saved MCP server "candidate"'), "saved MCP server");
		await capture("mcp-add-saved", true);

		send("/mcp remove synthetic-mcp --scope project\r", "Open an MCP removal review for stale-target testing");
		await wait(() => screen().includes("Review MCP server removal"), "MCP remove review");
		const changedMcp = JSON.parse(await Bun.file(connectionMcpPath).text()) as {
			mcpServers: Record<string, Record<string, unknown>>;
		};
		changedMcp.mcpServers["synthetic-mcp"].timeout = 6_000;
		await Bun.write(connectionMcpPath, `${JSON.stringify(changedMcp, null, 2)}\n`);
		send("\x1b[B\r", "Reject the stale MCP proposal at execution time");
		await wait(() => screen().includes("proposal changed"), "renewed MCP removal review");
		await capture("mcp-remove-stale", true);
		send("\r", "Close the renewed MCP removal without deleting the changed target");
		await wait(() => !screen().includes("MCP server removal"), "closed stale MCP removal");
		send("/mcp remove candidate --scope project\r", "Review removal of the saved MCP candidate");
		await wait(() => screen().includes("Review MCP server removal"), "candidate MCP remove review");
		send("\x1b[B\r", "Confirm MCP candidate removal");
		await wait(() => screen().includes('Removed MCP server "candidate"'), "removed MCP candidate");

		send("/ssh list\r", "Inspect isolated SSH configuration and loopback target");
		await wait(() => screen().includes("SSH Hosts") && screen().includes("loopback"), "SSH list");
		await capture("ssh-list", true);
		send("\x1b", "Close SSH list");
		await wait(() => !screen().includes("SSH Hosts"), "closed SSH list");

		const addSsh = `/ssh add candidate --host 127.0.0.1 --user disposable --port ${connectionService!.port} --scope project\r`;
		send(addSsh, "Review an SSH host save separately from connectivity");
		await wait(() => screen().includes("Review SSH host addition"), "SSH add review");
		await capture("ssh-add-review", true);
		send("\r", "Cancel SSH host save first");
		await wait(() => !screen().includes("Review SSH host addition"), "cancelled SSH add");
		send(addSsh, "Reopen the exact SSH host review");
		await wait(() => screen().includes("Review SSH host addition"), "second SSH add review");
		send("\x1b[B\r", "Confirm SSH configuration save only");
		await wait(() => screen().includes('Saved SSH host "candidate"'), "saved SSH candidate");
		await capture("ssh-add-saved", true);

		send("/ssh remove candidate --scope project\r", "Open SSH removal review for stale-target testing");
		await wait(() => screen().includes("Review SSH host removal"), "SSH remove review");
		const changedSsh = JSON.parse(await Bun.file(connectionSshPath).text()) as {
			hosts: Record<string, Record<string, unknown>>;
		};
		changedSsh.hosts.candidate.username = "replacement-user";
		await Bun.write(connectionSshPath, `${JSON.stringify(changedSsh, null, 2)}\n`);
		send("\x1b[B\r", "Reject the stale SSH removal proposal at execution time");
		await wait(() => screen().includes("proposal changed"), "renewed SSH removal review");
		await capture("ssh-remove-stale", true);
		send("\r", "Close renewed SSH removal without deleting the replacement");
		await wait(() => !screen().includes("SSH host removal"), "closed stale SSH removal");
		send("/ssh remove candidate --scope project\r", "Review the replacement SSH host removal");
		await wait(() => screen().includes("Review SSH host removal"), "replacement SSH remove review");
		send("\x1b[B\r", "Confirm removal of the currently reviewed SSH host");
		await wait(() => screen().includes('Removed SSH host "candidate"'), "removed SSH candidate");

		const reopenedMcp = JSON.parse(await Bun.file(connectionMcpPath).text()) as {
			mcpServers: Record<string, Record<string, unknown>>;
		};
		const reopenedSsh = JSON.parse(await Bun.file(connectionSshPath).text()) as {
			hosts: Record<string, Record<string, unknown>>;
		};
		if (
			(await Bun.file(primaryPath).text()) !== primaryBytes ||
			(await Bun.file(secondaryPath).text()) !== secondaryBytes
		)
			throw new Error("Context lifecycle changed saved credential files");
		if (reopenedMcp.mcpServers.candidate || reopenedMcp.mcpServers["synthetic-mcp"]?.timeout !== 6_000)
			throw new Error("MCP configuration failed independent reopen verification");
		if (reopenedSsh.hosts.candidate || !reopenedSsh.hosts.loopback)
			throw new Error("SSH configuration failed independent reopen verification");
		persistence = {
			contextValidationAuthorized: connectionRequests.some(
				request => request.path === "/api/web/namespaces" && request.authorized,
			),
			contextCredentialBytesUnchanged: true,
			startupSelectionUnchanged: (await Bun.file(globalActivePath).text()) === globalActiveBytes,
			cancelledUnlinkBytesUnchanged: true,
			confirmedUnlinkRemovedOnlyLocalPointers: true,
			mcpConnectivityTestUsedDisposableProcess: true,
			mcpStaleTargetPreservedAndCandidateRemoved: true,
			sshSaveDisclosedNoConnectivityTest: true,
			sshStaleTargetPreservedAndCandidateRemoved: true,
			independentReopenVerified: true,
		};
	} else if (resourcesFixture) {
		const postCount = () => resourceRequests.filter(request => request.method === "POST").length;
		const putCount = () => resourceRequests.filter(request => request.method === "PUT").length;
		const deleteCount = () => resourceRequests.filter(request => request.method === "DELETE").length;
		const originalContextBytes = await Bun.file(
			join(profile.env.XDG_CONFIG_HOME, "xcsh", "contexts", "synthetic-resource.json"),
		).text();

		send("/get", "Open slash-command discovery for built-in /get");
		await wait(
			() => screen().includes("/get") && screen().includes("Execution") && screen().includes("shadows"),
			"command provenance and shadowing",
		);
		await capture("command-discovery-shadowing", true);
		send("\x03", "Ctrl+C clears the idle command draft without acting as Back");
		await wait(() => !screen().includes("shadowed"), "cleared command discovery");

		send("/synthetic-expand", "Open project prompt-expansion discovery metadata");
		await wait(
			() => screen().includes("Prompt expansion") && screen().includes("project scope"),
			"project prompt expansion provenance",
		);
		await capture("command-discovery-prompt-expansion", true);
		send("\x15", "Ctrl+U clears the prompt-expansion draft");
		await wait(
			() => terminal.buffer.active.cursorX <= 4,
			"cursor returned to the start after clearing prompt-expansion draft",
		);

		// The isolated context fixture uses an explicit namespace so this list covers
		// the command's documented namespace argument independently of settings
		// hydration timing during application startup.
		send("/get http_loadbalancer -n demo\r", "List the initially empty remote resource collection");
		await wait(() => screen().includes("http_loadbalancer resources"), "empty resource list");
		await capture("get-empty", true);
		send("\x1b", "Close empty resource report");
		await wait(() => !screen().includes("http_loadbalancer resources"), "closed empty resource report");

		send(`/create -f ${resourceManifestPath}\r`, "Open exact remote create review");
		await wait(() => screen().includes("Review resource create"), "resource create review");
		await capture("create-review-cancel", true);
		if (postCount() !== 0 || resourceObjects.size !== 0) throw new Error("Resource changed before create review");
		send("\r", "Cancel remote create first");
		await wait(() => !screen().includes("Review resource create"), "cancelled resource create");
		if (postCount() !== 0 || resourceObjects.size !== 0) throw new Error("Cancelled create changed remote state");

		send(`/create -f ${resourceManifestPath}\r`, "Reopen exact remote create review");
		await wait(() => screen().includes("Review resource create"), "second resource create review");
		send("\x1b[B\r", "Confirm reviewed remote create");
		await wait(() => screen().includes("Applying resource create"), "resource create progress");
		await capture("create-progress", false, 0);
		await wait(() => screen().includes("Resource create complete"), "resource create result");
		await capture("create-success", true);
		if (postCount() !== 1 || !resourceObjects.has("reviewed-lb"))
			throw new Error("Confirmed create did not produce exactly one remote object");
		send("\x1b", "Close create result");
		await wait(() => !screen().includes("Resource create complete"), "closed create result");

		send("/get http_loadbalancer reviewed-lb -n demo\r", "Get the exact created resource");
		await wait(() => screen().includes("http_loadbalancer/reviewed-lb"), "resource details");
		await capture("get-detail", true);
		send("\x1b", "Close resource details");
		await wait(() => !screen().includes("http_loadbalancer/reviewed-lb"), "closed resource details");

		send(`/diff -f ${resourceManifestPath}\r`, "Compare the matching manifest without mutation");
		await wait(() => screen().includes("Resource differences"), "resource identical diff");
		await capture("diff-identical", true);
		send("\x1b", "Close resource diff");
		await wait(() => !screen().includes("Resource differences"), "closed resource diff");

		await Bun.write(
			resourceManifestPath,
			"kind: http_loadbalancer\nmetadata:\n  name: reviewed-lb\n  namespace: demo\nspec:\n  domains:\n    - changed.example.test\n  routes: []\n  origin_pools: []\n",
		);
		send(`/apply -f ${resourceManifestPath} --dry-run=client\r`, "Preview changed manifest with client dry run");
		await wait(() => screen().includes("Resource apply dry run"), "resource apply dry run");
		await capture("apply-dry-run", true);
		if (putCount() !== 0) throw new Error("Dry-run apply mutated remote state");
		send("\x1b", "Close apply dry-run report");
		await wait(() => !screen().includes("Resource apply dry run"), "closed apply dry-run report");

		send(`/apply -f ${resourceManifestPath}\r`, "Open exact remote update review");
		await wait(() => screen().includes("Review resource apply"), "resource apply review");
		await capture("apply-review", true);
		send("\r", "Cancel remote update first");
		await wait(() => !screen().includes("Review resource apply"), "cancelled resource apply");
		if (putCount() !== 0) throw new Error("Cancelled apply mutated remote state");
		send(`/apply -f ${resourceManifestPath}\r`, "Reopen exact remote update review");
		await wait(() => screen().includes("Review resource apply"), "second resource apply review");
		send("\x1b[B\r", "Confirm reviewed remote update");
		await wait(() => screen().includes("Applying resource apply"), "resource apply progress");
		await capture("apply-progress", false, 0);
		await wait(() => screen().includes("Resource apply complete"), "resource apply result");
		await capture("apply-success", true);
		if (putCount() !== 1) throw new Error("Confirmed apply did not perform exactly one PUT");
		send("\x1b", "Close apply result");
		await wait(() => !screen().includes("Resource apply complete"), "closed apply result");

		send(
			`/manifest http_loadbalancer reviewed-lb -n demo -o yaml -f ${resourceManifestOutput}\r`,
			"Open exact local manifest-write review",
		);
		await wait(() => screen().includes("Review manifest file export"), "manifest export review");
		await capture("manifest-review-cancel", true);
		if (await Bun.file(resourceManifestOutput).exists()) throw new Error("Manifest file written before review");
		send("\r", "Cancel local manifest write first");
		await wait(() => !screen().includes("Review manifest file export"), "cancelled manifest export");
		if (await Bun.file(resourceManifestOutput).exists()) throw new Error("Cancelled manifest export wrote a file");
		send(
			`/manifest http_loadbalancer reviewed-lb -n demo -o yaml -f ${resourceManifestOutput}\r`,
			"Reopen local manifest-write review",
		);
		await wait(() => screen().includes("Review manifest file export"), "second manifest export review");
		send("\x1b[B\r", "Confirm reviewed local manifest write");
		await wait(() => screen().includes("Manifest export complete"), "manifest export result");
		await capture("manifest-success", true);
		const exportedManifest = await Bun.file(resourceManifestOutput).text();
		if (!exportedManifest.includes("changed.example.test"))
			throw new Error("Manifest export did not persist observed remote state");
		send("\x1b", "Close manifest result");
		await wait(() => !screen().includes("Manifest export complete"), "closed manifest result");

		send("/describe http_loadbalancer reviewed-lb -n demo\r", "Describe exact updated remote resource");
		await wait(
			() => screen().includes("Resolved remote resource") && screen().includes("changed.example.test"),
			"describe result",
		);
		await capture("describe-detail", true);
		send("\x1b", "Close describe result");
		await wait(() => !screen().includes("Resolved remote resource"), "closed describe result");

		send("/delete http_loadbalancer reviewed-lb -n demo\r", "Open exact destructive remote review");
		await wait(() => screen().includes("Review resource delete"), "resource delete review");
		await capture("delete-review-cancel", true);
		send("\r", "Cancel remote deletion first");
		await wait(() => !screen().includes("Review resource delete"), "cancelled resource deletion");
		if (deleteCount() !== 0 || !resourceObjects.has("reviewed-lb"))
			throw new Error("Cancelled delete changed remote state");
		failNextResourceMutation = true;
		send(
			"/delete http_loadbalancer reviewed-lb -n demo\r",
			"Reopen remote delete review with injected backing failure",
		);
		await wait(() => screen().includes("Review resource delete"), "second resource delete review");
		send("\x1b[B\r", "Confirm reviewed delete whose first backing attempt fails");
		await wait(() => screen().includes("Unresolved resource delete"), "resource delete unresolved result");
		await capture("delete-failure", true);
		if (deleteCount() !== 1 || !resourceObjects.has("reviewed-lb"))
			throw new Error("Failed delete did not preserve remote state");
		send("\x1b[B\r", "Retry only the unresolved reviewed delete");
		await wait(() => screen().includes("Applying resource delete"), "resource delete retry progress");
		await capture("delete-retry-progress", false, 0);
		await wait(() => screen().includes("Resource delete complete"), "resource delete result");
		await capture("delete-success", true);
		if (deleteCount() !== 2 || resourceObjects.has("reviewed-lb"))
			throw new Error("Delete retry did not resolve exactly the remaining remote object");
		send("\x1b", "Close delete result");
		await wait(() => !screen().includes("Resource delete complete"), "closed delete result");

		failResourceReads = true;
		send("/get http_loadbalancer reviewed-lb -n demo\r", "Exercise unavailable remote-resource feedback");
		await wait(
			() => screen().includes("synthetic resource service") && screen().includes("unavailable"),
			"resource unavailable result",
		);
		await capture("get-unavailable", true);
		failResourceReads = false;

		const currentContextBytes = await Bun.file(
			join(profile.env.XDG_CONFIG_HOME, "xcsh", "contexts", "synthetic-resource.json"),
		).text();
		persistence = {
			requests: resourceRequests,
			remoteObjectCount: resourceObjects.size,
			manifestOutput: resourceManifestOutput,
			manifestOutputHash: createHash("sha256").update(exportedManifest).digest("hex"),
			contextBytesUnchanged: currentContextBytes === originalContextBytes,
			cancelledCreateMadeNoPost: postCount() === 1,
			dryRunMadeNoPut: putCount() === 1,
			failedDeletePreservedThenRetryRemoved: deleteCount() === 2 && resourceObjects.size === 0,
		};
	} else if (sessionsFixture) {
		if (!sessionFixture) throw new Error("Session fixture was not initialized");
		const allSessionFiles = () => [...new Bun.Glob("**/*.jsonl").scanSync({ cwd: profile.root })].sort();
		const sessionHeader = async (relative: string) => {
			const first = (await Bun.file(join(profile.root, relative)).text()).split("\n").find(Boolean);
			return JSON.parse(first ?? "{}") as { id?: string; cwd?: string; parentSession?: string; title?: string };
		};
		const findSessionFile = async (id: string) => {
			for (const relative of allSessionFiles()) if ((await sessionHeader(relative)).id === id) return relative;
			return undefined;
		};
		const activeOriginalBytes = await Bun.file(sessionFixture.activeFile).text();

		send("/session\r", "Show the current session report without changing state");
		await wait(() => stream.includes("Session Info") && stream.includes(sessionFixture.activeId), "session report");
		await capture("session-report", true);

		send("/tree\r", "Open the shared hierarchical session-tree browser");
		await wait(() => screen().includes("Session tree") && screen().includes("Inspect an exact node"), "tree browser");
		await capture("tree-browse", true);
		send("\x03", "Ctrl+C remains execution control and does not close tree navigation");
		await Bun.sleep(100);
		if (!screen().includes("Session tree")) throw new Error("Ctrl+C closed the session tree");
		send("\x1b[200~primary branch request\x1b[201~", "Paste editable search for an identity-qualified tree node");
		await wait(() => screen().includes("Synthetic primary branch request"), "tree search result");
		await capture("tree-search", true);
		send("\r", "Open exact tree-node details before navigation");
		await wait(
			() => screen().includes("Tree node details") && screen().includes("Navigate to this point"),
			"tree details",
		);
		await capture("tree-details", true);
		send("\r", "Choose the explicit tree navigation action");
		await wait(() => screen().includes("Navigation context"), "tree summary choice");
		await capture("tree-summary-choice", true);
		send("\x1b[B\r", "Choose branch-summary generation for the abandoned path");
		await wait(() => screen().includes("Review tree navigation"), "tree navigation review");
		await capture("tree-review", true);
		if ((await Bun.file(sessionFixture.activeFile).text()) !== activeOriginalBytes)
			throw new Error("Tree review mutated the session before confirmation");
		send("\r", "Cancel tree navigation from its initially selected action");
		await wait(() => screen().includes("Tree node details"), "tree review cancellation");
		if ((await Bun.file(sessionFixture.activeFile).text()) !== activeOriginalBytes)
			throw new Error("Cancelled tree navigation changed session bytes");
		send("\r", "Reopen tree navigation options for the retained exact node");
		await wait(() => screen().includes("Navigation context"), "second tree summary choice");
		send("\x1b[B\r", "Choose branch summary again");
		await wait(() => screen().includes("Review tree navigation"), "second tree navigation review");
		send("\x1b[B\r", "Confirm reviewed tree navigation");
		await wait(() => screen().includes("Applying tree navigation"), "tree navigation progress");
		await capture("tree-progress", false, 0);
		await wait(
			() => screen().includes(`Navigated to tree node ${sessionFixture.branchUserId}`),
			"tree navigation completion",
		);
		await capture("tree-success", true);
		const afterTree = await SessionManager.open(sessionFixture.activeFile);
		const summaryEntries = afterTree.getEntries().filter(entry => entry.type === "branch_summary");
		await afterTree.close();
		if (summaryEntries.length !== 1) throw new Error("Confirmed tree summary was not persisted exactly once");
		send("\x15", "Clear the intentionally prefilled branch-point editor draft before the next command");

		send("/rename Synthetic renamed session\r", "Review a typed session rename");
		await wait(() => screen().includes("Review session rename"), "session rename review");
		await capture("rename-review", true);
		send("\r", "Cancel rename first");
		await wait(() => !screen().includes("Review session rename"), "cancelled session rename");
		const beforeRename = await SessionManager.open(sessionFixture.activeFile);
		if (beforeRename.getSessionName() !== "Synthetic active tree")
			throw new Error("Cancelled rename changed saved name");
		await beforeRename.close();
		send("/rename Synthetic renamed session\r", "Reopen the exact rename review");
		await wait(() => screen().includes("Review session rename"), "second session rename review");
		send("\x1b[B\r", "Confirm reviewed session rename");
		await wait(() => screen().includes("Synthetic renamed session"), "session rename completion");
		await capture("rename-success", true);
		const renamedSession = await SessionManager.open(sessionFixture.activeFile);
		if (renamedSession.getSessionName() !== "Synthetic renamed session")
			throw new Error("Confirmed session rename did not survive reopen");
		await renamedSession.close();

		send(`/move ${sessionFixture.moveDirectory}\r`, "Review moving the session and artifacts to an exact directory");
		await wait(() => screen().includes("Review session move"), "session move review");
		await capture("move-review", true);
		send("\r", "Cancel session move first");
		await wait(() => !screen().includes("Review session move"), "cancelled session move");
		if (!(await Bun.file(sessionFixture.activeFile).exists()))
			throw new Error("Cancelled move removed the source session");
		send(`/move ${sessionFixture.moveDirectory}\r`, "Reopen exact session move review");
		await wait(() => screen().includes("Review session move"), "second session move review");
		send("\x1b[B\r", "Confirm reviewed session move");
		await wait(
			async () => screen().includes("Session moved to") && !(await Bun.file(sessionFixture.activeFile).exists()),
			"session move completion",
		);
		await capture("move-success", true);
		if (await Bun.file(sessionFixture.activeFile).exists()) throw new Error("Moved session remained at its old path");
		const movedRelative = await findSessionFile(sessionFixture.activeId);
		if (!movedRelative) throw new Error("Moved session could not be reopened by identity");
		const movedHeader = await sessionHeader(movedRelative);
		if (movedHeader.cwd !== sessionFixture.moveDirectory)
			throw new Error("Moved session header retained the old cwd");

		send("/fork\r", "Review an exact session fork including artifacts and parent linkage");
		await wait(() => screen().includes("Review session fork"), "session fork review");
		await capture("fork-review", true);
		send("\r", "Cancel session fork first");
		await wait(() => !screen().includes("Review session fork"), "cancelled session fork");
		if (allSessionFiles().length !== 2) throw new Error("Cancelled fork created another session file");
		send("/fork\r", "Reopen exact session fork review");
		await wait(() => screen().includes("Review session fork"), "second session fork review");
		send("\x1b[B\r", "Confirm reviewed session fork");
		await wait(() => screen().includes("Session forked to"), "session fork completion");
		await capture("fork-success", true);
		const afterForkFiles = allSessionFiles();
		if (afterForkFiles.length !== 3) throw new Error(`Expected one forked session, found ${afterForkFiles.length}`);
		const forkHeader = (await Promise.all(afterForkFiles.map(sessionHeader))).find(
			header => header.id !== sessionFixture.activeId && header.id !== sessionFixture.resumeId,
		);
		if (!forkHeader?.parentSession) throw new Error("Forked session did not persist parent linkage");

		send("/branch\r", "Open branch-point browser in the forked session");
		await wait(() => screen().includes("Branch from message"), "branch-point browser");
		await capture("branch-browse", true);
		send("primary branch request", "Search for a stable user-message branch identity");
		await wait(() => screen().includes("Synthetic primary branch request"), "branch search result");
		send("\r", "Open exact branch-point details");
		await wait(() => screen().includes("Branch point details"), "branch point details");
		await capture("branch-details", true);
		send("\r", "Open the explicit branch creation review");
		await wait(() => screen().includes("Review conversation branch"), "conversation branch review");
		await capture("branch-review", true);
		send("\r", "Cancel branch creation first");
		await wait(() => screen().includes("Branch point details"), "branch cancellation");
		if (allSessionFiles().length !== 3) throw new Error("Cancelled branch created another session file");
		send("\r", "Reopen conversation branch review");
		await wait(() => screen().includes("Review conversation branch"), "second conversation branch review");
		send("\x1b[B\r", "Confirm reviewed conversation branch");
		await wait(() => screen().includes("Branched to session"), "conversation branch completion");
		await capture("branch-success", true);
		if (allSessionFiles().length !== 4) throw new Error("Confirmed branch did not create exactly one session file");
		send("\x15", "Clear the branch selector's intentional editor prefill before handoff");

		const beforeHandoffFiles = allSessionFiles().length;
		const requestsBeforeHandoff = providerRequests.length;
		send("/handoff Focus on deterministic session acceptance\r", "Review token-consuming handoff generation");
		await wait(() => screen().includes("Review session handoff"), "session handoff review");
		await capture("handoff-review", true);
		send("\r", "Cancel handoff before model work");
		await wait(() => !screen().includes("Review session handoff"), "cancelled handoff review");
		if (providerRequests.length !== requestsBeforeHandoff || allSessionFiles().length !== beforeHandoffFiles)
			throw new Error("Cancelled handoff performed model work or created a session");
		send("/handoff Focus on deterministic session acceptance\r", "Reopen exact handoff review");
		await wait(() => screen().includes("Review session handoff"), "second handoff review");
		send("\x1b[B\r", "Confirm reviewed handoff generation");
		await wait(() => screen().includes("Applying session handoff"), "handoff progress");
		await capture("handoff-progress", false, 0);
		await wait(() => screen().includes("New session started with handoff context"), "handoff completion");
		await capture("handoff-success", true);
		if (allSessionFiles().length !== beforeHandoffFiles + 1)
			throw new Error("Handoff did not create exactly one session");
		const handoffSessions = await Promise.all(
			allSessionFiles().map(async relative => ({
				relative,
				manager: await SessionManager.open(join(profile.root, relative)),
			})),
		);
		const handoffSession = handoffSessions.find(item =>
			item.manager.getEntries().some(entry => entry.type === "custom_message" && entry.customType === "handoff"),
		);
		for (const item of handoffSessions) await item.manager.close();
		if (!handoffSession) throw new Error("Handoff context did not survive independent reopen");

		send("/resume\r", "Open the scoped/all session browser after handoff");
		await wait(() => screen().includes("Sessions") && screen().includes("Current"), "session resume browser");
		await capture("resume-browse", true);
		send("\t", "Switch to the stable All sessions scope");
		await wait(() => screen().includes("All saved session directories"), "all sessions scope");
		send(sessionFixture.resumeId, "Search by exact duplicate-safe session identity");
		await wait(() => screen().includes("Synthetic resume target"), "resume target result");
		await capture("resume-search", true);
		send("\r", "Open exact resume target details");
		await wait(
			() => screen().includes("Session details") && screen().includes(sessionFixture.resumeId),
			"resume details",
		);
		await capture("resume-details", true);
		send("\r", "Open explicit resume review");
		await wait(() => screen().includes("Review session resume"), "resume review");
		await capture("resume-review", true);
		send("\r", "Cancel resume first");
		await wait(() => screen().includes("Session details"), "resume cancellation");
		send("\r", "Reopen exact resume review");
		await wait(() => screen().includes("Review session resume"), "second resume review");
		send("\x1b[B\r", "Confirm reviewed session resume");
		await wait(() => screen().includes(`Resumed session ${sessionFixture.resumeId}`), "resume completion");
		await capture("resume-success", true);

		const beforeNewFiles = allSessionFiles().length;
		send("/new\r", "Review an exact new empty session destination");
		await wait(() => screen().includes("Review new session"), "new-session review");
		await capture("new-review", true);
		send("\r", "Cancel new session first");
		await wait(() => !screen().includes("Review new session"), "new-session cancellation");
		if (allSessionFiles().length !== beforeNewFiles) throw new Error("Cancelled /new created a session");
		send("/new\r", "Reopen exact new-session review");
		await wait(() => screen().includes("Review new session"), "second new-session review");
		send("\x1b[B\r", "Confirm reviewed new session");
		await wait(() => screen().includes("New session"), "new-session completion");
		await capture("new-success", true);
		if (allSessionFiles().length !== beforeNewFiles + 1)
			throw new Error("Confirmed /new did not create exactly one session");

		persistence = {
			activeSession: sessionFixture.activeId,
			resumeTarget: sessionFixture.resumeId,
			treeSummaryPersistedExactlyOnce: true,
			renameReopened: true,
			moveReopenedAtNewCwd: true,
			forkCreatedExactlyOneParentLinkedSession: true,
			branchCreatedExactlyOneSession: true,
			handoffCancelAvoidedModelWork: true,
			handoffContextReopened: true,
			resumeVerifiedIdentity: true,
			newCancelNoFile: true,
			newCreatedExactlyOneSession: true,
		};
	} else if (pluginFixture) {
		if (!pluginManager || !pluginManagerOptions) throw new Error("Plugin fixture manager was not initialized");
		const reopen = () => new MarketplaceManager(pluginManagerOptions!);
		const installed = async () => reopen().listInstalledPlugins();
		const registryPath = pluginManagerOptions.installedRegistryPath;
		const registryBytes = async () =>
			(await Bun.file(registryPath).exists()) ? await Bun.file(registryPath).text() : "<absent>";
		const setSourceVersion = async (version: string) => {
			const file = join(pluginSource, ".xcsh-plugin", "marketplace.json");
			const catalog = (await Bun.file(file).json()) as { plugins: Array<{ version?: string }> };
			catalog.plugins[0]!.version = version;
			await Bun.write(file, `${JSON.stringify(catalog, null, 2)}\n`);
		};
		const pageReview = async (prefix: string, finalText: string) => {
			let pages = 0;
			while (!screen().includes(finalText) && screen().includes("review details") && pages < 16) {
				const before = screen();
				send("\x1b[6~", `Page down through ${prefix} review details`);
				await wait(() => screen() !== before, `${prefix} review page ${pages + 2}`);
				await capture(`${prefix}-paged-${++pages}`, true);
			}
			if (!screen().includes(finalText)) throw new Error(`${prefix} did not expose ${finalText}`);
			for (let page = 0; page < pages; page++) {
				const before = screen();
				send("\x1b[5~", `Page up to restore ${prefix} review`);
				await wait(() => screen() !== before, `${prefix} previous review page`);
			}
		};

		send("/plugin\r", "Open the actual plugin manager against the disposable local marketplace");
		await wait(
			() => screen().includes("Plugin manager") && screen().includes("Discover (1)"),
			"loaded local plugin catalog",
		);
		await capture("plugin-empty-installed-before-lifecycle", true);
		send("\x03", "Ctrl+C remains execution control and does not close the plugin manager");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Plugin manager")) throw new Error("Ctrl+C acted as Back in the plugin manager");
		send("\t\t", "Switch through stable tabs to the Discover catalog");
		await wait(() => screen().includes("hello-plugin"), "discoverable local plugin");
		await capture("plugin-browse", true);
		send("\x1b[200~no such 工具\x1b[201~", "Bracketed-paste Unicode into editable plugin search");
		await wait(() => screen().includes("No plugins match"), "plugin no-match result");
		await capture("plugin-no-match");
		send("\x1b", "First Escape clears plugin search without closing the manager");
		await wait(
			() => screen().includes("hello-plugin") && !screen().includes("No plugins match"),
			"cleared plugin search",
		);
		send("hello", "Search the catalog by plugin identity");
		await wait(() => screen().includes("Search plugins (1/1)"), "filtered plugin catalog");
		await capture("plugin-search");
		send("\r", "Open plugin details without mutating it");
		await wait(
			() => screen().includes("Plugin details") && screen().includes("Review installation"),
			"plugin details",
		);
		await capture("plugin-details", true);
		if ((await installed()).length) throw new Error("Opening plugin details mutated installed state");
		send("\x1b", "Return to the retained filtered plugin list");
		await wait(
			() => screen().includes("Plugin manager") && screen().includes("Search plugins (1/1)"),
			"retained plugin search",
		);
		await capture("plugin-search-retained");
		send("\x1b", "Clear the retained search before closing");
		await wait(
			() =>
				screen().includes("Plugin manager") &&
				screen()
					.split("\n")
					.some(line => /^\s*[│|]\s*>\s*[│|]\s*$/.test(line)),
			"cleared retained search",
		);
		await capture("plugin-search-cleared");
		send("\x1b", "Close the plugin manager one level after search is clear");
		await wait(() => !screen().includes("Plugin manager"), "plugin editor return");

		const beforeInstall = await registryBytes();
		send("/plugin install hello-plugin@test-marketplace\r", "Resolve a typed install and open its shared review");
		await wait(() => screen().includes("Review plugin installation"), "typed plugin installation review");
		await capture("plugin-install-review", true);
		await pageReview("plugin-install-review", "required.");
		if ((await registryBytes()) !== beforeInstall || (await installed()).length)
			throw new Error("Plugin install mutated state before review confirmation");
		send("\r", "Cancel installation from the initially selected action");
		await wait(() => !screen().includes("Review plugin installation"), "cancelled plugin installation");
		if ((await registryBytes()) !== beforeInstall || (await installed()).length)
			throw new Error("Cancelled plugin install changed persistent state");

		send("/plugin install hello-plugin@test-marketplace\r", "Reopen the typed plugin installation review");
		await wait(() => screen().includes("Review plugin installation"), "second plugin installation review");
		send("\x1b[B\r", "Confirm the reviewed user-scoped installation");
		await wait(
			() => screen().includes("Installed hello-plugin from test-marketplace"),
			"plugin installation completion",
		);
		await capture("plugin-install-success", true);
		let state = await installed();
		if (state.length !== 1 || state[0]?.scope !== "user" || state[0].entries[0]?.version !== "1.0.0")
			throw new Error("Reopened registry did not retain the reviewed 1.0.0 user installation");

		const installedBytes = await registryBytes();
		send(
			"/plugin install --force hello-plugin@test-marketplace\r",
			"Open a force-reinstall review without treating --force as consent",
		);
		await wait(() => screen().includes("Review plugin installation"), "force reinstall review");
		await capture("plugin-force-reinstall-review", true);
		if (!screen().includes("Reinstalls") && !screen().includes("--force"))
			throw new Error("Force reinstall review did not explain force semantics");
		send("\r", "Cancel the force reinstall from the initially selected action");
		await wait(() => !screen().includes("Review plugin installation"), "cancelled force reinstall");
		if ((await registryBytes()) !== installedBytes) throw new Error("--force bypassed review or cancellation");

		send("/plugin disable hello-plugin@test-marketplace\r", "Review disabling the exact user-scoped plugin");
		await wait(() => screen().includes("Review plugin disable"), "plugin disable review");
		await capture("plugin-disable-review", true);
		if ((await installed())[0]?.entries[0]?.enabled === false) throw new Error("Plugin disabled before review");
		send("\r", "Cancel plugin disable first");
		await wait(() => !screen().includes("Review plugin disable"), "cancelled plugin disable");
		if ((await installed())[0]?.entries[0]?.enabled === false) throw new Error("Cancelled disable changed state");
		send("/plugin disable hello-plugin@test-marketplace\r", "Reopen plugin disable review");
		await wait(() => screen().includes("Review plugin disable"), "second plugin disable review");
		send("\x1b[B\r", "Confirm disabling the reviewed scoped plugin");
		await wait(() => screen().includes("Disabled hello-plugin@test-marketplace"), "plugin disable completion");
		await capture("plugin-disable-success", true);
		if ((await installed())[0]?.entries[0]?.enabled !== false) throw new Error("Disabled state did not persist");

		const disabledBytes = await registryBytes();
		send("/plugin disable hello-plugin@test-marketplace\r", "Exercise exact disable no-op without another write");
		await wait(
			() => screen().includes("Nothing changed") && screen().includes("already disabled"),
			"plugin disable no-op",
		);
		await capture("plugin-disable-noop", true);
		if ((await registryBytes()) !== disabledBytes) throw new Error("Disable no-op changed registry bytes");

		await setSourceVersion("2.0.0");
		send("/plugin upgrade hello-plugin@test-marketplace\r", "Resolve the newly published catalog version for review");
		await wait(
			() => screen().includes("Review plugin upgrade") && screen().includes("1.0.0") && screen().includes("2.0.0"),
			"plugin upgrade review",
		);
		await capture("plugin-upgrade-review", true);
		if ((await installed())[0]?.entries[0]?.version !== "1.0.0") throw new Error("Plugin upgraded before review");
		send("\x1b[B\r", "Confirm the reviewed 1.0.0 to 2.0.0 plugin upgrade");
		await wait(
			() => screen().includes("Upgraded hello-plugin@test-marketplace to 2.0.0"),
			"plugin upgrade completion",
		);
		await capture("plugin-upgrade-success", true);
		state = await installed();
		if (state[0]?.entries[0]?.version !== "2.0.0" || state[0].entries[0]?.enabled !== false)
			throw new Error("Reopened registry did not retain upgraded version and disabled state");

		send("/plugins list\r", "Open the canonical dashboard through the /plugins alias");
		await wait(
			() => screen().includes("Plugin manager") && screen().includes("Disabled"),
			"reopened installed plugin manager",
		);
		await capture("plugin-reopened-installed", true);
		send("\r", "Inspect the reopened installed plugin details");
		await wait(
			() => screen().includes("Plugin details") && screen().includes("Installed version: 2.0.0"),
			"reopened plugin details",
		);
		await capture("plugin-reopened-details", true);
		send("\x1b", "Return from reopened plugin details to its parent list");
		await wait(
			() => screen().includes("Plugin manager") && !screen().includes("Plugin details"),
			"reopened plugin parent list",
		);
		send("\x1b", "Close the aliased plugin manager");
		await wait(() => !screen().includes("Plugin manager"), "closed aliased plugin manager");

		const beforeRemoval = await registryBytes();
		send("/plugin uninstall hello-plugin@test-marketplace\r", "Review removal of the exact installed copy");
		await wait(() => screen().includes("Review plugin removal"), "plugin removal review");
		await capture("plugin-removal-review", true);
		send("\r", "Cancel plugin removal from the initially selected action");
		await wait(() => !screen().includes("Review plugin removal"), "cancelled plugin removal");
		if ((await registryBytes()) !== beforeRemoval || (await installed()).length !== 1)
			throw new Error("Cancelled plugin removal changed persistent state");
		send("/plugin uninstall hello-plugin@test-marketplace\r", "Reopen plugin removal review");
		await wait(() => screen().includes("Review plugin removal"), "second plugin removal review");
		send("\x1b[B\r", "Confirm removal of the reviewed user-scoped copy");
		await wait(() => screen().includes("Uninstalled hello-plugin@test-marketplace"), "plugin removal completion");
		await capture("plugin-removal-success", true);
		if ((await installed()).length) throw new Error("Reopened registry still contains the removed plugin");

		send("/plugin\r", "Reopen the plugin manager after removal");
		await wait(
			() => screen().includes("Plugin manager") && screen().includes("No plugins are installed"),
			"empty installed tab",
		);
		await capture("plugin-empty-installed", true);
		send("\t\t", "Switch through stable tabs to Discover after removal");
		await wait(
			() => screen().includes("Discover (1)") && screen().includes("hello-plugin"),
			"discover tab after removal",
		);
		await capture("plugin-discover-after-removal", true);
		send("\x1b", "Close plugin manager after persistence verification");
		await wait(() => !screen().includes("Plugin manager"), "closed plugin manager after removal");

		const marketplaceBytes = await Bun.file(pluginManagerOptions.marketplacesRegistryPath).text();
		send(
			"/marketplace remove test-marketplace\r",
			"Use the legacy alias while sharing the same marketplace-removal review",
		);
		await wait(() => screen().includes("Review marketplace removal"), "marketplace removal review");
		await capture("marketplace-removal-review", true);
		send("\r", "Cancel marketplace removal first");
		await wait(() => !screen().includes("Review marketplace removal"), "cancelled marketplace removal");
		if ((await Bun.file(pluginManagerOptions.marketplacesRegistryPath).text()) !== marketplaceBytes)
			throw new Error("Cancelled marketplace removal changed registry bytes");
		send("/plugin marketplace remove test-marketplace\r", "Reopen marketplace removal through canonical syntax");
		await wait(() => screen().includes("Review marketplace removal"), "second marketplace removal review");
		send("\x1b[B\r", "Confirm reviewed marketplace removal");
		await wait(() => screen().includes("Removed marketplace: test-marketplace"), "marketplace removal completion");
		await capture("marketplace-removal-success", true);
		if ((await reopen().listMarketplaces()).length)
			throw new Error("Marketplace removal did not persist after reopen");

		persistence = {
			pluginId: "hello-plugin@test-marketplace",
			installCancelBytesUnchanged: true,
			forceIsReplacementNotConsent: true,
			disableCancelUnchanged: true,
			disableNoopNoWrite: true,
			installedVersionReopened: "1.0.0",
			upgradedVersionReopened: "2.0.0",
			disabledStatePreservedAcrossUpgrade: true,
			removalCancelBytesUnchanged: true,
			pluginRemovedAfterReopen: true,
			marketplaceRemovalCancelBytesUnchanged: true,
			marketplaceRemovedAfterReopen: true,
		};
	} else if (inventoriesFixture) {
		const configPath = join(profile.agentDir, "config.yml");
		const configBytes = async () => await Bun.file(configPath).text();
		const config = async () => YAML.parse(await configBytes()) as Record<string, unknown>;
		const unchangedBytes = await configBytes();
		send("/settings\r", "Open shared settings browser");
		await wait(() => screen().includes("Settings") && screen().includes("Appearance"), "settings browser");
		await capture("settings-browse", true);
		send("\x1b", "Close unchanged settings without writing");
		await wait(() => !screen().includes("Settings"), "editor after unchanged settings");
		if ((await configBytes()) !== unchangedBytes) throw new Error("Unchanged settings browse rewrote config bytes");

		const appearance = getSettingsForTab("appearance").filter(
			definition => definition.type !== "boolean" || !definition.condition || definition.condition(),
		);
		const colorBlindIndex = appearance.findIndex(definition => definition.path === "colorBlindMode");
		if (colorBlindIndex < 0) throw new Error("Missing deterministic appearance fixture setting");
		send("/settings\r", "Reopen settings to stage a persistent appearance change");
		await wait(() => screen().includes("Settings") && screen().includes("Appearance"), "second settings browser");
		for (let index = 0; index < colorBlindIndex; index++) send("\x1b[B", "Move to colorBlindMode setting");
		send("\r", "Open explicit colorBlindMode choices");
		await wait(
			() => screen().includes("Color-Blind Mode") && screen().includes("Saved only after combined review"),
			"color-blind editor",
		);
		await capture("settings-choice", true);
		send("\x1b[B\r", "Stage the alternate colorBlindMode value");
		send("\x13", "Open combined settings review");
		await wait(() => screen().includes("Review settings"), "combined settings review");
		await capture("settings-review", true);
		if ((await configBytes()) !== unchangedBytes) throw new Error("Settings draft mutated config before review");
		send("\r", "Cancel settings review from the initially selected action");
		await wait(() => !screen().includes("Review settings"), "settings review cancellation");
		if ((await configBytes()) !== unchangedBytes) throw new Error("Cancelled settings review mutated config");
		send("\x13", "Reopen combined settings review");
		await wait(() => screen().includes("Review settings"), "second settings review");
		send("\x1b[B\r", "Confirm combined settings review");
		await wait(() => screen().includes("Saved 1 settings change."), "settings save completion");
		await wait(async () => (await config()).colorBlindMode === true, "persisted settings value");
		const savedSettings = await config();
		if (savedSettings.colorBlindMode !== true) throw new Error("Confirmed settings value did not persist");
		await capture("settings-saved", true);

		const pluginSettingsPath = join(profile.root, "xdg-data", "xcsh", "plugins", "xcsh-plugins.lock.json");
		const pluginSettingsBytes = async () => await Bun.file(pluginSettingsPath).text();
		const originalPluginSettings = await pluginSettingsBytes();
		send("/settings\r", "Reopen settings and retain built-in state across the Plugins tab");
		await wait(() => screen().includes("Settings") && screen().includes("Appearance"), "settings before plugin tab");
		send("\x1b[Z", "Switch to the stable Plugins settings tab");
		await wait(
			() => screen().includes("Plugin settings") && screen().includes("synthetic-settings-plugin"),
			"plugin settings inventory",
		);
		await capture("plugin-settings-browse", true);
		send("\r", "Open plugin settings details");
		await wait(
			() => screen().includes("synthetic-settings-plugin") && screen().includes("Enabled"),
			"plugin settings details",
		);
		await capture("plugin-settings-details", true);
		send("\r", "Open explicit plugin enabled-state choices");
		await wait(() => screen().includes("Enable or disable this plugin"), "plugin enabled-state choices");
		send("\x1b[B\r", "Stage disabled as a plugin settings draft");
		send("\x13", "Open combined review for the plugin settings draft");
		await wait(
			() => screen().includes("Review settings") && screen().includes("synthetic-settings-plugin@1.0.0"),
			"plugin settings review",
		);
		await capture("plugin-settings-review", true);
		if ((await pluginSettingsBytes()) !== originalPluginSettings)
			throw new Error("Plugin settings draft mutated its lockfile before review");
		send("\r", "Cancel plugin settings review");
		await wait(() => !screen().includes("Review settings"), "plugin settings review cancellation");
		if ((await pluginSettingsBytes()) !== originalPluginSettings)
			throw new Error("Cancelled plugin settings review mutated its lockfile");
		send("\x13", "Reopen plugin settings review");
		await wait(() => screen().includes("Review settings"), "second plugin settings review");
		send("\x1b[B\r", "Confirm plugin settings review");
		await wait(() => screen().includes("Saved 1 plugin settings change."), "plugin settings save completion");
		await wait(async () => {
			const persisted = (await Bun.file(pluginSettingsPath).json()) as {
				plugins?: Record<string, { enabled?: boolean }>;
			};
			return persisted.plugins?.["synthetic-settings-plugin"]?.enabled === false;
		}, "persisted plugin disabled state");
		await capture("plugin-settings-saved", true);
		const reopenedPluginSettings = (await Bun.file(pluginSettingsPath).json()) as {
			plugins: Record<string, { enabled?: boolean }>;
			settings: Record<string, Record<string, unknown>>;
		};
		if (reopenedPluginSettings.settings["synthetic-settings-plugin"]?.secret !== "synthetic-redacted")
			throw new Error("Plugin settings save did not preserve unrelated masked configuration");

		const afterSettingsBytes = await configBytes();
		send("/extensions\r", "Open the single-column extension inventory");
		await wait(() => screen().includes("Extension control center"), "extension inventory");
		send("synthetic-inventory-skill", "Search by the synthetic extension identity");
		await wait(
			() => screen().includes("Synthetic Inventory Skill") || screen().includes("synthetic-inventory-skill"),
			"synthetic extension result",
		);
		await capture("extensions-browse", true);
		send("\r", "Open extension details without mutating state");
		await wait(() => screen().includes("Extension details") && screen().includes("Provider:"), "extension details");
		await capture("extensions-details", true);
		send("\r", "Open the Cancel-first extension state review");
		await wait(() => screen().includes("Review disable extension"), "extension review");
		await capture("extensions-review", true);
		if ((await configBytes()) !== afterSettingsBytes) throw new Error("Extension state mutated before review");
		send("\r", "Cancel extension review");
		await wait(() => screen().includes("Extension details"), "extension review cancellation");
		if ((await configBytes()) !== afterSettingsBytes) throw new Error("Cancelled extension review mutated config");
		send("\r", "Reopen extension review");
		await wait(() => screen().includes("Review disable extension"), "second extension review");
		send("\x1b[B\r", "Confirm extension disable");
		await wait(async () => Array.isArray((await config()).disabledExtensions), "persisted extension state");
		await capture("extensions-saved", true);
		const disabledExtensions = (await config()).disabledExtensions as string[];
		if (!disabledExtensions.some(value => value.includes("synthetic-inventory-skill")))
			throw new Error("Qualified extension identity was not persisted");
		send("\x1b", "Return from extension details to retained search");
		await wait(() => screen().includes("Extension control center"), "extension browse after details");
		send("\x1b", "Clear retained extension search");
		await Bun.sleep(100);
		send("\x1b", "Close extension inventory");
		await wait(() => !screen().includes("Extension control center"), "editor after extensions");

		const afterExtensionBytes = await configBytes();
		send("/agents\r", "Open the single-column agent inventory");
		await wait(() => screen().includes("Agent control center"), "agent inventory");
		send("synthetic-inventory-agent", "Search by stable agent identity");
		await wait(() => screen().includes("synthetic-inventory-agent"), "synthetic agent result");
		await capture("agents-browse", true);
		send("\r", "Open agent details without mutating state");
		await wait(() => screen().includes("Agent details") && screen().includes("Identifier:"), "agent details");
		await capture("agents-details", true);
		if (!screen().includes("Saved enabled state")) {
			send("\x1b[6~", "Page through compact agent details");
			await wait(() => screen().includes("Saved enabled state"), "paged agent enabled state");
			await capture("agents-details-paged", true);
			send("\x1b[5~", "Restore the first agent detail page");
			await wait(() => screen().includes("Identifier:"), "restored agent details");
		}
		send("\r", "Open Cancel-first agent state review");
		await wait(() => screen().includes("Review disable agent"), "agent review");
		await capture("agents-review", true);
		if ((await configBytes()) !== afterExtensionBytes) throw new Error("Agent state mutated before review");
		send("\r", "Cancel agent review");
		await wait(() => screen().includes("Agent details"), "agent review cancellation");
		if ((await configBytes()) !== afterExtensionBytes) throw new Error("Cancelled agent review mutated config");
		send("\r", "Reopen agent review");
		await wait(() => screen().includes("Review disable agent"), "second agent review");
		send("\x1b[B\r", "Confirm agent disable");
		await wait(async () => {
			const task = (await config()).task as { disabledAgents?: string[] } | undefined;
			return task?.disabledAgents?.includes("synthetic-inventory-agent") ?? false;
		}, "persisted agent state");
		await capture("agents-saved", true);
		const reopened = await config();
		const task = reopened.task as { disabledAgents?: string[] } | undefined;
		if (!task?.disabledAgents?.includes("synthetic-inventory-agent"))
			throw new Error("Agent disabled state did not survive independent config reopen");
		send("\x1b", "Return from agent details to retained search");
		await wait(() => screen().includes("Agent control center"), "agent browse after details");
		send("\x1b", "Clear retained agent search");
		await Bun.sleep(100);
		send("\x1b", "Close agent inventory");
		await wait(() => !screen().includes("Agent control center"), "editor after agents");
		persistence = {
			unchangedSettingsBytesPreserved: true,
			settingsCancelBytesPreserved: true,
			colorBlindMode: reopened.colorBlindMode,
			pluginSettingsCancelBytesPreserved: true,
			pluginEnabledAfterReopen: reopenedPluginSettings.plugins["synthetic-settings-plugin"]?.enabled,
			pluginSecretPreserved: true,
			extensionCancelBytesPreserved: true,
			disabledExtensionIdentity: disabledExtensions.find(value => value.includes("synthetic-inventory-skill")),
			agentCancelBytesPreserved: true,
			disabledAgent: "synthetic-inventory-agent",
		};
	} else if (foundationFixture) {
		const configFile = Bun.file(join(profile.agentDir, "config.yml"));
		const modelsFile = Bun.file(join(profile.agentDir, "models.yml"));
		const sessionDir = join(profile.root, "sessions");
		const sessionFiles = () => [...new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir })].sort();
		const sessionBytes = async () => {
			const files = sessionFiles();
			return files.length ? await Bun.file(join(sessionDir, files[0])).text() : undefined;
		};
		const hasAnthropicCredential = async () => {
			const auth = await AuthStorage.create(getAgentDbPath(profile.agentDir));
			try {
				await auth.reload();
				return auth.hasAuth("anthropic");
			} finally {
				auth.close();
			}
		};
		const pageReview = async (prefix: string, target: string) => {
			let pages = 0;
			while (screen().includes("review details") && pages < 12) {
				const before = screen();
				send("\x1b[6~", `Page down through ${prefix} review details`);
				await Bun.sleep(75);
				await writes;
				if (screen() === before) break;
				pages++;
				await capture(`${prefix}-paged-${pages}`);
			}
			for (let page = 0; page < pages; page++) {
				const before = screen();
				send("\x1b[5~", `Page up to restore ${prefix} target`);
				await wait(() => screen() !== before, `${prefix} previous review page`);
			}
			if (!screen().includes(target)) throw new Error(`${prefix} paging lost its stable target`);
		};
		const escapeUntil = async (predicate: () => boolean, label: string, action: string) => {
			for (let attempt = 1; attempt <= 5; attempt++) {
				send(
					"\x1b",
					attempt === 1 ? action : `Repeat Escape after the PTY retained terminal response bytes (${attempt})`,
				);
				await Bun.sleep(300);
				await writes;
				if (predicate()) return;
			}
			throw new Error(`Escape hierarchy did not reach ${label}`);
		};

		const initialConfig = await configFile.text();
		const initialModels = await modelsFile.text();
		if (!(await hasAnthropicCredential())) throw new Error("Foundation credential seed was not persisted");

		send("/login\r", "Open the configured-provider manager");
		await wait(() => screen().includes("Your providers") && screen().includes("Add provider"), "provider manager");
		await capture("login-provider-manager", true);
		send("\x03", "Ctrl+C remains execution control and does not navigate back from provider management");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Your providers")) throw new Error("Ctrl+C acted as Back in provider management");
		send("\x1b[200~add provider\x1b[201~", "Bracketed-paste editable provider search");
		await wait(
			() => screen().includes("Search providers (1/1)") && screen().includes("Add provider"),
			"add-provider row",
		);
		send("\r", "Open the complete provider catalog");
		await wait(
			() => screen().includes("Connect a provider") && screen().includes("Search providers"),
			"provider catalog",
		);
		await capture("login-provider-catalog");
		send("\x1b[200~antigravity\x1b[201~", "Search the provider catalog by stable identity");
		await wait(
			() => screen().includes("Google Antigravity") && !screen().includes("No matching providers"),
			"provider result",
		);
		await capture("login-provider-search");
		const beforeProviderReviewConfig = await configFile.text();
		const beforeProviderReviewModels = await modelsFile.text();
		send("\r", "Open credential-persistence review without starting authentication");
		await wait(() => screen().includes("Review provider sign-in"), "provider sign-in review");
		await capture("login-provider-review");
		await pageReview("login-provider-review", "Target: provider:google-antigravity");
		if (screen().includes("xcsh-uat-synthetic-stored-key"))
			throw new Error("Provider review exposed a stored credential");
		send("\r", "Cancel the initially selected provider sign-in action");
		await wait(
			() => screen().includes("Connect a provider") && screen().includes("antigravity"),
			"retained provider search after review cancellation",
		);
		await capture("login-provider-review-cancelled", true);
		if (
			(await configFile.text()) !== beforeProviderReviewConfig ||
			(await modelsFile.text()) !== beforeProviderReviewModels ||
			!(await hasAnthropicCredential())
		)
			throw new Error("Cancelled provider sign-in changed persisted state");
		await escapeUntil(
			() => screen().includes("Connect a provider") && screen().includes("Search providers (1/40)"),
			"cleared provider search",
			"First Escape clears the active provider search",
		);
		await escapeUntil(
			() => screen().includes("Your providers"),
			"configured provider parent",
			"Second Escape returns to configured providers",
		);
		await escapeUntil(
			() => !screen().includes("Your providers"),
			"editor after provider management",
			"Third Escape closes provider management",
		);

		const liteLlmSessionBefore = await sessionBytes();
		const openLiteLlmReview = async (enterDefaults: boolean) => {
			send("/login litellm\r", "Start the typed LiteLLM connection workflow");
			await wait(() => screen().includes("LiteLLM Base URL"), "LiteLLM endpoint input");
			if (enterDefaults) send("\r", "Retain the previously entered exact LiteLLM endpoint");
			else send(`${localProvider!.url.toString()}\r`, "Enter the isolated loopback LiteLLM endpoint");
			await wait(() => screen().includes("LiteLLM API Key"), "masked LiteLLM credential input");
			if (enterDefaults) send("\r", "Retain the previously entered masked LiteLLM credential");
			else {
				send("xcsh-uat-foundation-litellm-key", "Enter a synthetic credential into the masked input");
				await Bun.sleep(100);
				await writes;
				if (screen().includes("xcsh-uat-foundation-litellm-key"))
					throw new Error("LiteLLM credential input rendered its secret value");
				await capture("login-litellm-masked-input");
				send("\r", "Submit the masked synthetic LiteLLM credential");
			}
			await wait(
				() =>
					screen().includes("Connecting to") &&
					screen().includes(localProvider!.url.host) &&
					!screen().includes("LiteLLM API Key") &&
					!screen().includes("Review LiteLLM connection"),
				"LiteLLM probe",
			);
			await capture("login-litellm-loading", false, 0);
			await wait(() => screen().includes("Review LiteLLM connection"), "LiteLLM connection review");
		};
		await openLiteLlmReview(false);
		await capture("login-litellm-review");
		await pageReview("login-litellm-review", "Target: provider:litellm");
		if (screen().includes("xcsh-uat-foundation-litellm-key"))
			throw new Error("LiteLLM connection review exposed its credential");
		send("\r", "Cancel the initially selected LiteLLM persistence action");
		await wait(() => screen().includes("LiteLLM login cancelled"), "cancelled LiteLLM connection");
		if (
			(await modelsFile.text()) !== initialModels ||
			(await configFile.text()) !== initialConfig ||
			(await sessionBytes()) !== liteLlmSessionBefore
		)
			throw new Error("Cancelled LiteLLM connection changed persisted state");
		await openLiteLlmReview(false);
		send("\x1b[B\r", "Confirm the reviewed LiteLLM connection");
		await wait(
			() =>
				(screen().includes("Provider connected") || screen().includes("Connection saved")) &&
				screen().includes("LiteLLM"),
			"saved LiteLLM connection",
		);
		await capture("login-litellm-saved", true);
		const connectedModels = await modelsFile.text();
		if (connectedModels === initialModels || !connectedModels.includes("litellm"))
			throw new Error("Confirmed LiteLLM connection was not persisted");
		if ((await configFile.text()) !== initialConfig || (await sessionBytes()) !== liteLlmSessionBefore)
			throw new Error("Connection-only LiteLLM persistence changed model roles or the active session");
		await escapeUntil(
			() => !screen().includes("Provider connected") && !screen().includes("Connection saved"),
			"editor after provider connection",
			"Close the provider-connected handoff without selecting a model",
		);

		const openModelReview = async (
			command: "/model" | "/models",
			query: string,
			scope: "conversation" | "default" | "smol",
		) => {
			const requestsBeforeOpen = providerRequests.length;
			send(`${command}\r`, `Open model browser through ${command}`);
			await wait(
				() => screen().includes("Choose a model") && screen().includes("Search all providers"),
				"model browser",
			);
			send(`\x1b[200~${query}\x1b[201~`, `Search models for ${query}`);
			await wait(
				() => providerRequests.length > requestsBeforeOpen || screen().includes(`anthropic/claude-${query}`),
				`${query} model refresh or cached availability`,
			);
			await Bun.sleep(250);
			await writes;
			await wait(
				() =>
					screen().includes(`anthropic/claude-${query}`) &&
					!screen().includes("Unavailable") &&
					!screen().includes("Refreshing"),
				`available exact ${query} model identity`,
			);
			await capture(`model-${query}-search`);
			send("\r", "Open explicit model scope choices");
			await wait(() => screen().includes("Choose where this model applies"), "model scope choices");
			if (scope === "default") send("\x1b[B", "Select saved-default scope");
			else if (scope === "smol") send("\x1b[B\x1b[B", "Select role-assignment scope");
			await capture(`model-${query}-${scope}-scope`);
			send("\r", `Continue with ${scope} scope`);
			if (scope === "smol") {
				await wait(() => screen().includes("Choose a specialist role"), "specialist role choices");
				send("\x1b[B", "Select the stable smol role identity");
				await capture(`model-${query}-smol-role`);
				send("\r", "Continue with the smol role");
			}
			await wait(() => screen().includes("Reasoning"), "model reasoning choices");
			await capture(`model-${query}-${scope}-reasoning`);
			send("\r", "Use the explicitly selected provider-default reasoning");
			await wait(() => screen().includes("Review model selection"), "model selection review");
		};

		const conversationBefore = await sessionBytes();
		await openModelReview("/model", "haiku-4-5", "conversation");
		await capture("model-conversation-review");
		await pageReview("model-conversation-review", "active-model");
		send("\r", "Cancel the initially selected conversation model change");
		await wait(
			() => screen().includes("Choose a model") && screen().includes("haiku-4-5"),
			"model browse context after cancel",
		);
		if ((await sessionBytes()) !== conversationBefore)
			throw new Error("Cancelled conversation model review changed session bytes");
		send("\r\r\r", "Reopen scope and reasoning for the retained exact model");
		await wait(() => screen().includes("Review model selection"), "conversation model review again");
		send("\x1b[B\r", "Confirm the reviewed conversation model change");
		await wait(() => screen().includes("This conversation: anthropic/claude-haiku-4-5"), "conversation model saved");
		await capture("model-conversation-saved", true);
		const conversationSaved = await sessionBytes();
		if (
			!conversationSaved ||
			conversationSaved === conversationBefore ||
			!conversationSaved.includes("claude-haiku-4-5")
		)
			throw new Error("Confirmed conversation model and routing pin were not persisted");

		const requestsBeforeNoopBrowser = providerRequests.length;
		send("/model\r", "Reopen the model browser for an exact conversation no-op");
		await wait(
			() => screen().includes("Choose a model") && screen().includes("Search all providers"),
			"model browser for no-op",
		);
		send("\x1b[200~haiku-4-5\x1b[201~", "Search the exact active model for a no-op");
		await wait(
			() => providerRequests.length > requestsBeforeNoopBrowser || screen().includes("anthropic/claude-haiku-4-5"),
			"active-model refresh or cached availability",
		);
		await Bun.sleep(250);
		await writes;
		await wait(
			() =>
				screen().includes("anthropic/claude-haiku-4-5") &&
				screen().includes("Active") &&
				!screen().includes("Unavailable") &&
				!screen().includes("Refreshing"),
			"active model no-op target",
		);
		send("\r", "Open scope for the exact active model");
		await wait(() => screen().includes("Choose where this model applies"), "no-op scope choices");
		send("\r", "Retain conversation scope for the exact active model");
		await wait(() => screen().includes("Reasoning · This conversation"), "no-op reasoning choices");
		send("\r", "Retain the exact active reasoning level");
		await wait(
			() =>
				(screen().includes("already applied at this") && screen().includes("Nothing changed")) ||
				// At 60x20 the status line is rendered and immediately replaced by
				// the restored model browser before the terminal viewport sampler can
				// observe it. The PTY transcript is the authoritative receipt for
				// that transient no-op outcome; navigation and byte checks below
				// still prove that the browser remained usable and state unchanged.
				(stream.includes("is already applied at this") && stream.includes("Nothing changed")),
			"exact conversation model no-op",
		);
		await capture("model-conversation-noop", true);
		if ((await sessionBytes()) !== conversationSaved) throw new Error("Exact model no-op changed session bytes");
		await escapeUntil(
			() =>
				screen().includes("Choose a model") &&
				screen().includes("Search all providers") &&
				!screen().includes("> haiku-4-5"),
			"cleared model search after exact no-op",
			"Clear model search after exact no-op",
		);
		await escapeUntil(
			() => !screen().includes("Choose a model"),
			"editor after model no-op",
			"Close model browser after exact no-op",
		);

		const defaultConfigBefore = await configFile.text();
		const defaultSessionBefore = await sessionBytes();
		await openModelReview("/models", "opus-5", "default");
		await capture("model-default-review");
		await pageReview("model-default-review", "model-role:default");
		send("\r", "Cancel the initially selected saved-default change");
		await wait(
			() => screen().includes("Choose a model") && screen().includes("opus-5"),
			"default browse context after cancel",
		);
		if ((await configFile.text()) !== defaultConfigBefore || (await sessionBytes()) !== defaultSessionBefore)
			throw new Error("Cancelled saved-default review changed state");
		send("\r\x1b[B\r\r", "Reopen and retain the saved-default scope and reasoning");
		await wait(() => screen().includes("Review model selection"), "saved-default review again");
		send("\x1b[B\r", "Confirm the reviewed saved-default change");
		await wait(() => screen().includes("Saved default: anthropic/claude-opus-5"), "saved default applied");
		await capture("model-default-saved", true);
		const defaultConfigSaved = await configFile.text();
		const defaultSessionSaved = await sessionBytes();
		const parsedDefault = Bun.YAML.parse(defaultConfigSaved) as { modelRoles?: Record<string, string> };
		if (parsedDefault.modelRoles?.default !== "anthropic/claude-opus-5")
			throw new Error("Reopened settings do not contain the reviewed default model");
		if (!defaultSessionSaved?.includes("claude-opus-5"))
			throw new Error("Saved-default action did not persist the resulting active model and routing pin");

		const roleSessionBefore = await sessionBytes();
		await openModelReview("/model", "haiku-4-5", "smol");
		await capture("model-smol-review");
		await pageReview("model-smol-review", "model-role:smol");
		send("\x1b[B\r", "Confirm the reviewed smol-role assignment");
		await wait(() => screen().includes("Role smol: anthropic/claude-haiku-4-5"), "smol role saved");
		await capture("model-smol-saved", true);
		const roleConfigSaved = await configFile.text();
		const parsedRole = Bun.YAML.parse(roleConfigSaved) as { modelRoles?: Record<string, string> };
		if (parsedRole.modelRoles?.smol !== "anthropic/claude-haiku-4-5:low")
			throw new Error("Reopened settings do not contain the reviewed smol role");
		if (parsedRole.modelRoles?.default !== "anthropic/claude-opus-5")
			throw new Error("The later role save overwrote the previously reviewed default model");
		if ((await sessionBytes()) !== roleSessionBefore)
			throw new Error("Role-only model assignment changed the active session");
		await escapeUntil(
			() => screen().includes("Choose a model") && !screen().includes("> haiku-4-5"),
			"cleared model search after role assignment",
			"Clear model search after role assignment",
		);
		await escapeUntil(
			() => !screen().includes("Choose a model"),
			"editor after role assignment",
			"Close model browser after role assignment",
		);

		send("/logout\r", "Open stored-credential removal");
		await wait(
			() => screen().includes("Disconnect a provider") && screen().includes("Anthropic"),
			"logout provider selector",
		);
		await capture("logout-provider-selector", true);
		send("\x1b[200~anthropic\x1b[201~", "Search logout targets by exact provider identity");
		await wait(() => screen().includes("Search providers (1/1)"), "exact logout target");
		send("\r", "Review removal of the selected stored credential");
		await wait(() => screen().includes("Review provider credential removal"), "credential removal review");
		await capture("logout-review");
		await pageReview("logout-review", "Target: provider:anthropic");
		send("\r", "Cancel the initially selected credential removal");
		await wait(
			() => screen().includes("Disconnect a provider") && screen().includes("anthropic"),
			"logout context after cancel",
		);
		if (!(await hasAnthropicCredential())) throw new Error("Cancelled logout removed the credential");
		send("\r", "Reopen credential removal review from retained selection");
		await wait(() => screen().includes("Review provider credential removal"), "credential removal review again");
		send("\x1b[B\r", "Confirm the reviewed credential removal");
		await wait(() => screen().includes("Successfully logged out of anthropic"), "credential removal success");
		await capture("logout-saved", true);
		if (await hasAnthropicCredential()) throw new Error("Confirmed logout credential remained in the reopened store");
		send("/logout\r", "Report the empty stored-credential state");
		await wait(() => screen().includes("No stored provider credentials to remove"), "empty logout state");
		await capture("logout-empty", true);

		send("/login not-a-provider\r", "Exercise typed manual-callback recovery without a pending login");
		await wait(() => screen().includes("No OAuth login is waiting"), "typed login recovery warning");
		await capture("login-manual-callback-unavailable");

		const sessionFile = sessionFiles()[0];
		if (!sessionFile) throw new Error("Foundation model changes did not create a session file");
		const reopened = await SessionManager.open(join(sessionDir, sessionFile));
		try {
			const entries = reopened.getEntries();
			if (!JSON.stringify(entries).includes("user_model_pin") || !JSON.stringify(entries).includes("claude-opus-5"))
				throw new Error("Reopened session is missing reviewed model routing state");
		} finally {
			await reopened.close();
		}
		persistence = {
			providerReviewCancelPreservedConfig: true,
			providerReviewCancelPreservedCredential: true,
			liteLlmCancelBytesUnchanged: true,
			liteLlmConnectionPersisted: connectedModels.includes("litellm"),
			liteLlmConnectionLeftAssignmentsUnchanged: true,
			conversationReviewCancelBytesUnchanged: true,
			conversationModelAndPinReopened: true,
			conversationNoopBytesUnchanged: true,
			defaultReviewCancelBytesUnchanged: true,
			defaultModelReopened: parsedDefault.modelRoles?.default,
			smolRoleReopened: parsedRole.modelRoles?.smol,
			roleOnlySessionBytesUnchanged: true,
			logoutCancelPreservedCredential: true,
			logoutRemovalReopened: !(await hasAnthropicCredential()),
			providerRequests,
		};
	} else if (browserFixture) {
		const config = Bun.file(join(profile.agentDir, "config.yml"));
		const before = await config.text();
		const pageReview = async (prefix: string, target: string) => {
			let pages = 0;
			while (screen().includes("review details") && pages < 12) {
				const previous = screen();
				send("\x1b[6~", `Page down through ${prefix} consequences`);
				await Bun.sleep(75);
				await writes;
				if (screen() === previous) break;
				await capture(`${prefix}-paged-${++pages}`);
			}
			while (!screen().includes(target) && pages-- > 0) {
				const previous = screen();
				send("\x1b[5~", `Page up to restore ${prefix} target`);
				await wait(() => screen() !== previous, `previous ${prefix} review page`);
			}
			if (!screen().includes(target)) throw new Error(`${prefix} paging lost its stable target`);
		};

		send("/browser\r", "Open explicit browser-mode choices");
		await wait(
			() => screen().includes("Browser mode") && screen().includes("Use visible browser"),
			"browser choices",
		);
		await capture("browser-choices");
		send("\r", "Initially selected Cancel leaves browser settings unchanged");
		await wait(() => !screen().includes("Use visible browser"), "cancelled browser choices");
		if ((await config.text()) !== before) throw new Error("Browser choice Cancel changed settings");

		const openBrowserReview = async () => {
			send("/browser visible\r", "Review the visible-browser user default");
			await wait(() => screen().includes("Review browser mode"), "browser mode review");
		};
		await openBrowserReview();
		await capture("browser-review");
		await pageReview("browser-review", "Target:");
		send("\r", "Cancel the initially selected browser change");
		await wait(() => !screen().includes("Review browser mode"), "cancelled browser review");
		if ((await config.text()) !== before) throw new Error("Browser review Cancel changed settings");
		await openBrowserReview();
		send("\x1b[B\r", "Confirm the reviewed visible-browser default");
		await wait(() => screen().includes("Browser default saved: visible"), "browser setting saved");
		await capture("browser-saved", true);
		const saved = await config.text();
		if ((Bun.YAML.parse(saved) as { browser?: { headless?: boolean } }).browser?.headless !== false)
			throw new Error("Persisted browser.headless setting is not visible/false");
		send("/browser status\r", "Read the saved and effective browser mode");
		await wait(
			() => screen().includes("Browser default: visible") && screen().includes("Effective setting: visible"),
			"browser status",
		);
		await capture("browser-status", true);
		if ((await config.text()) !== saved) throw new Error("Browser status changed settings bytes");
		send("/browser visible\r", "Request the already-saved browser mode");
		await wait(() => screen().includes("already visible") && screen().includes("nothing saved"), "browser no-op");
		await capture("browser-noop", true);
		if ((await config.text()) !== saved) throw new Error("Browser no-op changed settings bytes");
		send("/browser invalid\r", "Reject an invalid browser mode");
		await wait(() => screen().includes("Usage: /browser"), "browser usage error");
		await capture("browser-invalid");

		const requestsBeforeStatus = chromeRequests.length;
		send("/chrome status\r", "Inspect the configured disposable Chrome endpoint without attaching");
		await wait(() => screen().includes("Chrome ·") && screen().includes("Debug endpoint:"), "Chrome status");
		await capture("chrome-status");
		if (chromeRequests.length !== requestsBeforeStatus + 1)
			throw new Error("Chrome status did not perform exactly one read-only configured-endpoint probe");
		const requestsAfterStatus = chromeRequests.length;
		const openChromeReview = async () => {
			send("/chrome relaunch\r", "Review access to the disposable Chrome endpoint");
			await wait(() => screen().includes("Review Chrome access"), "Chrome access review");
		};
		await openChromeReview();
		await capture("chrome-review");
		await pageReview("chrome-review", "chrome:interactive-acquisition");
		send("\r", "Cancel Chrome access from the initially selected action");
		await wait(() => !screen().includes("Review Chrome access"), "cancelled Chrome review");
		if (chromeRequests.length !== requestsAfterStatus + 1)
			throw new Error("Chrome review cancellation performed more than its read-only revalidation probe");
		const requestsAfterCancel = chromeRequests.length;
		await openChromeReview();
		send("\x1b[B\r", "Confirm attach to the reviewed disposable Chrome endpoint");
		await wait(() => screen().includes("Chrome ready (attached)"), "Chrome attached");
		await capture("chrome-ready", true);
		if (!chromeRequests.slice(requestsAfterCancel).some(request => request.path === "/json/version"))
			throw new Error("Confirmed Chrome access did not discover the reviewed endpoint");

		await stopBrowserEndpoint();
		await openChromeReview();
		send("\x1b[B\r", "Confirm the reviewed endpoint after its backing process stops");
		await wait(
			() => screen().includes("Unresolved Chrome access") && screen().includes("Could not attach to Chrome"),
			"Chrome unresolved failure",
		);
		await capture("chrome-failure");
		await restartBrowserEndpoint();
		send("\x1b[B\r", "Request retry after the Chrome endpoint recovers");
		await wait(() => screen().includes("The proposal changed."), "renewed Chrome recovery review");
		await capture("chrome-recovered-review");
		send("\x1b[B\r", "Confirm the renewed Chrome recovery proposal");
		await wait(() => screen().includes("Chrome ready (attached)"), "Chrome retry attached");
		await capture("chrome-retried", true);
		send("/chrome invalid\r", "Reject an invalid Chrome action");
		await wait(() => screen().includes("Usage: /chrome"), "Chrome usage error");
		await capture("chrome-invalid");

		persistence = {
			browserHeadless: false,
			cancelledChoiceBytesUnchanged: true,
			cancelledReviewBytesUnchanged: true,
			statusBytesUnchanged: true,
			noopBytesUnchanged: true,
			chromeEndpoint: "isolated disposable loopback proxy",
			chromeProfile: "isolated disposable profile",
			statusProbeOnly: true,
			cancelledChromePerformedNoAttachment: true,
			confirmedChromeAttachment: true,
			failedAttachmentStayedUnresolved: true,
			retryAfterEndpointRecovery: true,
			chromeRequests,
			providerRequests,
		};
	} else if (reportsFixture) {
		if (!reportsSessionFile || reportsSeedBytes === undefined)
			throw new Error("Reports fixture session was not seeded");
		const reportArchives = () => [...new Bun.Glob("**/reports/*.tar.gz").scanSync({ cwd: profile.root })].sort();
		const reportPosts = () =>
			providerRequests.filter(request => request.method === "POST" && request.path === "/v1/messages");
		const pageReportToEnd = async (label: string) => {
			let pages = 0;
			for (;;) {
				const match = screen().match(/details (\d+)[–-](\d+) of (\d+)/u);
				if (!match) return pages;
				if (Number(match[2]) >= Number(match[3])) return pages;
				if (pages >= 1_000) throw new Error(`${label} did not reach its final detail`);
				const before = screen();
				send("\x1b[6~", `Page down through ${label}`);
				await wait(() => screen() !== before, `${label} page ${pages + 2}`);
				pages++;
			}
		};

		await wait(() => screen().includes("Synthetic media frame one"), "seeded media timeline");
		await capture("media-stopped-initial");

		send("/med", "Type a partial media command to open autocomplete");
		await wait(
			() => screen().includes("/med") && screen().includes("native scope") && screen().includes("media"),
			"media command autocomplete",
		);
		await capture("media-autocomplete");
		send("\x1b", "Escape closes autocomplete before clearing the retained draft");
		await wait(() => !screen().includes("native scope"), "cleared autocomplete draft");
		send("\x15", "Clear the retained autocomplete draft with the editor binding");

		send("/media play latest\r", "Play the latest seeded media timeline");
		await wait(() => screen().includes("media_0123456789abcdef01234567: playing"), "playing media status");
		await capture("media-playing");
		send("/media pause latest\r", "Pause the latest seeded media timeline");
		await wait(() => screen().includes("media_0123456789abcdef01234567: paused"), "paused media status");
		await capture("media-paused");
		send("/media stop latest\r", "Stop and reset the latest seeded media timeline");
		await wait(
			() =>
				screen().includes("media_0123456789abcdef01234567: stopped") &&
				screen().includes("Synthetic media frame one"),
			"stopped media status",
		);
		await capture("media-stopped");
		send("/media rewind latest\r", "Reject an unsupported media action");
		await wait(() => screen().includes("Usage: /media play|pause|stop"), "invalid media action");
		await capture("media-invalid");
		if ((await Bun.file(reportsSessionFile).text()) !== reportsSeedBytes)
			throw new Error("Media controls changed the seeded session bytes");

		send("/btw Is this side answer ephemeral?\r", "Start an ephemeral side answer");
		await wait(() => screen().includes("BTW") && screen().includes("Loading side answer"), "running BTW side answer");
		await capture("btw-loading", false, 0);
		send("\x1b", "Escape remains navigation-only while BTW is running");
		await wait(() => screen().includes("/btw is still running"), "BTW Escape status");
		await capture("btw-escape-running", false, 0);
		await wait(
			() => screen().includes("Answer complete") && screen().includes("Synthetic side answer"),
			"completed BTW side answer",
		);
		await capture("btw-complete");
		send("\x1b", "Dismiss the completed BTW panel");
		await wait(() => !screen().includes("Ephemeral side answer from a snapshot"), "dismissed BTW panel");

		send("/btw Interrupt this side answer\r", "Start a second BTW side answer");
		await wait(
			() => reportPosts().length === 2 && screen().includes("Loading side answer"),
			"second running BTW side answer",
		);
		send("\x03", "Ctrl+C interrupts the active BTW request");
		await wait(() => screen().includes("Interrupted") && screen().includes("BTW"), "interrupted BTW side answer");
		await capture("btw-interrupted");
		send("\x1b", "Dismiss the interrupted BTW panel");
		await wait(() => !screen().includes("Interrupt this side answer"), "dismissed interrupted BTW panel");

		send("/btw trigger synthetic failure\r", "Exercise a failed BTW response");
		await wait(
			() => screen().includes("BTW") && screen().includes("Synthetic BTW provider failure"),
			"failed BTW side answer",
		);
		await capture("btw-failed");
		send("\x1b", "Dismiss the failed BTW panel");
		await wait(() => !screen().includes("trigger synthetic failure"), "dismissed failed BTW panel");
		send("/btw Retry after failure\r", "Retry BTW after the failure settles");
		await wait(
			() => screen().includes("Answer complete") && screen().includes("Synthetic side answer"),
			"retried BTW side answer",
		);
		await capture("btw-retried");
		send("\x1b", "Dismiss the retried BTW panel");
		await wait(() => !screen().includes("Retry after failure"), "dismissed retried BTW panel");
		if ((await Bun.file(reportsSessionFile).text()) !== reportsSeedBytes)
			throw new Error("Ephemeral BTW requests changed the session transcript");

		send("Write the isolated main conversation response\r", "Submit a normal conversation prompt");
		await wait(() => screen().includes("Working") && screen().includes("Ctrl+C"), "main conversation progress");
		await capture("conversation-progress", false, 0);
		send("\x1b", "Escape remains navigation-only during the main response");
		await wait(() => screen().includes("Synthetic main conversation response."), "main conversation completion");
		await capture("conversation-complete", true);

		send("/debug\r", "Open the debug selector overlay");
		await wait(() => screen().includes("Debug tools and privacy-safe diagnostics"), "debug selector");
		await capture("debug-selector");
		send("no-match", "Filter the debug selector to an empty state");
		await wait(() => screen().includes("No matching options."), "empty debug selector search");
		await capture("debug-selector-empty");
		send("\x1b", "First Escape clears debug selector search");
		await wait(() => screen().includes("10 of 10 options"), "restored debug selector");
		send("system info\r", "Open privacy-safe system information");
		await wait(() => screen().includes("System information"), "system information report");
		await capture("debug-system-report");
		send("\x03", "Ctrl+C does not close the debug report overlay");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("System information")) throw new Error("Ctrl+C closed the debug report");
		send("\x1b", "Escape closes the debug report overlay");
		await wait(() => !screen().includes("System information"), "editor after system information");

		send("/debug\r", "Open debug tools for a report bundle review");
		await wait(() => screen().includes("Debug tools and privacy-safe diagnostics"), "debug selector for report");
		send("dump session\r", "Review a diagnostic report bundle");
		await wait(() => screen().includes("Review bundle debug report"), "debug report review");
		await capture("debug-report-review-cancel");
		if (reportArchives().length !== 0) throw new Error("Debug report was written before confirmation");
		send("\r", "Cancel report creation from the initially selected action");
		await wait(() => !screen().includes("Review bundle debug report"), "cancelled debug report");
		if (reportArchives().length !== 0) throw new Error("Cancelled debug report created an archive");

		send("/debug\r", "Reopen debug tools for confirmed report creation");
		await wait(() => screen().includes("Debug tools and privacy-safe diagnostics"), "debug selector retry");
		send("dump session\r", "Review the diagnostic report bundle again");
		await wait(() => screen().includes("Review bundle debug report"), "second debug report review");
		send("\x1b[B\r", "Confirm creation of the reviewed diagnostic report");
		await wait(() => screen().includes("Report bundle saved"), "saved debug report bundle");
		await capture("debug-report-saved", true);
		const archives = reportArchives();
		if (archives.length !== 1) throw new Error(`Expected one debug report archive, observed ${archives.length}`);
		const archivePath = join(profile.root, archives[0]);
		const archiveStat = await stat(archivePath);
		const archiveListing = Bun.spawnSync(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "pipe" });
		if (
			archiveStat.size < 1 ||
			archiveListing.exitCode !== 0 ||
			!archiveListing.stdout.toString().includes("session.jsonl") ||
			!archiveListing.stdout.toString().includes("system.json")
		)
			throw new Error("Debug report archive failed independent content verification");

		send("/debug\r", "Open debug tools for recent logs");
		await wait(() => screen().includes("Debug tools and privacy-safe diagnostics"), "debug selector for logs");
		send("recent logs\r", "Open the bounded debug log viewer");
		await wait(() => screen().includes("Debug logs"), "debug log viewer");
		await capture("debug-logs");
		send("\x03", "Review copying the selected debug log entry");
		await wait(() => screen().includes("Review debug log copy"), "debug log copy review");
		await capture("debug-log-copy-review");
		send("\r", "Cancel debug log copy from the initially selected action");
		await wait(() => !screen().includes("Review debug log copy"), "cancelled debug log copy");
		send("\x1b", "Escape closes the debug log viewer");
		await wait(() => !screen().includes("Debug logs"), "debug selector after debug logs");
		send("\x1b", "Escape closes the parent debug selector");
		await wait(() => !screen().includes("Debug tools and privacy-safe diagnostics"), "editor after debug logs");

		send("/jobs\r", "Open the current-session background-jobs report");
		await wait(
			() => screen().includes("Background Jobs") && screen().includes("Current session · empty"),
			"empty jobs report",
		);
		await capture("jobs-empty");
		send("\x03", "Ctrl+C does not act as Back in the jobs report");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Background Jobs")) throw new Error("Ctrl+C closed the jobs report");
		send("\x1b", "Escape closes the jobs report");
		await wait(() => !screen().includes("Background Jobs"), "editor after jobs report");

		send("/usage\r", "Refresh usage from the isolated local provider");
		await wait(() => screen().includes("Refreshing provider usage"), "usage loading state");
		// Animated spinners intentionally never have a stable viewport. Capture
		// the actual active frame instead of waiting for the success screen.
		await capture("usage-loading", false, 0);
		await wait(() => screen().includes("Usage") && screen().includes("Provider limits"), "usage report");
		await capture("usage-report");
		const usagePages = await pageReportToEnd("usage details");
		if (usagePages > 0) await capture("usage-report-last");
		send("\x1b", "Close the usage report");
		await wait(() => !screen().includes("Provider limits"), "editor after usage report");

		send("/changelog\r", "Open the bounded recent changelog");
		await wait(() => screen().includes("Recent Changes") && screen().includes("Latest"), "recent changelog");
		await capture("changelog-recent");
		await pageReportToEnd("recent changelog");
		await capture("changelog-recent-last");
		send("\x1b", "Close the recent changelog");
		await wait(() => !screen().includes("Recent Changes"), "editor after recent changelog");

		send("/changelog full\r", "Open the complete bounded changelog");
		await wait(() => screen().includes("Complete release history"), "full changelog");
		await capture("changelog-full");
		const fullChangelogFirst = screen();
		send("\x1b[6~", "Page down through the complete changelog");
		await wait(() => screen() !== fullChangelogFirst, "second complete changelog page");
		await capture("changelog-full-paged");
		send("\x1b", "Close the complete changelog");
		await Bun.sleep(250);
		await writes;
		if (screen().includes("Complete release history"))
			send("\x1b", "Repeat Escape after the PTY left the first lone Escape undelivered");
		await wait(() => !screen().includes("Complete release history"), "editor after full changelog");

		send("/hotkeys\r", "Open effective terminal keybindings");
		await wait(
			() => screen().includes("Keyboard Shortcuts") && screen().includes("Effective terminal keybindings"),
			"hotkeys report",
		);
		await capture("hotkeys");
		const hotkeyPages = await pageReportToEnd("hotkey details");
		if (hotkeyPages < 1) throw new Error("Hotkeys did not exercise overflow paging");
		await capture("hotkeys-last");
		send("\x1b", "Close the hotkeys report");
		await wait(() => !screen().includes("Keyboard Shortcuts"), "editor after hotkeys");

		send("/tools\r", "Open active-model tool availability");
		await wait(
			() => screen().includes("Available Tools") && screen().includes("Tools available to the active model"),
			"tools report",
		);
		await capture("tools");
		send("\x1b", "Close the tools report");
		await wait(() => !screen().includes("Available Tools"), "editor after tools");

		send("/changelog unexpected\r", "Reject an unsupported changelog argument");
		await wait(() => screen().includes("Usage: /changelog [full]"), "changelog usage error");
		await capture("changelog-invalid");

		const auth = await AuthStorage.create(getAgentDbPath(profile.agentDir));
		await auth.reload();
		const credentials = auth.listStoredCredentials("openai-codex");
		auth.close();
		if (credentials.length !== 6 || credentials.some(entry => entry.credential.type !== "oauth"))
			throw new Error("Read-only reports changed isolated stored credentials");
		const usageRequests = providerRequests.filter(request => request.path === "/wham/usage");
		if (usageRequests.length !== 6)
			throw new Error(`Expected six scoped usage requests, observed ${usageRequests.length}`);
		if (reportPosts().length !== 10)
			throw new Error(`Expected ten isolated provider attempts, observed ${reportPosts().length}`);
		const reopened = await SessionManager.open(reportsSessionFile);
		const reopenedEntries = JSON.stringify(reopened.getEntries());
		await reopened.close();
		if (
			!reopenedEntries.includes("Synthetic reports and conversation fixture") ||
			!reopenedEntries.includes("media_0123456789abcdef01234567") ||
			!reopenedEntries.includes("Write the isolated main conversation response") ||
			!reopenedEntries.includes("Synthetic main conversation response.") ||
			reopenedEntries.includes("Is this side answer ephemeral?") ||
			reopenedEntries.includes("Synthetic side answer")
		)
			throw new Error("Reopened reports session did not preserve main-versus-ephemeral transcript boundaries");
		persistence = {
			storedCredentialsUnchanged: credentials.length,
			usageRequests,
			jobsState: "empty current session",
			usageOverflowPages: usagePages,
			fullChangelogPagingExercised: true,
			hotkeyOverflowPages: hotkeyPages,
			readOnlyReportsCreatedNoReview: true,
			mediaControlsChangedSessionBytes: false,
			btwRequestsChangedTranscript: false,
			btwRequests: 4,
			mainConversationRequests: 1,
			mainConversationReopened: true,
			debugReportCancelCreatedNoArchive: true,
			debugReportArchive: {
				count: archives.length,
				size: archiveStat.size,
				containsSession: true,
				containsSystemInfo: true,
			},
			providerRequests,
		};
	} else if (publicationFixture) {
		if (!publicationSessionFile) throw new Error("Publication fixture session was not seeded");
		const destination = join(profile.cwd, "publication export with spaces.html");
		const publisherFailure = profile.env.XCSH_UAT_SHARE_FAIL_FILE;
		const publisherLog = profile.env.XCSH_UAT_SHARE_LOG;
		const publishedOutput = profile.env.XCSH_UAT_SHARE_OUTPUT;
		const launcherFailure = profile.env.XCSH_UAT_OPEN_FAIL_FILE;
		const launcherLog = profile.env.XCSH_UAT_OPEN_LOG;
		if (!publisherFailure || !publisherLog || !publishedOutput || !launcherFailure || !launcherLog)
			throw new Error("Publication fixture paths are incomplete");
		const readNul = async (file: string) =>
			(await Bun.file(file).exists()) ? (await Bun.file(file).text()).split("\0").filter(Boolean) : [];
		const directoryExists = async (directory: string) => {
			try {
				await stat(directory);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
				throw error;
			}
		};
		const openShare = async () => {
			send("/share\r", "Review custom transcript publication");
			await wait(() => screen().includes("Review session publication"), "share review");
		};

		await Bun.write(publisherFailure, "fail\n");
		await openShare();
		await capture("share-review-cancel");
		if ((await readNul(publisherLog)).length !== 0 || (await Bun.file(publishedOutput).exists()))
			throw new Error("Share mutated before review");
		send("\r", "Cancel publication from the initially selected action");
		await wait(() => !screen().includes("Review session publication"), "cancelled share");
		if ((await readNul(publisherLog)).length !== 0 || (await Bun.file(publishedOutput).exists()))
			throw new Error("Cancelled share invoked the publisher");

		await openShare();
		send("\x1b[B\r", "Confirm publication with an injected publisher failure");
		await wait(
			() => screen().includes("Unresolved session publication") && screen().includes("Synthetic publisher failure"),
			"share failure",
		);
		await capture("share-failed");
		const failedShareAttempts = await readNul(publisherLog);
		if (failedShareAttempts.length !== 1) throw new Error("Failed publication did not invoke the publisher once");
		if (await directoryExists(dirname(failedShareAttempts[0]!)))
			throw new Error("Failed publication retained its staging directory");
		await rm(publisherFailure, { force: true });
		send("\x1b[B", "Select retry for the unresolved publication");
		await wait(() => /[❯>] Retry change/u.test(screen()), "selected share retry");
		send("\r", "Retry only the unresolved publication");
		await wait(
			() =>
				!screen().includes("Review session publication") &&
				screen().includes("Share URL: https://share.invalid/disposable-result") &&
				screen().includes("Disposable publisher completed"),
			"share retry success",
		);
		await capture("share-succeeded", true);
		const shareAttempts = await readNul(publisherLog);
		if (shareAttempts.length !== 2) throw new Error("Publication retry did not preserve one attempt per execution");
		if ((await Promise.all(shareAttempts.map(source => directoryExists(dirname(source))))).some(Boolean))
			throw new Error("Publication retained a staging directory");
		const publishedHtml = await Bun.file(publishedOutput).text();
		const publishedData = publishedHtml.match(
			/<script id="session-data" type="application\/json">([^<]+)<\/script>/,
		)?.[1];
		if (!publishedData || !Buffer.from(publishedData, "base64").toString().includes(exportMessage))
			throw new Error("Publisher did not receive the current transcript");
		if ((await readNul(launcherLog)).length !== 0) throw new Error("Returned share URL was opened automatically");

		const openLinkReview = async (expected: string) => {
			send("/open\r", "Review the exact latest transcript link");
			await wait(() => screen().includes("Review external link") && screen().includes(expected), "open-link review");
		};
		await openLinkReview("https://example.test/original-before-review");
		await capture("open-review-cancel");
		send("\r", "Cancel browser navigation from the initially selected action");
		await wait(() => !screen().includes("Review external link"), "cancelled open-link review");
		if ((await readNul(launcherLog)).length !== 0) throw new Error("Cancelled /open invoked the launcher");

		send("/uat-schedule-link\r", "Schedule an in-memory latest-link change through the isolated extension");
		await wait(() => screen().includes("Scheduled disposable link update"), "scheduled link update");
		await openLinkReview("https://example.test/original-before-review");
		await Bun.sleep(900);
		send("\x1b[B\r", "Confirm after the latest transcript link changes");
		await wait(
			() =>
				screen().includes("The proposal changed.") &&
				screen().includes("https://example.test/changed-after-review"),
			"renewed stale link review",
		);
		await capture("open-stale-renewed");
		if ((await readNul(launcherLog)).length !== 0) throw new Error("Stale /open launched the unreviewed target");
		send("\r", "Cancel the renewed link proposal");
		await wait(() => !screen().includes("Review external link"), "cancelled renewed link review");

		await openLinkReview("https://example.test/changed-after-review");
		send("\x1b[B\r", "Confirm exact browser navigation with the fake launcher");
		await wait(
			() => !screen().includes("Review external link") && screen().includes("Opened latest transcript link."),
			"open success",
		);
		await capture("open-succeeded", true);
		if ((await readNul(launcherLog)).at(-1) !== "https://example.test/changed-after-review")
			throw new Error("Fake launcher did not receive the exact reviewed link");

		await Bun.write(launcherFailure, "fail\n");
		await openLinkReview("https://example.test/changed-after-review");
		send("\x1b[B\r", "Confirm browser navigation with an injected launcher failure");
		await wait(
			() => screen().includes("Unresolved external link") && screen().includes("Synthetic launcher failure"),
			"open launcher failure",
		);
		await capture("open-launcher-failed");
		await rm(launcherFailure, { force: true });
		send("\x1b[B", "Select retry for the unresolved browser launch");
		await wait(() => /[❯>] Retry change/u.test(screen()), "selected open retry");
		send("\r", "Retry only the unresolved browser launch");
		await wait(
			() => !screen().includes("Review external link") && screen().includes("Opened latest transcript link."),
			"open retry",
		);
		await capture("open-retry-succeeded", true);

		const openExportReview = async () => {
			send(`/export "${destination}"\r`, "Review the exact local export destination");
			await wait(() => screen().includes("Review session export"), "publication export review");
		};
		await openExportReview();
		await capture("export-review-cancel");
		send("\r", "Cancel export before any local write or launch");
		await wait(() => !screen().includes("Review session export"), "cancelled publication export");
		if (await Bun.file(destination).exists()) throw new Error("Cancelled export wrote output");

		await Bun.write(launcherFailure, "fail\n");
		await openExportReview();
		send("\x1b[B\r", "Save the export while the isolated launcher fails");
		await wait(
			() =>
				!screen().includes("Review session export") && screen().includes("Export saved but automatic open failed"),
			"saved export with failed automatic open",
		);
		await capture("export-saved-open-failed", true);
		const html = await Bun.file(destination).text();
		const exportedData = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		if (!exportedData || !Buffer.from(exportedData, "base64").toString().includes(exportMessage))
			throw new Error("Saved export omitted the synthetic conversation");
		if (((await stat(destination)).mode & 0o777) !== 0o600) throw new Error("Saved export permissions are not 0600");
		const savedStat = await stat(destination);
		await rm(launcherFailure, { force: true });
		await openExportReview();
		await capture("export-unchanged-review");
		send("\x1b[B\r", "Confirm identical export and retry only automatic opening");
		await wait(
			() => !screen().includes("Review session export") && screen().includes("Session exported to:"),
			"unchanged export opened successfully",
		);
		await capture("export-open-succeeded", true);
		const unchangedStat = await stat(destination);
		if (
			unchangedStat.ino !== savedStat.ino ||
			unchangedStat.mtimeMs !== savedStat.mtimeMs ||
			(await Bun.file(destination).text()) !== html
		)
			throw new Error("Identical export rewrote its destination");

		await openExportReview();
		await Bun.write(destination, "Synthetic concurrent export replacement");
		send("\x1b[B\r", "Confirm after the export destination changes");
		await wait(() => screen().includes("The proposal changed."), "renewed stale export review");
		await capture("export-stale-renewed");
		send("\r", "Cancel the renewed export proposal");
		await wait(() => !screen().includes("Review session export"), "cancelled renewed export");
		if ((await Bun.file(destination).text()) !== "Synthetic concurrent export replacement")
			throw new Error("Stale export overwrote concurrent bytes");

		const reopened = await SessionManager.open(publicationSessionFile);
		const reopenedText = reopened
			.getBranch()
			.map(entry => JSON.stringify(entry))
			.join("\n");
		await reopened.close();
		if (!reopenedText.includes(exportMessage) || !reopenedText.includes("original-before-review"))
			throw new Error("Publication fixture session did not survive independent reopen");
		const launcherAttempts = await readNul(launcherLog);
		persistence = {
			shareCancelMadeNoAttempt: true,
			shareAttempts: shareAttempts.length,
			shareFailureRetriedOnce: true,
			shareStagingRemoved: true,
			shareUrlDisplayedWithoutAutomaticOpen: true,
			openCancelMadeNoAttempt: true,
			openStaleTargetRenewed: true,
			openFailureRetriedOnce: true,
			launcherAttempts,
			exportSavedBeforeOpenFailure: true,
			exportPermissions: "0600",
			exportNoopPreservedInodeMtimeAndBytes: true,
			exportStaleCancellationPreservedConcurrentBytes: true,
			sessionReopenedUnchanged: true,
			providerRequests,
		};
	} else if (exportFixture) {
		const destination = join(profile.cwd, "export with spaces.html");
		const file = Bun.file(destination);
		const openerLog = Bun.file(profile.env.XCSH_UAT_OPEN_LOG);
		const openerAttempts = async () => {
			const currentLog = Bun.file(profile.env.XCSH_UAT_OPEN_LOG);
			return (await currentLog.exists()) ? (await currentLog.text()).split("\0").filter(Boolean) : [];
		};
		const openReview = async () => {
			send(`/export "${destination}"\r`, "Review quoted local HTML export destination");
			await wait(() => screen().includes("Review session export"), "export review");
		};
		const inspectReviewPages = async (name: string) => {
			let pages = 0;
			while (!screen().includes("publication.")) {
				if (!screen().includes("review details") || pages >= 20)
					throw new Error("Export consequences are unreachable");
				const before = screen();
				send("\x1b[6~", "Page down through export consequences");
				await wait(() => screen() !== before, "next export details page");
				await capture(`${name}-paged-${++pages}`);
			}
			for (let page = 0; page < pages; page++) {
				const before = screen();
				send("\x1b[5~", "Page up restores the export proposal");
				await wait(() => screen() !== before, "previous export details page");
			}
			if (!screen().includes("Target: session-export:")) throw new Error("Export paging lost its target");
		};
		await openReview();
		await capture("export-review");
		await inspectReviewPages("export-review");
		if (await file.exists()) throw new Error("Export wrote before review");
		if (await openerLog.exists()) throw new Error("Export opened a browser before review");
		send("\r", "Initially selected Cancel leaves destination absent");
		await wait(() => !screen().includes("Review session export"), "cancelled export");
		if (await file.exists()) throw new Error("Cancelled export wrote output");
		await openReview();
		send("\x1b[B\r", "Confirm the reviewed export");
		await wait(
			() => !screen().includes("Review session export") && screen().includes("Session exported to:"),
			"export success",
		);
		await capture("export-saved");
		// Reopen after the atomic rename; do not reuse a BunFile created while absent.
		const html = await Bun.file(destination).text();
		const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		if (!encoded || !Buffer.from(encoded, "base64").toString().includes(exportMessage))
			throw new Error("Written HTML does not contain the seeded conversation");
		if (((await stat(destination)).mode & 0o777) !== 0o600) throw new Error("Export permissions differ from review");
		const logDeadline = performance.now() + 5000;
		while (!(await openerLog.exists()) && performance.now() < logDeadline) await Bun.sleep(25);
		if ((await Bun.file(profile.env.XCSH_UAT_OPEN_LOG).text()) !== `${destination}\0`)
			throw new Error("Isolated opener received the wrong destination");
		const savedStat = await stat(destination);
		await openReview();
		await capture("export-unchanged-review");
		await inspectReviewPages("export-unchanged-review");
		const attemptsBeforeUnchangedExport = await openerAttempts();
		send("\x1b[B\r", "Confirm identical export without rewriting matching output");
		await wait(
			async () =>
				!screen().includes("Review session export") &&
				(await openerAttempts()).length === attemptsBeforeUnchangedExport.length + 1,
			"unchanged export complete and opener settlement",
		);
		const unchangedStat = await stat(destination);
		if (
			unchangedStat.ino !== savedStat.ino ||
			unchangedStat.mtimeMs !== savedStat.mtimeMs ||
			(await Bun.file(destination).text()) !== html
		)
			throw new Error("Identical export rewrote its destination");
		await openReview();
		await Bun.write(destination, "Synthetic concurrent destination change");
		send("\x1b[B\r", "Confirm stale export proposal after an independent destination change");
		await wait(() => screen().includes("The proposal changed."), "renewed export review");
		await capture("export-stale-review");
		await inspectReviewPages("export-stale-review");
		send("\r", "Renewed review initially selects Cancel");
		await wait(() => !screen().includes("Review session export"), "cancelled stale export");
		if ((await Bun.file(destination).text()) !== "Synthetic concurrent destination change")
			throw new Error("Stale export overwrote the independent destination change");
		persistence = {
			destination,
			cancelledOutputAbsent: true,
			decodedConversationVerified: true,
			permissions: "0600",
			unchangedInodeMtimeAndBytesPreserved: true,
			staleReviewCancellationPreservedConcurrentBytes: true,
			opener: "isolated literal-argument recorder; no browser launched",
			providerRequests,
		};
	} else if (copyFixture) {
		if (!copySessionFile) throw new Error("Copy fixture session was not seeded");
		const sessionBefore = await Bun.file(copySessionFile).text();
		const clipboardReads: Record<string, string> = {};
		const inspectClipboardReviewPages = async (name: string) => {
			if (!screen().includes("review details") || screen().includes("Linux: clipboard text may disappear")) return;
			let pages = 0;
			while (!screen().includes("Linux: clipboard text may disappear")) {
				if (pages >= 20) throw new Error(`${name} consequences are unreachable`);
				const before = screen();
				send("\x1b[6~", `Page down through ${name} consequences`);
				await wait(() => screen() !== before, `${name} next review page`);
				await capture(`${name}-paged-${++pages}`);
			}
			for (let page = 0; page < pages; page++) {
				const before = screen();
				send("\x1b[5~", `Page up restores ${name} review target`);
				await wait(() => screen() !== before, `${name} previous review page`);
			}
			if (!screen().includes("Target:")) throw new Error(`${name} paging lost its target`);
		};
		const reviewTypedCopy = async (
			subcommand: "last" | "code" | "all" | "cmd" | "link",
			expected: string,
			cancelFirst = false,
		) => {
			const sentinel = `${clipboardSentinel}-${subcommand}`;
			await writeClipboard(sentinel);
			if (readClipboard() !== sentinel) throw new Error(`Could not seed clipboard for /copy ${subcommand}`);
			const openReview = async () => {
				send(`/copy ${subcommand}\r`, `Review /copy ${subcommand}`);
				await wait(() => screen().includes("Review clipboard copy"), `/copy ${subcommand} review`);
				if (readClipboard() !== sentinel) throw new Error(`/copy ${subcommand} mutated before confirmation`);
			};
			await openReview();
			await capture(`copy-${subcommand}-review`);
			if (subcommand === "last") await inspectClipboardReviewPages("copy-last-review");
			if (cancelFirst) {
				send("\r", `Cancel /copy ${subcommand} from the initially selected action`);
				await wait(() => !screen().includes("Review clipboard copy"), `cancelled /copy ${subcommand}`);
				if (readClipboard() !== sentinel) throw new Error(`/copy ${subcommand} Cancel changed clipboard`);
				await openReview();
			}
			send("\x1b[B\r", `Confirm /copy ${subcommand}`);
			await wait(
				() =>
					!screen().includes("Review clipboard copy") &&
					screen().includes("copied to the local") &&
					screen().includes("clipboard."),
				`/copy ${subcommand} success`,
			);
			const observed = readClipboard();
			if (observed !== expected)
				throw new Error(`/copy ${subcommand} readback mismatch: ${JSON.stringify(observed)}`);
			clipboardReads[`copy-${subcommand}`] = observed;
			await capture(`copy-${subcommand}-copied`, true);
		};
		await reviewTypedCopy("last", copyAssistantText, true);
		await reviewTypedCopy("code", "second copied block");
		await reviewTypedCopy("all", "first copied block\n\nsecond copied block");
		await reviewTypedCopy("cmd", copyCommand);
		await reviewTypedCopy("link", "https://example.test/copy-target");

		await writeClipboard(`${clipboardSentinel}-selector`);
		send("/copy\r", "Open the transcript copy selector");
		await wait(() => screen().includes("Copy transcript") && screen().includes("Search: >"), "copy selector");
		await capture("copy-selector-browse");
		send("\x1b[200~assistant\x1b[201~", "Bracketed paste into transcript search");
		await wait(() => screen().includes("Search: > assistant"), "copy selector search");
		await capture("copy-selector-search");
		send("\x1b", "First Escape clears transcript search");
		await wait(
			() => screen().includes("Copy transcript") && !screen().includes("Search: > assistant"),
			"cleared copy selector search",
		);
		const userRow = screen()
			.split("\n")
			.findIndex(line => line.includes("user message"));
		if (userRow < 0) throw new Error("Could not locate visible user copy target");
		send(`\x1b[<0;4;${userRow + 1}M`, "Mouse opens the named user transcript target");
		await wait(() => screen().includes("Copy transcript · user message"), "user copy actions");
		await capture("copy-selector-user-actions");
		send("\x03", "Ctrl+C does not act as Back in copy actions");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Copy transcript · user message")) throw new Error("Ctrl+C closed copy actions");
		send("\x1b", "Escape returns from copy actions to transcript browsing");
		await Bun.sleep(250);
		await writes;
		if (screen().includes("Copy transcript · user message"))
			send("\x1b", "Repeat Escape after the PTY left the first lone Escape undelivered");
		await wait(
			() => screen().includes("Copy transcript") && !screen().includes("Copy transcript · user message"),
			"copy target browser",
		);
		const browseUserRow = screen()
			.split("\n")
			.findIndex(line => /[❯>]\s+user message/u.test(line));
		if (browseUserRow < 0) throw new Error("User target selection was not preserved after Back");
		send(`\x1b[<65;4;${browseUserRow + 1}M`, "Mouse wheel moves selection to the assistant target");
		await wait(() => /[❯>]\s+assistant/u.test(screen()), "wheel-selected assistant target");
		await capture("copy-selector-wheel-selection");
		send("\r", "Enter opens the named assistant target actions");
		await wait(() => screen().includes("Copy transcript · assistant message"), "assistant copy actions");
		send("\r", "Open Cancel-first selector copy review");
		await wait(() => screen().includes("Review clipboard copy"), "selector copy review");
		await capture("copy-selector-review");
		if (readClipboard() !== `${clipboardSentinel}-selector`) throw new Error("Selector copied before review");
		send("\r", "Cancel selector copy while preserving parent action context");
		await wait(() => screen().includes("Copy transcript · assistant message"), "selector context after Cancel");
		if (readClipboard() !== `${clipboardSentinel}-selector`) throw new Error("Selector Cancel changed clipboard");
		send("\r", "Reopen selector copy review from preserved action");
		await wait(() => screen().includes("Review clipboard copy"), "second selector copy review");
		send("\x1b[B\r", "Confirm selector copy");
		await wait(
			() =>
				!screen().includes("Copy transcript") &&
				screen().includes("copied to the local") &&
				screen().includes("clipboard."),
			"selector copy success",
		);
		if (readClipboard() !== copyAssistantText) throw new Error("Selector clipboard readback mismatch");
		clipboardReads["copy-selector"] = copyAssistantText;
		await capture("copy-selector-copied", true);

		await writeClipboard(`${clipboardSentinel}-dump`);
		const openDumpReview = async () => {
			send("/dump\r", "Review /dump conversation copy");
			await wait(() => screen().includes("Review conversation copy"), "/dump review");
			if (readClipboard() !== `${clipboardSentinel}-dump`) throw new Error("/dump mutated before confirmation");
		};
		await openDumpReview();
		await capture("dump-review");
		await inspectClipboardReviewPages("dump-review");
		send("\r", "Cancel /dump from the initially selected action");
		await wait(() => !screen().includes("Review conversation copy"), "cancelled /dump");
		if (readClipboard() !== `${clipboardSentinel}-dump`) throw new Error("/dump Cancel changed clipboard");
		await openDumpReview();
		send("\x1b[B\r", "Confirm /dump conversation copy");
		await wait(
			() => !screen().includes("Review conversation copy") && screen().includes("Conversation copied"),
			"/dump success",
		);
		const dumped = readClipboard();
		if (![copyUserMessage, copyAssistantText, copyCommand].every(value => dumped.includes(value)))
			throw new Error("/dump readback does not contain the complete seeded conversation");
		clipboardReads.dump = createHash("sha256").update(dumped).digest("hex");
		await capture("dump-copied", true);
		if ((await Bun.file(copySessionFile).text()) !== sessionBefore)
			throw new Error("Clipboard-only commands changed persisted session bytes");
		const reopened = await SessionManager.open(copySessionFile);
		const reopenedEntries = JSON.stringify(reopened.getEntries());
		await reopened.close();
		if (
			![copyUserMessage, copyAssistantText, copyCommand].every(value =>
				reopenedEntries.includes(JSON.stringify(value).slice(1, -1)),
			)
		)
			throw new Error("Reopened copy fixture session content changed");
		persistence = {
			isolatedXvfb: true,
			independentReader: "xclip -selection clipboard -out",
			cancelledLastUnchanged: true,
			cancelledSelectorUnchanged: true,
			cancelledDumpUnchanged: true,
			noMutationBeforeReview: true,
			sessionBytesUnchanged: true,
			reopenedSessionTextUnchanged: true,
			clipboardReads,
			providerRequests,
		};
	} else if (compactFixture) {
		if (!compactSessionFile) throw new Error("Compaction fixture session was not seeded");
		const originalBytes = await Bun.file(compactSessionFile).text();
		const postCount = () =>
			providerRequests.filter(request => request.method === "POST" && request.path === "/v1/messages").length;
		const openCompactReview = async () => {
			send("/compact Preserve synthetic decisions\r", "Review typed manual compaction instructions");
			await wait(() => screen().includes("Review session compaction"), "manual compaction review");
		};
		await openCompactReview();
		await capture("compact-review");
		let compactReviewPages = 0;
		while (!screen().includes("remains navigation-only")) {
			if (!screen().includes("review details") || compactReviewPages >= 12)
				throw new Error("Manual compaction consequences are unreachable");
			const previous = screen();
			send("\x1b[6~", "Page down through compaction consequences");
			await wait(() => screen() !== previous, "next compaction review page");
			await capture(`compact-review-paged-${++compactReviewPages}`);
		}
		for (let page = 0; page < compactReviewPages; page++) {
			const previous = screen();
			send("\x1b[5~", "Page up restores the compaction target");
			await wait(() => screen() !== previous, "previous compaction review page");
		}
		if (!screen().includes("Target: session-compaction:"))
			throw new Error("Compaction review paging lost its target");
		if ((await Bun.file(compactSessionFile).text()) !== originalBytes || postCount() !== 0)
			throw new Error("Manual compaction mutated before confirmation");
		send("\r", "Cancel manual compaction from the initially selected action");
		await wait(() => !screen().includes("Review session compaction"), "cancelled manual compaction");
		if ((await Bun.file(compactSessionFile).text()) !== originalBytes || postCount() !== 0)
			throw new Error("Cancelled compaction changed the session or called the provider");

		await openCompactReview();
		send("\x1b[B\r", "Start the reviewed compaction");
		await wait(() => screen().includes("Applying session compaction"), "running manual compaction");
		await capture("compact-progress", false, 0);
		send("\x1b", "Escape during compaction remains navigation-only");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Applying session compaction")) throw new Error("Escape interrupted manual compaction");
		send("\x03", "Ctrl+C requests compaction interruption");
		await wait(() => screen().includes("Compaction interrupted; no summary was saved."), "compaction interruption");
		await capture("compact-interrupted");
		if ((await Bun.file(compactSessionFile).text()) !== originalBytes)
			throw new Error("Interrupted compaction changed persisted session bytes");

		await openCompactReview();
		send("\x1b[B\r", "Confirm manual compaction without interrupting it");
		await wait(() => screen().includes("Session context compacted and saved."), "saved manual compaction");
		await capture("compact-saved", true);
		const savedBytes = await Bun.file(compactSessionFile).text();
		if (savedBytes === originalBytes) throw new Error("Successful compaction did not persist a session change");
		const reopened = await SessionManager.open(compactSessionFile);
		const compacted = reopened.getEntries().filter(entry => entry.type === "compaction");
		if (compacted.length !== 1 || !JSON.stringify(compacted[0]).includes("Synthetic planning continued"))
			throw new Error("Reopened session does not contain exactly one fake-provider compaction summary");
		await reopened.close();
		const postsAfterSuccess = postCount();
		send("/compact\r", "Request compaction of an already-compacted leaf");
		await wait(() => screen().includes("Session is already compacted; nothing changed."), "compaction no-op");
		await capture("compact-noop", true);
		if ((await Bun.file(compactSessionFile).text()) !== savedBytes || postCount() !== postsAfterSuccess)
			throw new Error("Already-compacted no-op changed bytes or called the provider");
		persistence = {
			file: compactSessionFile,
			cancelledBytesUnchanged: true,
			cancelledProviderRequests: 0,
			interruptedBytesUnchanged: true,
			escapeDidNotInterrupt: true,
			ctrlCInterrupted: true,
			compactionEntries: compacted.length,
			reopenedSummaryVerified: true,
			noopBytesAndProviderRequestsUnchanged: true,
			providerRequests,
		};
	} else if (reloadPluginsFixture) {
		const commandDir = join(profile.cwd, ".xcsh", "commands");
		const commandFile = join(commandDir, "synthetic-reloaded.md");
		await mkdir(commandDir, { recursive: true });
		await Bun.write(
			commandFile,
			"---\ndescription: Synthetic command discovered only after metadata refresh\n---\nReport a synthetic refreshed command.\n",
		);
		const commandBytes = await Bun.file(commandFile).text();
		send("/reload-plugins\r", "Refresh plugin and slash-command metadata from the isolated project");
		await wait(() => screen().includes("Plugin metadata refreshed."), "plugin metadata refresh completion");
		await capture("reload-plugins-completed");
		if (!/were not\s+restarted\./.test(screen()))
			throw new Error("Refresh completion did not distinguish metadata from process restart");
		send("/synthetic-rel", "Search newly discovered project command after refresh");
		await wait(
			() =>
				screen().includes("synthetic-reloaded") &&
				screen().includes("Prompt expansion") &&
				screen().includes("project scope"),
			"newly discovered command autocomplete",
		);
		await capture("reload-plugins-command-discovered", true);
		if ((await Bun.file(commandFile).text()) !== commandBytes)
			throw new Error("Metadata refresh changed the project command source");
		send("\x1b", "Close refreshed command autocomplete");
		send("\x7f".repeat("/synthetic-rel".length), "Clear refreshed command query");
		persistence = {
			commandFile,
			commandSourceBytesUnchanged: true,
			newCommandDiscoveredAfterRefresh: true,
			refreshVersusRestartExplicit: true,
			providerRequests,
		};
	} else if (backgroundFixture) {
		const postCount = () =>
			providerRequests.filter(request => request.method === "POST" && request.path === "/v1/messages").length;
		send("Continue synthetic work long enough to transfer it\r", "Start one delayed synthetic response");
		await wait(() => postCount() === 1 && screen().includes("Ctrl+C"), "active response before background transfer");
		await capture("background-active", false, 0);
		send("/background\r", "Transfer the active response to shell-managed background execution");
		await wait(
			() => stream.includes("Background transfer started for session") && screen().includes("xcsh-UAT-SHELL>"),
			"stopped background candidate and returned shell",
		);
		await capture("background-suspended");
		if (
			!stream.includes("will continue in this process; nothing was cancelled") ||
			!stream.includes("run `bg` to continue headlessly, or `fg` to wait for completion") ||
			!stream.includes("use `/jobs` to inspect async tool jobs")
		)
			throw new Error("Background transfer did not identify continuation, cancellation semantics and recovery");
		send("bg\r", "Resume the stopped candidate in the shell background");
		const sessionDir = join(profile.root, "sessions");
		let sessionFiles: string[] = [];
		await wait(() => {
			sessionFiles = [...new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir })];
			if (sessionFiles.length !== 1) return false;
			return Bun.file(join(sessionDir, sessionFiles[0]))
				.text()
				.then(text => text.includes("Synthetic planning continued."));
		}, "background response persistence");
		await wait(() => /\+\s+done\s+'/u.test(stream.toLowerCase()), "background process completion");
		await capture("background-completed", true);
		const sessionFile = join(sessionDir, sessionFiles[0]);
		const reopened = await SessionManager.open(sessionFile);
		const entries = JSON.stringify(reopened.getEntries());
		await reopened.close();
		if (!entries.includes("Synthetic planning continued."))
			throw new Error("Reopened background session lacks the completed response");
		persistence = {
			sessionFile,
			providerPosts: postCount(),
			stableSessionIdentified: true,
			nothingCancelledClaimVerified: true,
			posixStopAndBgResumeVerified: true,
			reopenedCompletedResponse: true,
			providerRequests,
		};
	} else if (exitFixture) {
		const postCount = () =>
			providerRequests.filter(request => request.method === "POST" && request.path === "/v1/messages").length;
		send("Continue synthetic work until reviewed exit\r", "Start one delayed response before exit review");
		await wait(() => postCount() === 1 && screen().includes("Ctrl+C"), "active response before exit review");
		await capture("exit-active", false, 0);
		if (!exitSessionFile) throw new Error("Missing seeded exit session path");
		const sessionFile = exitSessionFile;
		const activeBytes = await Bun.file(sessionFile).text();

		send("/exit", "Type /exit while the response is active");
		await wait(() => screen().includes("/exit"), "/exit text in editor");
		send("\r", "Open outstanding-work review through /exit");
		await wait(() => screen().includes("Review exit session"), "/exit review");
		await capture("exit-review");
		if ((await Bun.file(sessionFile).text()) !== activeBytes) throw new Error("Exit review changed session state");
		send("\r", "Initially selected Cancel keeps the response running");
		await wait(
			() => !screen().includes("Review exit session") && screen().includes("Ctrl+C"),
			"cancelled exit review",
		);
		if ((await Bun.file(sessionFile).text()) !== activeBytes)
			throw new Error("Cancelled exit review changed session state");
		await capture("exit-cancelled", false, 0);

		send("/quit", "Type /quit while the response is active");
		await wait(() => screen().includes("/quit"), "/quit text in editor");
		send("\r", "Open the same outstanding-work review through /quit");
		await wait(() => screen().includes("Review exit session"), "/quit review");
		await capture("quit-review");
		if ((await Bun.file(sessionFile).text()) !== activeBytes)
			throw new Error("Quit alias review changed session before confirmation");
		send("\x1b[B\r", "Confirm interrupt, settlement and exit");
		await wait(
			async () =>
				(await Bun.file(candidateExitStatus).exists()) &&
				(await Bun.file(candidateExitStatus).text()).trim() === "0",
			"clean candidate exit status",
		);
		const reopened = await SessionManager.open(sessionFile);
		const entries = reopened.getEntries();
		await reopened.close();
		if (!JSON.stringify(entries).includes("Continue synthetic work until reviewed exit"))
			throw new Error("Reviewed exit did not retain the submitted user message");
		persistence = {
			sessionFile,
			providerPosts: postCount(),
			noWriteBeforeReview: true,
			cancelLeftBytesUnchanged: true,
			exitAndQuitSharedReview: true,
			confirmedExitCode: 0,
			reopenedSubmittedMessage: true,
			providerRequests,
		};
	} else if (planFixture) {
		const sessionDir = join(profile.root, "sessions");
		const sessionFiles = () => [...new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir })];
		const requireNoSessionWrite = () => {
			if (sessionFiles().length) throw new Error("Plan choice or Cancel wrote session state");
		};
		const openPlanChoice = async (label: string) => {
			send("/plan\r", label);
			await wait(
				() => screen().includes("Enable plan mode") || screen().includes("Pause plan mode without approval"),
				"plan choices",
			);
		};
		const openPlanReview = async () => {
			send("\x1b[B\r", "Choose the explicitly labeled plan mode action");
			await wait(() => screen().includes("Review plan mode"), "plan mode review");
		};
		requireNoSessionWrite();
		await openPlanChoice("Open plan mode choices");
		await capture("plan-choices");
		requireNoSessionWrite();
		send("\r", "Initially selected Cancel leaves plan mode unchanged");
		await wait(() => !screen().includes("Enable plan mode"), "cancelled plan choices");
		requireNoSessionWrite();
		await openPlanChoice("Reopen plan mode choices");
		await openPlanReview();
		await capture("plan-enable-review");
		if (screen().includes("review details")) {
			send("\x1b[6~", "Page down to reach all plan review consequences");
			await wait(() => screen().includes("costs"), "plan cost consequence");
			await capture("plan-enable-review-paged");
			send("\x1b[5~", "Page up restores the reviewed plan target");
			await wait(() => screen().includes("Target: plan-mode:"), "plan review first page");
		}
		requireNoSessionWrite();
		send("\r", "Cancel plan enable review");
		await wait(() => !screen().includes("Review plan mode"), "cancelled plan review");
		requireNoSessionWrite();
		await openPlanChoice("Reopen plan enable after cancellation");
		await openPlanReview();
		send("\x1b[B\r", "Confirm enabling plan mode");
		await wait(() => screen().includes("Plan mode enabled and saved."), "saved plan mode");
		await capture("plan-enabled");
		const files = sessionFiles();
		if (files.length !== 1) throw new Error("Plan enable did not save exactly one session");
		const file = join(sessionDir, files[0]);
		const enabledBytes = await Bun.file(file).text();
		const enabled = await SessionManager.open(file);
		if (enabled.buildSessionContext().mode !== "plan") throw new Error("Reopened session is not in plan mode");
		await enabled.close();
		await openPlanChoice("Open explicit pause choice");
		await openPlanReview();
		await capture("plan-pause-review");
		if (screen().includes("review details")) {
			send("\x1b[6~", "Page down to reach pause consequences");
			await wait(() => screen().includes("costs"), "pause cost consequence");
			await capture("plan-pause-review-paged");
			send("\x1b[5~", "Page up restores the pause target");
			await wait(() => screen().includes("Target: plan-mode:"), "pause target restored");
		}
		if ((await Bun.file(file).text()) !== enabledBytes) throw new Error("Pause review changed persisted session");
		send("\r", "Cancel pause review");
		await wait(() => !screen().includes("Review plan mode"), "cancelled pause review");
		if ((await Bun.file(file).text()) !== enabledBytes) throw new Error("Cancelled pause changed persisted session");
		await openPlanChoice("Reopen pause after cancellation");
		await openPlanReview();
		send("\x1b[B\r", "Confirm pausing plan mode without approval");
		await wait(() => screen().includes("Plan mode paused and saved."), "saved paused plan mode");
		await capture("plan-paused");
		const paused = await SessionManager.open(file);
		const modes = paused
			.getEntries()
			.filter(entry => entry.type === "mode_change")
			.map(entry => entry.mode);
		if (
			paused.buildSessionContext().mode !== "plan_paused" ||
			JSON.stringify(modes) !== JSON.stringify(["plan", "plan_paused"])
		)
			throw new Error("Reopened session does not contain exactly the reviewed plan transitions");
		await paused.close();

		await openPlanChoice("Reopen plan mode for approval workflow");
		await openPlanReview();
		send("\x1b[B\r", "Confirm enabling plan mode for approval workflow");
		await wait(() => screen().includes("Plan mode enabled and saved."), "plan mode re-enabled for approval");
		const activePromptBytes = await Bun.file(file).text();
		const planPostCount = () =>
			providerRequests.filter(request => request.method === "POST" && request.path === "/v1/messages").length;
		const postsBeforeTypedPrompt = planPostCount();
		const openTypedPromptReview = async (label: string) => {
			send(`/plan ${typedPlanningPrompt}\r`, label);
			await wait(() => screen().includes("Review planning prompt"), "active plan-mode prompt review");
		};
		await openTypedPromptReview("Review a typed prompt while plan mode is already active");
		await capture("plan-active-prompt-review");
		if (screen().includes("review details")) {
			let pages = 0;
			while (!screen().includes("claimed complete") && pages < 12) {
				const before = screen();
				send("\x1b[6~", `Page down through active prompt consequences (${++pages})`);
				await wait(() => screen() !== before, `active prompt review page ${pages}`);
				await capture(`plan-active-prompt-review-paged-${pages}`);
			}
			if (!screen().includes("claimed complete")) throw new Error("Active prompt consequences remained unreachable");
			for (let page = 0; page < pages; page++) {
				const before = screen();
				send("\x1b[5~", `Page up restores the active prompt target (${page + 1})`);
				await wait(() => screen() !== before, `active prompt reverse page ${page + 1}`);
			}
			if (!(screen().includes("Target:") && screen().includes("plan-prompt:")))
				throw new Error("Active prompt target remained unreachable after reverse paging");
		}
		send("\r", "Cancel the typed planning prompt from the initially selected action");
		await wait(() => !screen().includes("Review planning prompt"), "cancelled active planning prompt");
		if ((await Bun.file(file).text()) !== activePromptBytes)
			throw new Error("Cancelled active planning prompt changed session bytes");
		if (planPostCount() !== postsBeforeTypedPrompt)
			throw new Error("Cancelled active planning prompt contacted the provider");
		await openTypedPromptReview("Review the active planning prompt again");
		send("\x1b[B\r", "Confirm the reviewed active planning prompt");
		await wait(
			() => screen().includes("Planning prompt queued in the active plan-mode session"),
			"active planning prompt queued",
		);
		await capture("plan-active-prompt-queued", false, 0);
		if (!screen().includes("Ctrl+C: interrupt") || screen().toLowerCase().includes("esc to interrupt"))
			throw new Error("Active work did not advertise the configured execution interrupt binding");
		send("\x1b", "Escape during active model work remains navigation-only");
		await wait(() => screen().includes("Synthetic planning continued."), "active planning completion");
		await capture("plan-active-prompt-completed", true);
		if (planPostCount() !== postsBeforeTypedPrompt + 1)
			throw new Error("Confirmed active planning prompt did not make exactly one provider request");
		const afterTypedPrompt = await SessionManager.open(file);
		if (
			afterTypedPrompt.buildSessionContext().mode !== "plan" ||
			!JSON.stringify(afterTypedPrompt.getEntries()).includes("Synthetic planning continued.")
		)
			throw new Error("Reopened session did not retain active plan mode and typed planning completion");
		await afterTypedPrompt.close();
		const approvalManager = await SessionManager.open(file);
		const planningSessionId = approvalManager.getSessionId();
		const planDraft = resolveLocalUrlToPath("local://PLAN.md", {
			getArtifactsDir: () => approvalManager.getArtifactsDir(),
			getSessionId: () => planningSessionId,
		});
		const approvedPlanningPlan = resolveLocalUrlToPath("local://SYNTHETIC_EXECUTION_PLAN.md", {
			getArtifactsDir: () => approvalManager.getArtifactsDir(),
			getSessionId: () => planningSessionId,
		});
		await Bun.write(planDraft, approvalPlanText);
		await approvalManager.close();

		const openApprovalChoice = async (label: string) => {
			send("Request approval of the prepared synthetic plan\r", label);
			await wait(() => screen().includes("Plan mode - next step"), "plan approval next-step choices");
		};
		await openApprovalChoice("Ask the local fake provider to request plan approval");
		await capture("plan-approval-choices");
		send("\x1b[A\x1b[A\r", "Open the explicitly labelled Approve and execute action");
		await wait(() => screen().includes("Review plan approval"), "plan approval review");
		await capture("plan-approval-review");
		if (screen().includes("review details")) {
			let page = 0;
			while (
				!screen().includes("configured remote services") &&
				!screen().includes("not interruptible") &&
				page < 12
			) {
				const previousPage = screen();
				page++;
				send("\x1b[6~", `Page down through plan approval consequences (${page})`);
				await wait(() => screen() !== previousPage, `plan approval page ${page}`);
				await capture(`plan-approval-review-paged-${page}`);
			}
			if (!screen().includes("configured remote services") && !screen().includes("not interruptible"))
				throw new Error("Plan approval consequence remained unreachable after paging");
			let pageUp = 0;
			while (!(screen().includes("Target:") && screen().includes("plan-approval:")) && pageUp < 12) {
				const previousPage = screen();
				pageUp++;
				send("\x1b[5~", `Page up restores the plan approval target (${pageUp})`);
				await wait(() => screen() !== previousPage, `plan approval reverse page ${pageUp}`);
			}
			if (!(screen().includes("Target:") && screen().includes("plan-approval:")))
				throw new Error("Plan approval target remained unreachable after reverse paging");
		}
		const beforeApprovalCancel = await Bun.file(file).text();
		send("\r", "Cancel plan approval from the initially selected action");
		await wait(() => !screen().includes("Review plan approval"), "cancelled plan approval");
		if ((await Bun.file(file).text()) !== beforeApprovalCancel)
			throw new Error("Cancelled plan approval changed planning-session bytes");
		if ((await Bun.file(planDraft).text()) !== approvalPlanText || (await Bun.file(approvedPlanningPlan).exists()))
			throw new Error("Cancelled plan approval changed plan artifacts");

		await openApprovalChoice("Request plan approval again after cancellation");
		send("\x1b[A\x1b[A\r", "Reopen Approve and execute");
		await wait(() => screen().includes("Review plan approval"), "second plan approval review");
		send("\x1b[B\r", "Confirm the reviewed plan execution transition");
		await wait(
			() => screen().includes("Approved plan saved and submitted in execution session"),
			"approved plan submitted",
		);
		await capture("plan-approval-submitted", true);
		const allSessionFiles = sessionFiles().map(name => join(sessionDir, name));
		if (allSessionFiles.length !== 2) throw new Error("Plan approval did not retain exactly two session files");
		const executionFile = allSessionFiles.find(candidate => candidate !== file);
		if (!executionFile) throw new Error("Plan approval did not create a distinct execution-session file");
		if ((await Bun.file(planDraft).exists()) || (await Bun.file(approvedPlanningPlan).text()) !== approvalPlanText)
			throw new Error("Planning-session approved plan was not finalized exactly");
		const executionManager = await SessionManager.open(executionFile);
		const executionSessionId = executionManager.getSessionId();
		const executionPlan = resolveLocalUrlToPath("local://SYNTHETIC_EXECUTION_PLAN.md", {
			getArtifactsDir: () => executionManager.getArtifactsDir(),
			getSessionId: () => executionSessionId,
		});
		if (
			(await Bun.file(executionPlan).text()) !== approvalPlanText ||
			executionManager.buildSessionContext().mode === "plan"
		)
			throw new Error("Reopened execution session does not contain the approved non-plan-mode state");
		const executionEntries = JSON.stringify(executionManager.getEntries());
		if (!executionEntries.includes("Synthetic execution accepted"))
			throw new Error("Reopened execution session does not contain the fake provider completion");
		await executionManager.close();
		const reopenedPlanning = await SessionManager.open(file);
		if (reopenedPlanning.buildSessionContext().mode === "plan")
			throw new Error("Reopened planning session still reports active plan mode after approval");
		await reopenedPlanning.close();
		persistence = {
			file,
			modes,
			cancelledEnableCreatedNoFile: true,
			cancelledPauseBytesUnchanged: true,
			cancelledActivePromptBytesUnchanged: true,
			cancelledActivePromptProviderRequestsUnchanged: true,
			activePromptKeptPlanMode: true,
			activePromptCompletionReopened: true,
			escapeDuringActivePromptDidNotInterrupt: true,
			cancelledApprovalBytesUnchanged: true,
			planningSessionId,
			executionSessionId,
			executionFile,
			approvedPlanInBothSessions: true,
			fakeExecutionCompletionReopened: true,
			providerRequests,
		};
	} else if (routeFixture) {
		const configPath = join(profile.agentDir, "config.yml");
		const readConfig = () => Bun.file(configPath).text();
		const inspectRouteReview = async (label: string, finalDetail: string) => {
			let pages = 0;
			while (!screen().includes(finalDetail)) {
				if (!screen().includes("review details") || pages >= 20)
					throw new Error(`${label} did not expose ${finalDetail}`);
				const previous = screen();
				send("\x1b[6~", `Page down through ${label}`);
				await wait(() => screen() !== previous, `${label} page ${pages + 2}`);
				await capture(`${label}-paged-${++pages}`);
			}
			for (let page = 0; page < pages; page++) {
				const previous = screen();
				send("\x1b[5~", `Page up to restore ${label}`);
				await wait(() => screen() !== previous, `${label} previous page`);
			}
		};
		const before = await readConfig();
		send("/route status\r", "Inspect saved and effective routing state before mutation");
		await wait(
			() => screen().includes("User routing mode: off") && screen().includes("Effective Routing Mode: off"),
			"initial routing status",
		);
		await capture("route-status-initial");
		send("/route auto\r", "Open routing mode review");
		await wait(() => screen().includes("Review routing mode"), "routing review");
		await capture("route-review");
		if ((await readConfig()) !== before) throw new Error("Routing review wrote settings before confirmation");
		send("\r", "Initially selected Cancel preserves configuration");
		await wait(() => !screen().includes("Review routing mode"), "cancelled routing review");
		if ((await readConfig()) !== before) throw new Error("Routing Cancel changed settings");
		send("/route auto\r", "Reopen routing mode review");
		await wait(() => screen().includes("Review routing mode"), "routing review again");
		send("\x1b[B\r", "Explicitly confirm routing auto");
		await wait(() => screen().includes("Saved routing mode: auto"), "routing saved");
		await capture("route-auto-saved");
		const saved = await readConfig();
		if ((Bun.YAML.parse(saved) as { routing?: { mode?: string } }).routing?.mode !== "auto")
			throw new Error("Routing file does not contain auto");
		send("/route auto\r", "Unchanged routing command does not write");
		await wait(() => screen().includes("Nothing changed."), "routing no-op");
		if ((await readConfig()) !== saved) throw new Error("Unchanged routing command changed configuration");

		const configBackup = join(profile.agentDir, "config-before-route-failure.yml");
		await rename(configPath, configBackup);
		await mkdir(configPath);
		send("/route off\r", "Review routing mode while the disposable settings destination is obstructed");
		await wait(() => screen().includes("Review routing mode"), "routing failure review");
		send("\x1b[B\r", "Confirm routing mode with an obstructed backing file");
		await wait(() => screen().includes("Unresolved routing mode"), "unresolved routing save");
		await capture("route-save-failure");
		send("\r", "Close the unresolved routing save without claiming success");
		await wait(() => !screen().includes("Unresolved routing mode"), "closed unresolved routing save");
		await rm(configPath, { recursive: true });
		await rename(configBackup, configPath);
		send("/route off\r", "Retry only the unresolved routing settings write");
		await wait(() => screen().includes("Review routing mode"), "routing save-only retry review");
		await capture("route-save-retry-review");
		await inspectRouteReview("route-save-retry-review", "Unresolved prior write");
		send("\x1b[B\r", "Confirm routing save-only retry");
		await wait(() => screen().includes("Saved routing mode: off"), "routing save-only retry success");
		await capture("route-off-saved");
		const offSaved = await readConfig();
		if ((Bun.YAML.parse(offSaved) as { routing?: { mode?: string } }).routing?.mode !== "off")
			throw new Error("Routing retry file does not contain off");

		send("/route shadow\r", "Review shadow routing mode");
		await wait(() => screen().includes("Review routing mode"), "shadow routing review");
		await capture("route-shadow-review");
		send("\x1b[B\r", "Confirm shadow routing mode");
		await wait(() => screen().includes("Saved routing mode: shadow"), "shadow routing saved");
		await capture("route-shadow-saved");

		send("/route profile anthropic\r", "Resolve the exact entitled routing profile");
		await wait(() => screen().includes("Resolving routing profile anthropic"), "routing profile loading");
		await capture("route-profile-loading", false, 0);
		await wait(() => screen().includes("Review routing profile"), "routing profile review");
		await capture("route-profile-review");
		await inspectRouteReview("route-profile-review", "Routing mode is");
		const profileBeforeCancel = await readConfig();
		send("\r", "Initially selected Cancel preserves routing profile settings and active model");
		await wait(() => !screen().includes("Review routing profile"), "cancelled routing profile review");
		if ((await readConfig()) !== profileBeforeCancel) throw new Error("Routing profile Cancel changed settings");
		send("/route profile anthropic\r", "Resolve the routing profile again after cancellation");
		await wait(() => screen().includes("Review routing profile"), "routing profile review again");
		await inspectRouteReview("route-profile-confirm-review", "Routing mode is");
		send("\x1b[B\r", "Confirm the exact routing profile and model switch");
		await wait(() => screen().includes("Applying routing profile"), "routing profile progress");
		await capture("route-profile-progress");
		await wait(() => screen().includes("Routing profile saved: anthropic"), "routing profile saved");
		await capture("route-profile-saved");
		const profileSaved = await readConfig();
		const parsedProfile = Bun.YAML.parse(profileSaved) as {
			routing?: { profile?: string; mode?: string };
			modelRoles?: Record<string, string>;
		};
		if (
			parsedProfile.routing?.profile !== "anthropic" ||
			parsedProfile.routing.mode !== "shadow" ||
			parsedProfile.modelRoles?.default !== "anthropic/claude-sonnet-5:medium"
		)
			throw new Error("Routing profile persistence does not match the reviewed values");
		send("/route profile anthropic\r", "Unchanged effective routing profile performs no write");
		await wait(
			() => screen().includes("Routing profile is already anthropic") && screen().includes("Nothing changed."),
			"profile no-op",
		);
		await capture("route-profile-noop");
		if ((await readConfig()) !== profileSaved) throw new Error("Unchanged routing profile rewrote configuration");
		send("/route profile google-antigravity\r", "Reject an unavailable authoritative profile catalog");
		await wait(
			() => screen().includes("Routing profile google-antigravity unavailable"),
			"unavailable routing profile catalog",
		);
		await capture("route-profile-unavailable");
		if ((await readConfig()) !== profileSaved) throw new Error("Unavailable routing catalog changed configuration");

		send("/route status\r", "Read saved and effective routing status");
		await wait(
			() =>
				screen().includes("User routing mode: shadow") &&
				screen().includes("User routing profile: anthropic") &&
				screen().includes("Active Model: anthropic/claude-sonnet-4-5"),
			"routing status",
		);
		await capture("route-status");
		send("/route invalid\r", "Invalid routing command reports an error");
		await wait(() => screen().includes("Unknown /route subcommand"), "routing error");
		await capture("route-invalid");
		send("/route auto unexpected\r", "Surplus routing arguments are rejected without mutation");
		await wait(() => screen().includes("Usage: /route"), "routing surplus-argument error");
		await capture("route-invalid-arguments");
		if ((await readConfig()) !== profileSaved) throw new Error("Invalid routing input changed configuration");
		persistence = {
			mode: "shadow",
			profile: "anthropic",
			activeModel: "anthropic/claude-sonnet-4-5:high (runtime override retained)",
			cancelledBytesUnchanged: true,
			unchangedBytesPreserved: true,
			failedSaveReportedUnresolved: true,
			retrySavedOnlyUnresolvedMode: true,
			profileCancelBytesUnchanged: true,
			profileNoopBytesUnchanged: true,
			unavailableCatalogBytesUnchanged: true,
			exactRoleAssignmentsReopened: parsedProfile.modelRoles,
			providerRequests,
		};
	} else if (forceFixture) {
		const sessionFiles = () => [
			...new Bun.Glob("*.jsonl").scanSync({
				cwd: join(profile.root, "sessions"),
			}),
		];
		if (sessionFiles().length) throw new Error("Force fixture unexpectedly already has a saved session");
		send("/force\r", "/force opens active-tool choices");
		await wait(() => screen().includes("Queue a forced tool call"), "force chooser");
		await capture("force-choices");
		send("\r", "Initially selected Cancel leaves queue unchanged");
		await wait(() => !screen().includes("Queue a forced tool call"), "cancelled force choice");
		if (sessionFiles().length) throw new Error("Force Cancel wrote session state");
		send("/force\r", "Reopen force chooser");
		await wait(() => screen().includes("Queue a forced tool call"), "force chooser again");
		send("\x1b[<65;4;8M", "Wheel selects read without activating it");
		await wait(() => /[❯>] Queue forced tool: read/.test(screen()), "wheel-selected force action");
		if (sessionFiles().length) throw new Error("Wheel selection wrote session state");
		await capture("force-selected");
		send("\r", "Enter activates explicit read queue action");
		await wait(() => screen().includes("Queued read once"), "force queued result");
		await capture("force-queued");
		if (sessionFiles().length) throw new Error("Force queueing wrote session state");
		persistence = {
			sessionFiles: [],
			observed: "Cancel and queue action created no session file",
			queueProof: "Separate real AgentSession queue test; terminal alone does not prove queue contents",
			providerRequests,
		};
	} else if (memoryFixture) {
		const memoryRoot = getMemoryRoot(profile.agentDir, profile.cwd);
		const initial = await inspectMemoryClear(profile.agentDir, profile.cwd);
		if (initial.threads !== 1 || initial.outputs !== 1 || initial.files !== 1)
			throw new Error(`Memory fixture seed mismatch: ${JSON.stringify(initial)}`);
		send("/memory\r", "Open the populated project-memory report");
		await wait(
			() => screen().includes("Project memory") && screen().includes("Synthetic memory detail 1"),
			"populated memory report",
		);
		await capture("memory-populated");
		const memoryFirstPage = screen();
		send("\x1b[6~", "Page down through the long memory summary");
		await wait(() => screen() !== memoryFirstPage, "paged memory report");
		await capture("memory-populated-paged");
		send("\x03", "Ctrl+C does not act as Back in the memory report");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Project memory")) throw new Error("Ctrl+C closed the populated memory report");
		send("\x1b", "Escape closes the memory report");
		await wait(() => !screen().includes("Project memory"), "memory editor");

		const openClearReview = async (commandName: "clear" | "reset") => {
			send(`/memory ${commandName}\r`, `Review /memory ${commandName}`);
			await wait(() => screen().includes("Review memory clear"), `/memory ${commandName} review`);
		};
		const inspectClearReviewPages = async () => {
			let pages = 0;
			while (!screen().includes("Permanently removes learned memory records")) {
				if (!screen().includes("review details") || pages >= 12)
					throw new Error("Memory-clear consequences are unreachable");
				const previous = screen();
				send("\x1b[6~", "Page down through memory-clear consequences");
				await wait(() => screen() !== previous, "next memory-clear review page");
				await capture(`memory-clear-review-paged-${++pages}`);
			}
			for (let page = 0; page < pages; page++) {
				const previous = screen();
				send("\x1b[5~", "Page up restores the memory-clear target");
				await wait(() => screen() !== previous, "previous memory-clear review page");
			}
			if (!screen().includes("Target:")) throw new Error("Memory-clear paging lost its target");
		};
		await openClearReview("clear");
		await capture("memory-clear-review");
		await inspectClearReviewPages();
		send("\r", "Cancel memory clear from the initially selected action");
		await wait(() => !screen().includes("Review memory clear"), "cancelled memory clear");
		if ((await inspectMemoryClear(profile.agentDir, profile.cwd)).revision !== initial.revision)
			throw new Error("Cancelled memory clear changed persisted state");
		await openClearReview("clear");
		send("\x1b[B\r", "Confirm the reviewed memory clear");
		await wait(() => screen().includes("Memory data cleared and system prompt refreshed."), "memory clear success");
		await capture("memory-clear-saved", true);
		const cleared = await inspectMemoryClear(profile.agentDir, profile.cwd);
		if (cleared.threads || cleared.outputs || cleared.jobs || cleared.files)
			throw new Error(`Memory clear left persisted data: ${JSON.stringify(cleared)}`);
		send("/memory view\r", "Reopen memory after clearing");
		await wait(
			() => screen().includes("Project memory") && screen().includes("No saved memory summary exists"),
			"empty memory report",
		);
		await capture("memory-empty", true);
		send("\x1b", "Close the empty memory report");
		await wait(() => !screen().includes("Project memory"), "editor after empty memory");

		const queueBefore = inspectMemoryConsolidation(profile.agentDir, profile.cwd);
		send("/memory enqueue\r", "Review a memory consolidation request");
		await wait(() => screen().includes("Review memory consolidation"), "memory enqueue review");
		await capture("memory-enqueue-review");
		send("\r", "Cancel memory enqueue from the initially selected action");
		await wait(() => !screen().includes("Review memory consolidation"), "cancelled memory enqueue");
		if (inspectMemoryConsolidation(profile.agentDir, profile.cwd).revision !== queueBefore.revision)
			throw new Error("Cancelled memory enqueue changed the queue");
		send("/memory rebuild\r", "Review the rebuild compatibility alias");
		await wait(() => screen().includes("Review memory consolidation"), "memory rebuild review");
		await capture("memory-rebuild-review");
		send("\x1b[B\r", "Confirm the reviewed memory consolidation request");
		await wait(
			() => screen().includes("Memory consolidation request saved for this project."),
			"memory enqueue success",
		);
		await capture("memory-enqueued", true);
		const queued = inspectMemoryConsolidation(profile.agentDir, profile.cwd);
		if (!queued.state.includes("pending")) throw new Error(`Memory queue was not persisted: ${queued.state}`);

		await mkdir(memoryRoot, { recursive: true });
		await Bun.write(join(memoryRoot, "after-queue.txt"), "synthetic reset fixture");
		await openClearReview("reset");
		await capture("memory-reset-review");
		send("\x1b[B\r", "Confirm the reviewed memory reset alias");
		await wait(() => screen().includes("Memory data cleared and system prompt refreshed."), "memory reset success");
		await capture("memory-reset-saved", true);
		const reset = await inspectMemoryClear(profile.agentDir, profile.cwd);
		if (reset.threads || reset.outputs || reset.jobs || reset.files)
			throw new Error(`Memory reset left persisted data: ${JSON.stringify(reset)}`);
		send("/memory invalid extra\r", "Reject unsupported memory arguments");
		await wait(() => screen().includes("Usage: /memory"), "memory usage error");
		await capture("memory-invalid");
		persistence = {
			database: initial.database,
			artifacts: initial.artifacts,
			cancelledClearRevisionUnchanged: true,
			clearRemovedAllRecordsAndFiles: true,
			cancelledEnqueueRevisionUnchanged: true,
			confirmedQueueState: queued.state,
			resetRemovedQueuedRequestAndConcurrentArtifact: true,
			final: {
				threads: reset.threads,
				outputs: reset.outputs,
				jobs: reset.jobs,
				files: reset.files,
			},
		};
	} else {
		send("/memory\r", "/memory Enter");
		await wait(() => screen().includes("Project memory"), "memory report");
		await capture("memory-missing");
		send("\x03", "Ctrl+C must not close report");
		await Bun.sleep(100);
		await writes;
		if (!screen().includes("Project memory")) throw new Error("Ctrl+C closed report");
		send("\x1b", "Escape report");
		await wait(() => !screen().includes("Project memory"), "editor");
		const sessionDir = join(profile.root, "sessions");
		const sessionFiles = () => [...new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir })];
		send("/fast\r", "Open argument-free fast-mode choices");
		await wait(() => screen().includes("Enable fast mode") && screen().includes("Disable fast mode"), "fast choices");
		await capture("fast-choices");
		send("\r", "Initially selected Cancel leaves fast mode unchanged");
		await wait(() => !screen().includes("Enable fast mode"), "cancelled fast choices");
		if (sessionFiles().length) throw new Error("Argument-free fast Cancel wrote a session file");
		send("/fast on\r", "/fast on Enter");
		await wait(() => screen().includes("Review fast mode"), "fast review");
		await capture("fast-review");
		send("\r", "Cancel initially selected");
		await wait(() => !screen().includes("Review fast mode"), "cancelled review");
		if (sessionFiles().length) throw new Error("Cancellation wrote a session file");
		send("/fast on\r", "/fast on Enter again");
		await wait(() => screen().includes("Review fast mode"), "second review");
		send("\x1b[B\r", "Down Enter confirms");
		await wait(() => screen().includes("Fast mode enabled for this session."), "saved result");
		await capture("fast-saved");
		const files = sessionFiles();
		if (files.length !== 1) throw new Error("Expected one saved session");
		const file = join(sessionDir, files[0]);
		let reopened = await SessionManager.open(file);
		const sessionId = reopened.getSessionId();
		if (
			reopened.buildSessionContext().serviceTier !== "priority" ||
			reopened.getEntries().filter(entry => entry.type === "service_tier_change").length !== 1
		)
			throw new Error("Persisted fast-mode enabled state mismatch");
		await reopened.close();
		const enabledBytes = await Bun.file(file).text();
		send("/fast status\r", "Read current fast-mode status");
		await wait(() => screen().includes("Fast mode: on (current session)."), "fast status");
		await capture("fast-status");
		if ((await Bun.file(file).text()) !== enabledBytes) throw new Error("Fast status changed session bytes");
		send("/fast on\r", "Request the already-enabled fast mode");
		await wait(() => screen().includes("Fast mode is already on; nothing changed."), "fast no-op");
		await capture("fast-noop");
		if ((await Bun.file(file).text()) !== enabledBytes) throw new Error("Fast no-op changed session bytes");
		send("/fast toggle\r", "Review the retained typed toggle compatibility path");
		await wait(() => screen().includes("Review fast mode"), "fast toggle review");
		await capture("fast-toggle-review");
		send("\r", "Cancel typed toggle from the initially selected action");
		await wait(() => !screen().includes("Review fast mode"), "cancelled fast toggle");
		if ((await Bun.file(file).text()) !== enabledBytes)
			throw new Error("Cancelled fast toggle changed session bytes");
		send("/fast off\r", "Review disabling fast mode");
		await wait(() => screen().includes("Review fast mode"), "fast disable review");
		await capture("fast-off-review");
		send("\r", "Cancel disabling fast mode first");
		await wait(() => !screen().includes("Review fast mode"), "cancelled fast disable");
		if ((await Bun.file(file).text()) !== enabledBytes)
			throw new Error("Cancelled fast disable changed session bytes");
		send("/fast off\r", "Review disabling fast mode again");
		await wait(() => screen().includes("Review fast mode"), "second fast disable review");
		send("\x1b[B\r", "Confirm disabling fast mode");
		await wait(() => screen().includes("Fast mode disabled for this session."), "fast disabled");
		await capture("fast-disabled", true);
		reopened = await SessionManager.open(file);
		const tier = reopened.buildSessionContext().serviceTier;
		const changes = reopened.getEntries().filter(entry => entry.type === "service_tier_change").length;
		if (tier !== undefined || changes !== 2) throw new Error("Persisted fast-mode disabled state mismatch");
		await reopened.close();
		persistence = {
			sessionId,
			tier: "default",
			changes,
			file: files[0],
			argumentFreeCancelCreatedNoFile: true,
			typedCancelCreatedNoFile: true,
			statusBytesUnchanged: true,
			noopBytesUnchanged: true,
			toggleCancelBytesUnchanged: true,
			disableCancelBytesUnchanged: true,
			enabledAndDisabledReopened: true,
		};
	}
	if (shellFixture) send("exit\r", "Exit the isolated job-control shell");
	else send("/quit\r", "/quit Enter");
	const result = await done;
	if (result.exitCode !== 0 || result.cancelled || result.timedOut)
		throw new Error(`Unclean exit: ${JSON.stringify(result)}`);
	if (exitFixture) await capture("exit-completed", true);
	if (
		providerRequests.some(
			request =>
				!(
					(request.method === "GET" && request.path === "/v1/models") ||
					(foundationFixture && request.method === "GET" && request.path === "/anthropic/v1/models") ||
					(foundationFixture && request.method === "POST" && request.path === "/v1/chat/completions") ||
					(reportsFixture && request.method === "GET" && request.path === "/wham/usage") ||
					(reportsFixture && request.method === "POST" && request.path === "/v1/messages") ||
					((planFixture || compactFixture || backgroundFixture || exitFixture || sessionsFixture) &&
						request.method === "POST" &&
						request.path === "/v1/messages")
				),
		)
	)
		throw new Error(`Unexpected provider request in queue-only fixture: ${JSON.stringify(providerRequests)}`);
	outcome = { status: "passed" };
} catch (failure) {
	outcome = {
		status: "failed",
		error: failure instanceof Error ? failure.message : String(failure),
	};
	throw failure;
} finally {
	if (!ended) {
		pty.kill();
		await done;
	}
	await writes;
	await Bun.write(join(profile.root, "terminal-events.ansi"), stream);
	await Bun.write(
		join(profile.root, "walkthrough.json"),
		JSON.stringify(
			{
				variant,
				actions,
				persistence,
				outcome,
				fingerprint,
				revision: revision.stdout.toString().trim(),
				output,
				ended,
				providerRequests,
			},
			null,
			2,
		),
	);
	terminal.dispose();
	exitProviderGate.resolve();
	await localProvider?.stop(true);
	await connectionService?.stop(true);
	await resourceService?.stop(true);
	await cleanupBrowserFixture();
	console.log(JSON.stringify({ profile: profile.root, output, persistence }));
}
