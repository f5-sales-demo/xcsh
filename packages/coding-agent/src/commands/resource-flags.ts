import { Flags } from "@f5-sales-demo/pi-utils/cli";

export const manifestInputFlags = {
	filename: Flags.string({ char: "f", description: "Manifest file, directory, or - for stdin", multiple: true }),
	namespace: Flags.string({ char: "n", description: "Override the resource namespace" }),
	output: Flags.string({
		char: "o",
		description: "Output format",
		options: ["json", "yaml", "table", "wide"],
		default: "table",
	}),
	recursive: Flags.boolean({ char: "R", description: "Read manifest directories recursively", default: false }),
	"result-file": Flags.string({ description: "Write the aggregate JSON report to a file" }),
};

export const manifestResourceFlags = {
	...manifestInputFlags,
	"dry-run": Flags.string({ description: "Validate and calculate changes without mutation", options: ["client"] }),
};

export const targetResourceFlags = {
	namespace: Flags.string({ char: "n", description: "Override the resource namespace" }),
	output: Flags.string({
		char: "o",
		description: "Output format",
		options: ["json", "yaml", "table", "wide"],
		default: "table",
	}),
	"result-file": Flags.string({ description: "Write the aggregate JSON report to a file" }),
};
