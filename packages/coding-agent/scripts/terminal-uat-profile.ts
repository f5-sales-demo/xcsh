import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

export interface TerminalUatVariant {
	columns: number;
	rows: number;
	theme: "dark" | "light";
	symbols: "unicode" | "ascii";
}

export function parseTerminalUatVariant(args: string[]): TerminalUatVariant {
	const variant: TerminalUatVariant = { columns: 80, rows: 24, theme: "dark", symbols: "unicode" };
	const seen = new Set<string>();
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index],
			value = args[index + 1];
		if (seen.has(flag)) throw new Error(`Duplicate UAT option: ${flag}`);
		seen.add(flag);
		if (flag === "--size" && ["60x20", "80x24", "100x32", "140x40"].includes(value)) {
			[variant.columns, variant.rows] = value.split("x").map(Number);
		} else if (flag === "--theme" && (value === "dark" || value === "light")) variant.theme = value;
		else if (flag === "--symbols" && (value === "unicode" || value === "ascii")) variant.symbols = value;
		else throw new Error(`Unsupported UAT option: ${flag} ${value ?? "(missing value)"}`);
	}
	return variant;
}

/** Disposable application profile, not an OS sandbox. No account credentials are inherited. */
export async function createTerminalUatProfile(
	variant = parseTerminalUatVariant([]),
	toolFixture: "none" | "read" | "export" | "publication" | "connections" = "none",
) {
	const hasLauncher = toolFixture === "export" || toolFixture === "publication";
	if (hasLauncher && process.platform === "win32")
		throw new Error(
			"Publication terminal fixtures are unsupported on Windows until an isolated launcher is available",
		);
	const root = await mkdtemp(join(tmpdir(), "xcsh-terminal-uat-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "config", "agent");
	await mkdir(cwd, { recursive: true });
	await mkdir(agentDir, { recursive: true });
	await Bun.write(
		join(agentDir, "config.yml"),
		`startup:\n  checkUpdate: false\nmarketplace:\n  autoUpdate: off\nmemories:\n  enabled: false\ntheme:\n  forceSlot: ${variant.theme}\n  dark: xcsh-dark\n  light: xcsh-light\nsymbolPreset: ${variant.symbols}\n`,
	);
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		TERM: "xterm-256color",
		LANG: "C.UTF-8",
		PI_CODING_AGENT_DIR: agentDir,
		// DirResolver joins this value to the real home; do not change HOME itself.
		PI_CONFIG_DIR: relative(homedir(), join(root, "config")),
		XDG_CONFIG_HOME: join(root, "xdg-config"),
		XDG_CACHE_HOME: join(root, "xdg-cache"),
		XDG_DATA_HOME: join(root, "xdg-data"),
		XDG_STATE_HOME: join(root, "xdg-state"),
		TMPDIR: root,
	};
	let extensionFixture: string | undefined;
	if (hasLauncher) {
		const bin = join(root, "bin");
		await mkdir(bin, { mode: 0o700 });
		const launcher = join(bin, process.platform === "darwin" ? "open" : "xdg-open");
		await Bun.write(launcher, Bun.file(resolve(import.meta.dir, "../test/fixtures/terminal-uat-opener.sh")));
		await chmod(launcher, 0o700);
		env.PATH = `${bin}:${env.PATH}`;
		env.XCSH_UAT_OPEN_LOG = join(root, "opened-paths.nul");
		env.XCSH_UAT_OPEN_FAIL_FILE = join(root, "launcher-fails");
	}
	if (toolFixture === "publication") {
		const publisher = join(agentDir, "share.mjs");
		await Bun.write(publisher, Bun.file(resolve(import.meta.dir, "../test/fixtures/terminal-uat-publisher.mjs")));
		await chmod(publisher, 0o600);
		env.XCSH_UAT_SHARE_LOG = join(root, "publication-attempts.nul");
		env.XCSH_UAT_SHARE_OUTPUT = join(root, "published-session.html");
		env.XCSH_UAT_SHARE_FAIL_FILE = join(root, "publisher-fails");
		extensionFixture = join(agentDir, "terminal-uat-link-extension.ts");
		await Bun.write(
			extensionFixture,
			Bun.file(resolve(import.meta.dir, "../test/fixtures/terminal-uat-link-extension.ts")),
		);
		await chmod(extensionFixture, 0o600);
	}
	const args = [
		process.execPath,
		resolve(import.meta.dir, "../src/cli.ts"),
		...(extensionFixture ? ["--extension", extensionFixture] : ["--no-extensions"]),
		"--no-skills",
		"--no-rules",
		...(toolFixture !== "none"
			? ["--tools", "read", "--provider", "anthropic", "--model", "claude-sonnet-4-5"]
			: ["--no-tools"]),
		"--no-mcp",
		"--no-lsp",
		"--no-title",
		"--no-memories",
		"--session-dir",
		join(root, "sessions"),
	];
	return { root, cwd, agentDir, env, args };
}

if (import.meta.main) {
	const profile = await createTerminalUatProfile();
	console.log(JSON.stringify(profile));
	if (process.argv.includes("--launch")) {
		const child = Bun.spawn(profile.args, {
			cwd: profile.cwd,
			env: profile.env,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		process.exitCode = await child.exited;
	}
}
