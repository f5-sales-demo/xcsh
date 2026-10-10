import { expect, test } from "bun:test";
import { assertTerraformPortSection } from "../src/terraform-port-smoke";

const section =
	'<a id="schema-https--port"></a>\n\n### port property\n\nType: `"number"`. Optional.\n\nReceipt-pinned upstream constraints:\n\n```json\n{"x-validation-rules":{"ves.io.schema.rules.uint32.lte":"65535"}}\n```';
test("compiled port smoke checks anchored property and pinned constraints", () => {
	expect(() => assertTerraformPortSection(section)).not.toThrow();
	expect(() => assertTerraformPortSection(section.replace("schema-https--port", "schema-http--port"))).toThrow();
	expect(() => assertTerraformPortSection(section.replace("### port property", "### name property"))).toThrow();
	expect(() => assertTerraformPortSection(section.replace("65535", "1"))).toThrow();
	expect(() => assertTerraformPortSection(section.slice(0, section.indexOf("```json")))).toThrow();
});
