import { describe, expect, it } from "bun:test";
import { resolveRef } from "@f5xc-salesdemos/xcsh/browser/extension-provider";

const tree = {
	role: "WebArea",
	name: "",
	ref: "ref_0",
	children: [
		{ role: "tab", name: "Add HTTP Load Balancer", ref: "ref_7" },
		{ role: "textbox", name: "Name", ref: "ref_12" },
	],
};

describe("resolveRef", () => {
	it("maps a role/name locator to its ref via matchNode", () => {
		expect(resolveRef(tree as never, "tab:text('Add HTTP Load Balancer')")).toBe("ref_7");
		expect(resolveRef(tree as never, "textbox[name='Name']")).toBe("ref_12");
	});
	it("throws when nothing matches", () => {
		expect(() => resolveRef(tree as never, "textbox[name='Nope']")).toThrow();
	});
});
