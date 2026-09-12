import { expect, test } from "bun:test";

test("standard TypeScript test entry points prepare source-matched native bindings", async () => {
	const rootPackage = JSON.parse(await Bun.file(new URL("../../../package.json", import.meta.url)).text()) as {
		scripts: Record<string, string>;
	};
	const packageScript = JSON.parse(await Bun.file(new URL("../package.json", import.meta.url)).text()) as {
		scripts: Record<string, string>;
	};

	expect(rootPackage.scripts["test:ts"]).toContain("scripts/ensure-dev-native.ts");
	expect(packageScript.scripts.pretest).toContain("scripts/ensure-dev-native.ts");
});
