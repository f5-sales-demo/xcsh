/** Require the exact published port property and receipt-pinned constraint. */
export function assertTerraformPortSection(section: string): void {
	if (!section.includes('<a id="schema-https--port"></a>') || !/^### port(?: property)?\s*$/m.test(section))
		throw new Error("Terraform explicit-anchor smoke failed");
	const fences = [...section.matchAll(/^```json\s*\n([\s\S]*?)^```\s*$/gm)];
	const constrained = fences.some(match => {
		try {
			const rules = JSON.parse(match[1]!) as Record<string, Record<string, unknown>>;
			return rules["x-validation-rules"]?.["ves.io.schema.rules.uint32.lte"] === "65535";
		} catch {
			return false;
		}
	});
	if (!constrained) throw new Error("Terraform port constraint smoke failed");
}
