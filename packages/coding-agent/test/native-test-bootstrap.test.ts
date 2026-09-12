import { expect, test } from "bun:test";

test("standard TypeScript test entry points prepare source-matched native bindings", async () => {
	const rootPackage = JSON.parse(await Bun.file(new URL("../../../package.json", import.meta.url)).text()) as {
		scripts: Record<string, string>;
	};
	const packageScript = JSON.parse(await Bun.file(new URL("../package.json", import.meta.url)).text()) as {
		scripts: Record<string, string>;
	};
	const testRunner = await Bun.file(new URL("../../../scripts/run-ts-tests.ts", import.meta.url)).text();

	expect(rootPackage.scripts["test:ts"]).toBe("bun scripts/run-ts-tests.ts");
	expect(testRunner).toContain('"bun", "scripts/ensure-dev-native.ts"');
	expect(packageScript.scripts.pretest).toContain("scripts/ensure-dev-native.ts");
});
