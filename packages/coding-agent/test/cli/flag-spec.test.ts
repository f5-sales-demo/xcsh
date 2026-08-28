import { describe, expect, test } from "bun:test";
import { getExtraHelpText, type Mode, parseArgs, resolveLaunchArgs, scanLaunchBootstrapArgs } from "../../src/cli/args";
import { buildCliFlags, flagSpec, LAUNCH_FLAGS, normalizeFlagTokens, takesValue } from "../../src/cli/flag-spec";
import { buildInitialMessage } from "../../src/cli/initial-message";
import Index from "../../src/commands/launch";

const visibleNames = Object.entries(LAUNCH_FLAGS)
	.filter(([, spec]) => !("hidden" in spec))
	.map(([name]) => name)
	.sort();

// `xcsh --help` documented `--model=<value>` while the parser accepted only `--model value`, because
// help and parsing read two separate hand-maintained tables (#2469). These tests keep them one datum.
describe("help and parser cannot drift", () => {
	test("the root command's help table is derived from the spec", () => {
		expect(Object.keys(Index.flags).sort()).toEqual(visibleNames);
	});

	test("help renders =<value> exactly for the flags that take one", () => {
		const flags = buildCliFlags();
		for (const [name, descriptor] of Object.entries(flags)) {
			const spec = flagSpec(name);
			expect(spec).toBeDefined();
			// utils/cli.ts renders the "=<value>" suffix from `kind`, so this is what users are told.
			expect(descriptor.kind === "boolean").toBe(!takesValue(spec!));
		}
	});

	test("every spec flag is accepted by the parser", () => {
		for (const [name, spec] of Object.entries(LAUNCH_FLAGS)) {
			const value = spec.options ? spec.options[0] : "x";
			const argv = takesValue(spec) ? [`--${name}`, value] : [`--${name}`];
			expect(parseArgs(argv).unrecognizedFlags, `--${name} should be recognized`).toEqual([]);
		}
	});

	test("a repeatable flag is declared multiple in help", () => {
		const flags = buildCliFlags();
		for (const [name, spec] of Object.entries(LAUNCH_FLAGS)) {
			if (spec.arity !== "repeatable-value" || "hidden" in spec) continue;
			expect(flags[name].multiple, `--${name} should be multiple`).toBe(true);
		}
	});

	test("sandbox help describes discovery rather than CWD access grants", () => {
		const noSandbox = LAUNCH_FLAGS["no-sandbox"].description;
		const allowPath = LAUNCH_FLAGS["allow-path"].description;
		const extraHelp = getExtraHelpText();

		expect(noSandbox).toMatch(/discovery guard/i);
		expect(allowPath).toMatch(/directory discovery/i);
		expect(extraHelp).toContain(noSandbox);
		expect(extraHelp).toContain(allowPath);
		expect(`${noSandbox}\n${allowPath}\n${extraHelp}`).not.toMatch(/access outside the CWD|read\+write access/i);
	});

	test("hidden flags are parsed but not advertised", () => {
		expect(Object.keys(buildCliFlags())).not.toContain("session");
		expect(parseArgs(["--session", "abc"]).resume).toBe("abc");
	});

	// --mode accepted acp while help listed only text/json/rpc.
	test("--mode advertises every mode the parser accepts", () => {
		const modes = LAUNCH_FLAGS.mode.options ?? [];
		expect(modes).toEqual(["text", "json", "rpc", "acp"]);
		for (const mode of modes) {
			expect(parseArgs(["--mode", mode]).mode).toBe(mode as Mode);
		}
	});
});

describe("normalizeFlagTokens", () => {
	test("splits a known value flag", () => {
		expect(normalizeFlagTokens(["--model=opus"])).toEqual(["--model", "opus"]);
	});

	test("preserves an empty value so the flag still reports a missing one", () => {
		expect(normalizeFlagTokens(["--model="])).toEqual(["--model", ""]);
	});

	test("preserves a value containing = or spaces", () => {
		expect(normalizeFlagTokens(["--system-prompt=a=b c"])).toEqual(["--system-prompt", "a=b c"]);
	});

	test("throws for a boolean flag given a value", () => {
		expect(() => normalizeFlagTokens(["--no-mcp=true"])).toThrow("--no-mcp is a boolean flag");
	});

	test("splits a registered extension flag and rejects a boolean one", () => {
		const extensions = new Map([
			["profile", { type: "string" as const }],
			["verbose", { type: "boolean" as const }],
		]);
		expect(normalizeFlagTokens(["--profile=prod"], extensions)).toEqual(["--profile", "prod"]);
		expect(() => normalizeFlagTokens(["--verbose=1"], extensions)).toThrow("boolean flag");
	});

	test("leaves an unknown flag intact for the unknown-flag path to report", () => {
		expect(normalizeFlagTokens(["--bogus=x"])).toEqual(["--bogus=x"]);
	});

	test("leaves short forms alone", () => {
		expect(normalizeFlagTokens(["-p=x"])).toEqual(["-p=x"]);
	});

	test("does not touch anything after the -- terminator", () => {
		expect(normalizeFlagTokens(["--", "--model=opus"])).toEqual(["--", "--model=opus"]);
	});
});

// The first parse has no extension registry, so a registered string flag's value used to fall
// through into `messages` and reach the model as prompt text.
describe("extension flag values never become prompt text", () => {
	const extensions = new Map([["profile", { type: "string" as const }]]);

	// The bootstrap parse cannot know an unknown flag's arity, so it records the flag and leaves the
	// following token alone. Swallowing it would silently drop the prompt from
	// `xcsh -p --verbose "do work"` whenever the extension declares `verbose` as boolean.
	test("records the flag without consuming the next token", () => {
		const bootstrap = parseArgs(["--profile", "prod", "hello"]);
		expect(bootstrap.unrecognizedFlags).toEqual([{ token: "--profile", name: "profile" }]);
		expect(bootstrap.messages).toEqual(["prod", "hello"]);
	});

	test("never drops a prompt for a boolean extension flag", () => {
		const bootstrap = parseArgs(["-p", "--verbose", "do work"]);
		expect(bootstrap.messages).toEqual(["do work"]);
	});

	test("records the name from the = form too", () => {
		const bootstrap = parseArgs(["--profile=prod", "hello"]);
		expect(bootstrap.messages).toEqual(["hello"]);
		expect(bootstrap.unrecognizedFlags[0]?.name).toBe("profile");
	});

	test("binds the flag once the registry is known, either form", () => {
		for (const argv of [
			["--profile", "prod", "hello"],
			["--profile=prod", "hello"],
		]) {
			const final = parseArgs(argv, extensions);
			expect(final.messages).toEqual(["hello"]);
			expect(final.unknownFlags.get("profile")).toBe("prod");
			expect(final.unrecognizedFlags).toEqual([]);
		}
	});

	test("does not bind an extension flag written after the terminator", () => {
		const final = parseArgs(["--", "--profile", "prod"], extensions);
		expect(final.unknownFlags.size).toBe(0);
		expect(final.messages).toEqual(["--profile", "prod"]);
	});
});

describe("launch parsing waits for extension flags", () => {
	const extensionFlags = new Map([
		["profile", { type: "string" as const }],
		["verbose", { type: "boolean" as const }],
	]);

	for (const [label, argv, expected] of [
		["spaced string", ["-p", "--profile", "prod", "summarise the deal"], ["profile", "prod", "summarise the deal"]],
		["equals string", ["-p", "--profile=prod", "summarise the deal"], ["profile", "prod", "summarise the deal"]],
		["boolean before prompt", ["-p", "--verbose", "do work"], ["verbose", true, "do work"]],
		["equals boolean", ["-p", "--verbose=true", "do work"], ["verbose", true, "do work"]],
	] as const) {
		test(`binds a ${label} flag before constructing messages`, async () => {
			let discoveries = 0;
			const result = await resolveLaunchArgs(argv, async () => {
				discoveries++;
				return extensionFlags;
			});

			expect(discoveries).toBe(1);
			expect(result.parsed.unknownFlags.get(expected[0])).toBe(expected[1]);
			expect(result.parsed.messages).toEqual([expected[2]]);
			expect(result.parsed.fileArgs).toEqual([]);
		});
	}

	test("binds false from an extension boolean equals form", async () => {
		const result = await resolveLaunchArgs(["--verbose=false", "do work"], async () => extensionFlags);
		expect(result.parsed.unknownFlags.get("verbose")).toBe(false);
	});

	test("never includes an extension flag value in the initial model message", async () => {
		const { parsed } = await resolveLaunchArgs(
			["--profile", "prod", "summarise the deal"],
			async () => extensionFlags,
		);
		const message = buildInitialMessage({ parsed, stdinContent: "stdin" });

		expect(message.initialMessage).toBe("stdin\nsummarise the deal");
		expect(message.initialMessage).not.toContain("prod");
	});

	test("does not reinterpret an extension string value as an RPC file argument", async () => {
		const result = await resolveLaunchArgs(["--profile", "@payload", "--mode", "rpc"], async () => extensionFlags);

		expect(result.parsed.unknownFlags.get("profile")).toBe("@payload");
		expect(result.parsed.fileArgs).toEqual([]);
	});

	test("keeps extension-like text after -- as prompt content", async () => {
		const result = await resolveLaunchArgs(["--", "--profile", "prod"], async () => extensionFlags);

		expect(result.parsed.unknownFlags.size).toBe(0);
		expect(result.parsed.messages).toEqual(["--profile", "prod"]);
	});

	test("does not discover extensions for pre-extension early exits", async () => {
		for (const argv of [
			["--version", "--bogus"],
			["--list-models", "--bogus"],
			["--export", "x", "--bogus"],
		]) {
			let discoveries = 0;
			const result = await resolveLaunchArgs(argv, async () => {
				discoveries++;
				return extensionFlags;
			});

			expect(discoveries).toBe(0);
			expect(result.parsed.unrecognizedFlags).toHaveLength(1);
		}
	});
});

describe("launch bootstrap scan", () => {
	test("collects only controls required before extension discovery", () => {
		const bootstrap = scanLaunchBootstrapArgs([
			"--model",
			"opus",
			"--extension=./one.ts",
			"--hook",
			"./two.ts",
			"--plugin-dir",
			"./plugins",
			"--no-extensions",
			"--allow-home",
		]);

		expect(bootstrap).toMatchObject({
			extensions: ["./one.ts"],
			hooks: ["./two.ts"],
			pluginDirs: ["./plugins"],
			noExtensions: true,
			allowHome: true,
			preExtensionExit: false,
		});
	});

	test("does not treat a built-in flag value or post-terminator text as a discovery control", () => {
		const bootstrap = scanLaunchBootstrapArgs(["--system-prompt", "--extension", "--", "--plugin-dir", "./ignored"]);

		expect(bootstrap.extensions).toEqual([]);
		expect(bootstrap.pluginDirs).toEqual([]);
	});
});
