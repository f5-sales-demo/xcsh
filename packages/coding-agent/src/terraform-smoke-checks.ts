/** A complete port leaf must retain its field identity, type and attributed constraints. */
export function completePortSection(text: string): boolean {
	return (
		/^### port(?: property)?\s*$/m.test(text) &&
		/^Type:/m.test(text) &&
		(text.includes("Validators") ||
			(text.includes("Receipt-pinned upstream constraints:") &&
				text.includes("```json") &&
				text.includes('"minimum"') &&
				text.includes('"maximum"')))
	);
}
