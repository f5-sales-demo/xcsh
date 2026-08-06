import type { Rule } from "./capability/rule";
import epistemicIntegrity from "./prompts/rules/epistemic-integrity.md" with { type: "text" };
import llmsSearch from "./prompts/rules/llms-search.md" with { type: "text" };

const definitions = [
	{
		name: "epistemic-integrity",
		description: "Evidence-based dialogue examples for direct, honest technical pushback",
		content: epistemicIntegrity,
	},
	{
		name: "llms-search",
		description: "Progressive discovery through the live F5 XC llms.txt documentation hierarchy",
		content: llmsSearch,
	},
] as const;

const bundledRules: Rule[] = definitions.map(definition => {
	const rulePath = `embedded:${definition.name}.md`;
	return {
		...definition,
		path: rulePath,
		_source: {
			provider: "bundled",
			providerName: "xcsh",
			path: rulePath,
			level: "native",
		},
	};
});

/** Rules referenced by the built-in system prompt and embedded in every package/binary. */
export function getBundledRules(): Rule[] {
	return bundledRules;
}
