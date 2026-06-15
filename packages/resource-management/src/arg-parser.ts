import type { ParsedExportArgs, ParsedResourceArgs } from "./types";

const VALID_OUTPUT_FORMATS = new Set(["json", "yaml", "table", "wide"]);
const VALID_EXPORT_FORMATS = new Set(["json", "yaml", "hcl"]);
const VALID_DRY_RUN_MODES = new Set(["client", "server"]);

export function parseResourceArgs(argsString: string): ParsedResourceArgs | { error: string } {
	const tokens = argsString.split(/\s+/).filter(Boolean);
	const filenames: string[] = [];
	let namespace: string | undefined;
	let outputFormat: ParsedResourceArgs["outputFormat"] = "table";
	let dryRun: ParsedResourceArgs["dryRun"];
	let recursive = false;
	let force = false;
	const positionals: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token === "-f" || token === "--filename") {
			if (i + 1 >= tokens.length) return { error: `${token} requires a file path.` };
			filenames.push(tokens[++i]);
		} else if (token.startsWith("-f") && token.length > 2 && token[2] !== "-") {
			filenames.push(token.slice(2));
		} else if (token === "-n" || token === "--namespace") {
			if (i + 1 >= tokens.length) return { error: `${token} requires a namespace value.` };
			namespace = tokens[++i];
		} else if (token.startsWith("-n") && token.length > 2 && token[2] !== "-") {
			namespace = token.slice(2);
		} else if (token === "-o" || token === "--output") {
			if (i + 1 >= tokens.length) return { error: `${token} requires a format value (json, yaml, table, wide).` };
			const fmt = tokens[++i];
			if (!VALID_OUTPUT_FORMATS.has(fmt)) {
				return { error: `Invalid output format: "${fmt}". Must be one of: json, yaml, table, wide.` };
			}
			outputFormat = fmt as ParsedResourceArgs["outputFormat"];
		} else if (token.startsWith("-o") && token.length > 2 && token[2] !== "-") {
			const fmt = token.slice(2);
			if (!VALID_OUTPUT_FORMATS.has(fmt)) {
				return { error: `Invalid output format: "${fmt}". Must be one of: json, yaml, table, wide.` };
			}
			outputFormat = fmt as ParsedResourceArgs["outputFormat"];
		} else if (token.startsWith("--dry-run")) {
			if (token.includes("=")) {
				const mode = token.split("=")[1];
				if (!VALID_DRY_RUN_MODES.has(mode)) {
					return { error: `Invalid --dry-run mode: "${mode}". Must be "client" or "server".` };
				}
				dryRun = mode as ParsedResourceArgs["dryRun"];
			} else {
				dryRun = "client";
			}
		} else if (token === "-R" || token === "--recursive") {
			recursive = true;
		} else if (token === "--force") {
			force = true;
		} else if (token.startsWith("-")) {
			return { error: `Unknown flag: "${token}".` };
		} else {
			positionals.push(token);
		}
	}

	return {
		filenames,
		namespace,
		outputFormat,
		dryRun,
		recursive,
		force,
		kind: positionals[0],
		name: positionals[1],
	};
}

export function parseExportArgs(argsString: string): ParsedExportArgs | { error: string } {
	const tokens = argsString.split(/\s+/).filter(Boolean);
	let namespace: string | undefined;
	let outputFormat: ParsedExportArgs["outputFormat"] = "json";
	let outputFile: string | undefined;
	let all = false;
	const positionals: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token === "-n" || token === "--namespace") {
			if (i + 1 >= tokens.length) return { error: `${token} requires a namespace value.` };
			namespace = tokens[++i];
		} else if (token.startsWith("-n") && token.length > 2 && token[2] !== "-") {
			namespace = token.slice(2);
		} else if (token === "-o" || token === "--output") {
			if (i + 1 >= tokens.length) return { error: `${token} requires a format value (json, yaml, hcl).` };
			const fmt = tokens[++i];
			if (!VALID_EXPORT_FORMATS.has(fmt)) {
				return { error: `Invalid output format: "${fmt}". Must be one of: json, yaml, hcl.` };
			}
			outputFormat = fmt as ParsedExportArgs["outputFormat"];
		} else if (token.startsWith("-o") && token.length > 2 && token[2] !== "-") {
			const fmt = token.slice(2);
			if (!VALID_EXPORT_FORMATS.has(fmt)) {
				return { error: `Invalid output format: "${fmt}". Must be one of: json, yaml, hcl.` };
			}
			outputFormat = fmt as ParsedExportArgs["outputFormat"];
		} else if (token === "-f" || token === "--file") {
			if (i + 1 >= tokens.length) return { error: `${token} requires an output file path.` };
			outputFile = tokens[++i];
		} else if (token.startsWith("-f") && token.length > 2 && token[2] !== "-") {
			outputFile = token.slice(2);
		} else if (token === "--all") {
			all = true;
		} else if (token.startsWith("-")) {
			return { error: `Unknown flag: "${token}".` };
		} else {
			positionals.push(token);
		}
	}

	if (!all && positionals.length === 0) {
		return { error: "Specify a resource kind, or use --all to export all resources." };
	}

	return {
		kind: positionals[0],
		name: positionals[1],
		namespace,
		outputFormat,
		outputFile,
		all,
	};
}
