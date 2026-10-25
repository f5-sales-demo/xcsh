import { expect, test } from "bun:test";
import { completePortSection } from "../src/terraform-smoke-checks";

test("compiled anchor smoke accepts attributed upstream constraints after provider refresh", () => {
	expect(
		completePortSection(
			'### port property\nType: `"number"`. Optional.\nReceipt-pinned upstream constraints:\n```json\n{"minimum":1,"maximum":65535}\n```',
		),
	).toBe(true);
});
test("compiled anchor smoke rejects navigation, other fields and incomplete constraints", () => {
	for (const text of [
		"port: view=context",
		"### port_ranges property\nType: string\nValidators: length",
		"### port property\nType: number",
		"Receipt-pinned upstream constraints: minimum 1",
	])
		expect(completePortSection(text)).toBe(false);
});
test("compiled anchor smoke preserves legacy provider validator coverage", () => {
	expect(completePortSection("### port\nType: number\nValidators: between 1 and 65535")).toBe(true);
});
