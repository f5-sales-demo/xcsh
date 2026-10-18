import { expect, test } from "bun:test";
import { highlightCode, supportsLanguage } from "@f5-sales-demo/pi-natives";

const colors = {
	comment: "<comment>",
	keyword: "<keyword>",
	function: "<function>",
	variable: "<variable>",
	string: "<string>",
	number: "<number>",
	type: "<type>",
	operator: "<operator>",
	punctuation: "<punctuation>",
	control: "<control>",
};
test("HCL aliases use a real grammar and semantic categories", () => {
	for (const lang of ["hcl", "tf", "terraform"]) {
		expect(supportsLanguage(lang)).toBe(true);
		const source =
			'# demo\nresource "xcsh_http_loadbalancer" "demo" {\n  count = 2\n  enabled = true\n  names = [for n in var.names : n]\n}\n';
		const result = highlightCode(source, lang, colors);
		for (const category of ["comment", "keyword", "variable", "string", "number", "operator", "control"])
			expect(result).toContain(`<${category}>`);
		expect(result.replace(/<\w+>|\x1b\[39m/g, "")).toBe(source);
	}
});
test("an alias cannot claim a missing grammar", () => {
	expect(supportsLanguage("toml")).toBe(false);
});
