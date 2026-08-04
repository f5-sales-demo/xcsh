import type { AutocompleteItem } from "@f5-sales-demo/pi-tui";
import type { InteractiveModeContext } from "../modes/types";

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

function getKindCompletions(prefix: string): AutocompleteItem[] | null {
	try {
		const { kindResolver } = require("../resource-management/index") as typeof import("../resource-management/index");
		const kinds = kindResolver.getKindsWithApiPaths();
		const lower = prefix.toLowerCase();
		const items = kinds
			.filter(k => k.toLowerCase().startsWith(lower))
			.slice(0, 20)
			.map(k => ({ value: `${k} `, label: k }));
		return items.length > 0 ? items : null;
	} catch {
		return null;
	}
}

export async function handleResourceCommand(
	commandName: string,
	command: ParsedBuiltinSlashCommand,
	ctx: InteractiveModeContext,
): Promise<void> {
	ctx.editor.addToHistory(command.text);
	ctx.editor.setText("");

	const {
		parseResourceArgs,
		ResourceClient,
		readManifestInputs,
		runResourceOperation,
		formatResourceOperationReport,
		ManifestFileError,
		ManifestParseError,
		KindResolutionError,
		formatResourceList,
		formatResourceDetail,
	} = await import("@f5-sales-demo/pi-resource-management");
	type ManifestOperationInput = import("@f5-sales-demo/pi-resource-management").ManifestOperationInput;
	const { kindResolver } = await import("../resource-management/index");

	const parsed = parseResourceArgs(command.args);
	if ("error" in parsed) {
		ctx.showStatus(parsed.error);
		return;
	}

	const { ContextService } = await import("../services/xcsh-context");
	const { createContextEnv } = await import("../services/context-env");
	const { settings } = await import("../config/settings");

	let svc: typeof ContextService.prototype;
	try {
		svc = ContextService.instance;
	} catch {
		ctx.showStatus("No F5 XC context active. Run /context create to configure one first.");
		return;
	}

	const status = svc.getStatus();
	if (!status.isConfigured) {
		ctx.showStatus("No F5 XC context active. Run /context create to configure one first.");
		return;
	}

	const contextEnv = createContextEnv(settings);
	const apiUrl = contextEnv.get("XCSH_API_URL");
	const apiToken = contextEnv.get("XCSH_API_TOKEN");
	const defaultNamespace = contextEnv.get("XCSH_NAMESPACE") ?? "";

	if (!apiUrl || !apiToken) {
		ctx.showStatus("Missing API credentials. Check your context configuration.");
		return;
	}

	const client = new ResourceClient({
		apiUrl,
		apiToken,
		namespace: defaultNamespace,
		resolvePayloadVars: (json: string) => contextEnv.resolvePayloadVars(json),
	});

	const runBatch = async (
		operation: "apply" | "create" | "delete" | "diff",
		inputs: ManifestOperationInput[],
	): Promise<void> => {
		const report = await runResourceOperation({
			operation,
			inputs,
			kindResolver,
			client,
			namespaceOverride: parsed.namespace,
			defaultNamespace,
			dryRun: parsed.dryRun,
		});
		ctx.showStatus(formatResourceOperationReport(report, parsed.outputFormat));
	};

	try {
		switch (commandName) {
			case "apply":
			case "create": {
				if (parsed.filenames.length === 0) {
					ctx.showStatus(`Usage: /${commandName} -f <file.json|file.yaml|dir/> [-n namespace] [--dry-run=client]`);
					return;
				}
				const inputs = await readManifestInputs(parsed.filenames, parsed.recursive);
				if (inputs.length === 0) {
					ctx.showStatus("No resources found in the specified file(s).");
					return;
				}
				await runBatch(commandName, inputs);
				break;
			}

			case "delete": {
				let inputs: ManifestOperationInput[];
				if (parsed.filenames.length > 0) {
					inputs = await readManifestInputs(parsed.filenames, parsed.recursive);
				} else if (parsed.kind && parsed.name) {
					const namespace = parsed.namespace ?? defaultNamespace;
					const rawObject = { kind: parsed.kind, metadata: { name: parsed.name, namespace }, spec: {} };
					inputs = [
						{
							index: 0,
							sourcePath: "command-line",
							manifest: { kind: parsed.kind, metadata: { name: parsed.name, namespace }, spec: {}, rawObject },
						},
					];
				} else {
					ctx.showStatus("Usage: /delete -f <file> or /delete <kind> <name> [-n namespace]");
					return;
				}
				await runBatch("delete", inputs);
				break;
			}

			case "describe": {
				if (!parsed.kind) {
					ctx.showStatus("Usage: /describe <kind> <name> [-n namespace] [-o json|yaml]");
					return;
				}
				const kind = parsed.kind;
				const name = parsed.name;
				if (!name) {
					ctx.showStatus("Usage: /describe <kind> <name> [-n namespace] [-o json|yaml]");
					return;
				}
				const report = await runResourceOperation({
					operation: "get",
					kind,
					name,
					kindResolver,
					client,
					namespaceOverride: parsed.namespace,
					defaultNamespace,
				});
				const result = report.results[0];
				if (result?.error) {
					ctx.showStatus(`Error: ${result.error.message}`);
					return;
				}
				if (result?.resource) {
					ctx.showStatus(formatResourceDetail(result.resource, kind, parsed.outputFormat));
				}
				break;
			}

			case "diff": {
				if (parsed.filenames.length === 0) {
					ctx.showStatus("Usage: /diff -f <file.json|file.yaml> [-n namespace]");
					return;
				}
				await runBatch("diff", await readManifestInputs(parsed.filenames, parsed.recursive));
				break;
			}

			case "get": {
				if (!parsed.kind) {
					ctx.showStatus("Usage: /get <kind> [name] [-n namespace] [-o json|yaml|table]");
					return;
				}
				const report = await runResourceOperation({
					operation: "get",
					kind: parsed.kind,
					name: parsed.name,
					kindResolver,
					client,
					namespaceOverride: parsed.namespace,
					defaultNamespace,
				});
				const result = report.results[0];
				if (result?.error) {
					ctx.showStatus(`Error: ${result.error.message}`);
					return;
				}
				if (result?.items) {
					ctx.showStatus(formatResourceList(result.items, parsed.kind, parsed.outputFormat));
				} else if (result?.resource) {
					ctx.showStatus(formatResourceDetail(result.resource, parsed.kind, parsed.outputFormat));
				}
				break;
			}
		}
	} catch (err) {
		if (err instanceof ManifestFileError || err instanceof ManifestParseError || err instanceof KindResolutionError) {
			ctx.showStatus(`Error: ${err.message}`);
		} else {
			ctx.showStatus(`Unexpected error: ${(err as Error).message}`);
		}
	}
}

export { getKindCompletions };
