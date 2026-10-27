import { expect, test } from "bun:test";
import { InternalDocsProtocolHandler, InternalUrlRouter } from "../../src/internal-urls";

for (const entry of ["xcsh://about", "xcsh://"]) {
	test(`${entry} exposes an executable canonical plugin discovery pointer`, async () => {
		const router = new InternalUrlRouter();
		router.register(new InternalDocsProtocolHandler({ getPluginRoots: async () => [] }));
		const guidance = await router.resolve(entry);
		const pointer = guidance.content.match(/xcsh:\/\/plugin(?![a-z/])/);
		expect(pointer).not.toBeNull();
		const inventory = await router.resolve(pointer![0]);
		expect(inventory.contentType).toBe("application/json");
		expect(JSON.parse(inventory.content)).toEqual([]);
	});
}
