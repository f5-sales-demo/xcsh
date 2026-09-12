import { expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createTerminalUatProfile, parseTerminalUatVariant } from "../../scripts/terminal-uat-profile";

test("export fixture records literal launcher arguments without opening a browser", async () => {
	if (process.platform === "win32") {
		await expect(createTerminalUatProfile(parseTerminalUatVariant([]), "export")).rejects.toThrow("unsupported");
		return;
	}
	const profile = await createTerminalUatProfile(parseTerminalUatVariant([]), "export");
	try {
		const bin = join(profile.root, "bin");
		expect(profile.env.PATH.split(":")[0]).toBe(bin);
		const launcher = join(bin, process.platform === "darwin" ? "open" : "xdg-open");
		expect((await stat(launcher)).mode & 0o777).toBe(0o700);
		const targets = [join(profile.cwd, "export with spaces.html"), "literal-$NOT_EXPANDED-`text`"];
		const child = Bun.spawn([launcher, ...targets], {
			cwd: profile.cwd,
			env: profile.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await child.exited).toBe(0);
		expect(await new Response(child.stderr).text()).toBe("");
		expect(await Bun.file(profile.env.XCSH_UAT_OPEN_LOG).text()).toBe(`${targets.join("\0")}\0`);
		expect(Object.keys(profile.env).some(key => /TOKEN|SECRET|API_KEY|HERDR/.test(key))).toBe(false);
		expect(profile.args).toContain("--tools");
	} finally {
		await rm(profile.root, { recursive: true, force: true });
	}
});

test("publication fixture isolates the publisher, launcher, and link-mutation extension", async () => {
	if (process.platform === "win32") {
		await expect(createTerminalUatProfile(parseTerminalUatVariant([]), "publication")).rejects.toThrow("unsupported");
		return;
	}
	const profile = await createTerminalUatProfile(parseTerminalUatVariant([]), "publication");
	try {
		const publisher = join(profile.agentDir, "share.mjs");
		const extension = join(profile.agentDir, "terminal-uat-link-extension.ts");
		expect((await stat(publisher)).mode & 0o777).toBe(0o600);
		expect((await stat(extension)).mode & 0o777).toBe(0o600);
		expect(profile.args).not.toContain("--no-extensions");
		expect(profile.args.slice(profile.args.indexOf("--extension"), profile.args.indexOf("--extension") + 2)).toEqual([
			"--extension",
			extension,
		]);
		expect(profile.env.XCSH_UAT_SHARE_LOG).toBe(join(profile.root, "publication-attempts.nul"));
		expect(profile.env.XCSH_UAT_SHARE_OUTPUT).toBe(join(profile.root, "published-session.html"));
		expect(profile.env.XCSH_UAT_OPEN_FAIL_FILE).toBe(join(profile.root, "launcher-fails"));
	} finally {
		await rm(profile.root, { recursive: true, force: true });
	}
});

test("terminal matrix variants are explicit and reject unsupported or misspelled inputs", () => {
	expect(parseTerminalUatVariant([])).toEqual({ columns: 80, rows: 24, theme: "dark", symbols: "unicode" });
	expect(parseTerminalUatVariant(["--size", "60x20", "--theme", "light", "--symbols", "ascii"])).toEqual({
		columns: 60,
		rows: 20,
		theme: "light",
		symbols: "ascii",
	});
	for (const args of [["--size", "0x0"], ["--theme", "typo"], ["--symbols", "nerd"], ["--unknown"], ["--size"]])
		expect(() => parseTerminalUatVariant(args)).toThrow();
});

test("light ASCII profile pins its requested variant", async () => {
	const profile = await createTerminalUatProfile({ columns: 60, rows: 20, theme: "light", symbols: "ascii" });
	try {
		const config = await Bun.file(join(profile.agentDir, "config.yml")).text();
		expect(config).toContain("forceSlot: light");
		expect(config).toContain("light: xcsh-light");
		expect(config).toContain("symbolPreset: ascii");
	} finally {
		await rm(profile.root, { recursive: true, force: true });
	}
});

test("force fixture enables only read and pins a model without adding credentials", async () => {
	const profile = await createTerminalUatProfile(parseTerminalUatVariant([]), "read");
	try {
		expect(profile.args).not.toContain("--no-tools");
		expect(profile.args.slice(profile.args.indexOf("--tools"), profile.args.indexOf("--tools") + 2)).toEqual([
			"--tools",
			"read",
		]);
		expect(profile.args).toContain("claude-sonnet-4-5");
		expect(Object.keys(profile.env).some(key => /TOKEN|SECRET|API_KEY/.test(key))).toBe(false);
	} finally {
		await rm(profile.root, { recursive: true, force: true });
	}
});

test("terminal UAT profile resolves both root and agent storage to disposable paths", async () => {
	const profile = await createTerminalUatProfile();
	try {
		const dirs = resolve(import.meta.dir, "../../../utils/src/dirs.ts");
		const code = `import {getConfigRootDir,getAgentDir} from ${JSON.stringify(dirs)}; console.log(JSON.stringify({root:getConfigRootDir(),agent:getAgentDir()}));`;
		const child = Bun.spawn([process.execPath, "-e", code], {
			cwd: profile.cwd,
			env: profile.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exit, output, error] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect({ exit, error }).toEqual({ exit: 0, error: "" });
		expect(JSON.parse(output)).toEqual({ root: join(profile.root, "config"), agent: profile.agentDir });
		expect(Object.keys(profile.env).some(key => /TOKEN|SECRET|API_KEY|HERDR/.test(key))).toBe(false);
		expect(profile.env.HOME).toBeUndefined();
		expect(await Bun.file(join(profile.agentDir, "config.yml")).text()).toContain("checkUpdate: false");
		expect(profile.args).toContain("--no-extensions");
		expect(await Bun.file(join(profile.agentDir, "config.yml")).text()).toContain("symbolPreset: unicode");
		expect(await Bun.file(join(profile.agentDir, "config.yml")).text()).toContain("forceSlot: dark");
	} finally {
		await rm(profile.root, { recursive: true, force: true });
	}
});
