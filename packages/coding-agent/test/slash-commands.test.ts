import { describe, expect, it } from "bun:test";
import type { AutocompleteItem } from "@f5-sales-demo/pi-tui";
import type { SubcommandDef } from "@f5-sales-demo/xcsh/extensibility/slash-commands";
import { buildArgumentCompletionsForTest } from "@f5-sales-demo/xcsh/extensibility/slash-commands";

// buildArgumentCompletions is module-private today. Task 1 exposes a test-only
// named export `buildArgumentCompletionsForTest` that is identical to the internal
// function. Production code continues to use the internal one via the BUILTIN_SLASH_COMMANDS
// construction in slash-commands.ts.

const NO_PROVIDER: SubcommandDef = { name: "list", description: "List items" };
const WITH_PROVIDER: SubcommandDef = {
	name: "activate",
	description: "Activate an item",
	usage: "<name>",
	getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
		if (prefix.includes(" ")) return null;
		const names = ["alpha", "beta", "gamma"];
		const filtered = names.filter(n => n.startsWith(prefix.toLowerCase()));
		return filtered.length > 0 ? filtered.map(n => ({ value: n, label: n })) : null;
	},
};
const MULTI_WORD: SubcommandDef = {
	name: "unset",
	description: "Unset one or more keys",
	usage: "KEY [KEY2 ...]",
	getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
		const lastSpace = prefix.lastIndexOf(" ");
		const head = lastSpace === -1 ? "" : prefix.slice(0, lastSpace + 1);
		const tail = lastSpace === -1 ? prefix : prefix.slice(lastSpace + 1);
		const keys = ["FOO", "BAR", "BAZ"];
		const items = keys
			.filter(k => k.toLowerCase().startsWith(tail.toLowerCase()))
			.map(k => ({ value: `${head}${k} `, label: k }));
		return items.length > 0 ? items : null;
	},
};

const SUBS: SubcommandDef[] = [NO_PROVIDER, WITH_PROVIDER, MULTI_WORD];

describe("buildArgumentCompletions", () => {
	it("empty prefix returns all subcommands with `<name> ` values and hint = usage", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["list", "activate", "unset"]);
		expect(items!.map(i => i.value)).toEqual(["list ", "activate ", "unset "]);
		const activate = items!.find(i => i.label === "activate");
		expect(activate?.hint).toBe("<name>");
	});

	it("partial prefix filters subcommand names case-insensitively", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("ac");
		expect(items?.map(i => i.label)).toEqual(["activate"]);
	});

	it("exact match without trailing space still filters subcommand list (no delegation)", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("activate");
		expect(items?.map(i => i.label)).toEqual(["activate"]);
	});

	it("trailing space delegates to matched subcommand's provider with empty prefix", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("activate ");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["alpha", "beta", "gamma"]);
	});

	it("delegated values are prefix-rewritten with `<subcommand> `", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("activate ");
		expect(items!.every(i => i.value.startsWith("activate "))).toBe(true);
		expect(items!.map(i => i.value)).toEqual(["activate alpha", "activate beta", "activate gamma"]);
	});

	it("tail forwarded to provider for filtering", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("activate be");
		expect(items?.map(i => i.label)).toEqual(["beta"]);
		expect(items?.[0]?.value).toBe("activate beta");
	});

	it("unknown subcommand with trailing space returns null", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		expect(fn("nope foo")).toBeNull();
	});

	it("known subcommand without provider returns null after trailing space", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		expect(fn("list ")).toBeNull();
		expect(fn("list foo")).toBeNull();
	});

	it("provider returning null propagates as null", () => {
		const subs: SubcommandDef[] = [
			{
				name: "x",
				description: "x",
				getArgumentCompletions: () => null,
			},
		];
		const fn = buildArgumentCompletionsForTest(subs);
		expect(fn("x ")).toBeNull();
		expect(fn("x any")).toBeNull();
	});

	it("provider returning [] treated as null", () => {
		const subs: SubcommandDef[] = [
			{
				name: "x",
				description: "x",
				getArgumentCompletions: () => [],
			},
		];
		const fn = buildArgumentCompletionsForTest(subs);
		expect(fn("x ")).toBeNull();
	});

	it("multi-space tail passed to provider verbatim; value gets subcommand prefixed once", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("unset FOO BAR B");
		expect(items).not.toBeNull();
		expect(items!.map(i => i.label)).toEqual(["BAR", "BAZ"]);
		// Provider returned values starting with "FOO BAR " (its head). Infra prepends "unset ".
		expect(items!.map(i => i.value)).toEqual(["unset FOO BAR BAR ", "unset FOO BAR BAZ "]);
	});

	it("case-insensitive subcommand lookup when delegating (e.g. 'Activate ' → activate provider)", () => {
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("Activate al");
		expect(items?.map(i => i.label)).toEqual(["alpha"]);
		// Prefix rewrite uses the lowercased canonical name, not the user's casing
		expect(items?.[0]?.value).toBe("activate alpha");
	});

	it("extra whitespace between subcommand and argument is stripped before delegation", () => {
		// User types `/context activate  al` with a double space. The single-arg
		// activate provider rejects any prefix containing a space (its past-arg
		// guard), so without whitespace normalisation the dropdown would vanish
		// as soon as the user accidentally hits space twice.
		const fn = buildArgumentCompletionsForTest(SUBS);
		const items = fn("activate  al");
		expect(items?.map(i => i.label)).toEqual(["alpha"]);
		expect(items?.[0]?.value).toBe("activate alpha");
	});
});
