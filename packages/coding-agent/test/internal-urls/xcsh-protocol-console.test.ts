import { describe, expect, it } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";

describe("xcsh://console host", () => {
	it("resolves the console index without throwing", async () => {
		const handler = new InternalDocsProtocolHandler();
		const res = await handler.resolve(parseInternalUrl("xcsh://console/") as never);
		expect(res.contentType).toBe("text/markdown");
		expect(res.content).toContain("Console Catalogue");
	});
});
