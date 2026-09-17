import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("person awareness routes, startup and canonical extension API remain wired", async () => {
	const root = new URL("../src/", import.meta.url);
	const [protocol, sdk, types, loader, index] = await Promise.all(
		[
			"internal-urls/xcsh-protocol.ts",
			"sdk.ts",
			"extensibility/extensions/types.ts",
			"extensibility/extensions/loader.ts",
			"index.ts",
		].map(path => readFile(new URL(path, root), "utf8")),
	);
	for (const route of ["xcsh://user", "xcsh://computer"]) expect(protocol).toContain(route);
	expect(sdk).toContain("ProfileBuilder");
	for (const member of ["personProfile", "registerCollector", "unregisterCollector"])
		expect(`${types}\n${loader}`).toContain(member);
	expect(index).not.toContain("load" + "Profile");
	for (const legacy of ["register" + "ProfileCollector(", "unregister" + "ProfileCollector("])
		expect(types).not.toContain(legacy);
	expect(loader).not.toContain('"facts" in result');
});
