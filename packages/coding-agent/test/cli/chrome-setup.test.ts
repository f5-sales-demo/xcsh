import { describe, expect, it } from "bun:test";
import { EXTENSION_ID, WEB_STORE_URL } from "@f5-sales-demo/xcsh/cli/chrome-cli";

describe("EXTENSION_ID", () => {
	it("is the canonical Chrome Web Store ID", () => {
		expect(EXTENSION_ID).toBe("klajkjdoehjidngligegnpknogmjjhkc");
	});
});

describe("WEB_STORE_URL", () => {
	it("is the Chrome Web Store detail URL for the canonical extension id", () => {
		expect(WEB_STORE_URL).toBe(`https://chromewebstore.google.com/detail/${EXTENSION_ID}`);
	});

	it("contains EXTENSION_ID", () => {
		expect(WEB_STORE_URL).toContain(EXTENSION_ID);
	});
});

describe("version sync", () => {
	it("packages/utils and packages/coding-agent have the same version (binary bakes utils)", () => {
		const utils = require("../../../utils/package.json").version;
		const codingAgent = require("../../package.json").version;
		expect(utils).toBe(codingAgent);
	});
});
