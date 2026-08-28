import { describe, expect, test } from "bun:test";
import { prioritizeInjectedPluginRoots } from "../../src/discovery/helpers";
import type { XcshPluginRoot } from "../../src/discovery/types";

function root(plugin: string, marketplace: string, path: string): XcshPluginRoot {
	return { id: `${plugin}@${marketplace}`, plugin, marketplace, path, version: "1.0.0", scope: "user" };
}

describe("--plugin-dir precedence", () => {
	test("an explicit plugin shadows installed copies by manifest identity", () => {
		const installed = [root("asm-migration", "marketplace", "/installed"), root("other", "marketplace", "/other")];
		const injected = [root("asm-migration", "__local__", "/candidate")];
		expect(prioritizeInjectedPluginRoots(installed, injected)).toEqual([injected[0], installed[1]]);
	});

	test("the first explicit directory wins duplicate identities deterministically", () => {
		const first = root("same", "__local__", "/first");
		const second = root("same", "__local__", "/second");
		expect(prioritizeInjectedPluginRoots([], [first, second])).toEqual([first]);
	});
});
