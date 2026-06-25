import type { AutocompleteItem } from "@f5xc-salesdemos/pi-tui";
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
		readManifestFiles,
		ManifestFileError,
		parseManifests,
		ManifestParseError,
		KindResolutionError,
		validateManifest,
		formatValidationErrors,
		formatOperationResult,
		formatResourceList,
		formatResourceDetail,
		formatMultiOperationSummary,
		formatDiff,
	} = await import("@f5xc-salesdemos/pi-resource-management");
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
		namespace: parsed.namespace ?? defaultNamespace,
		resolvePayloadVars: (json: string) => contextEnv.resolvePayloadVars(json),
	});

	const ns = parsed.namespace ?? defaultNamespace;

	try {
		switch (commandName) {
			case "apply":
			case "create": {
				if (parsed.filenames.length === 0) {
					ctx.showStatus(
						`Usage: /${commandName} -f <file.json|file.yaml|dir/> [-n namespace] [--dry-run=client|server]`,
					);
					return;
				}
				const fileResults = await readManifestFiles(parsed.filenames, parsed.recursive);
				const allObjects = fileResults.flatMap(r => r.objects);
				if (allObjects.length === 0) {
					ctx.showStatus("No resources found in the specified file(s).");
					return;
				}
				const manifests = parseManifests(allObjects, fileResults[0]?.sourcePath ?? "input");
				const results = [];
				for (const manifest of manifests) {
					const { result: valResult, resolved } = validateManifest(manifest, kindResolver, ns);
					if (!valResult.valid) {
						ctx.showStatus(formatValidationErrors(manifest, valResult));
						results.push({
							status: "error" as const,
							error: { kind: "validation" as const, message: "Validation failed" },
						});
						continue;
					}
					if (!resolved) continue;

					const opResult =
						commandName === "apply"
							? await client.apply(manifest, resolved, ns, parsed.dryRun)
							: await client.create(manifest, resolved, ns, parsed.dryRun);

					results.push(opResult);
					ctx.showStatus(formatOperationResult(opResult, manifest, parsed.outputFormat));
				}

				if (manifests.length > 1) {
					ctx.showStatus(formatMultiOperationSummary(results as any, manifests));
				}
				break;
			}

			case "delete": {
				let deleteTargets: { kind: string; name: string }[] = [];

				if (parsed.filenames.length > 0) {
					const fileResults = await readManifestFiles(parsed.filenames, parsed.recursive);
					const allObjects = fileResults.flatMap(r => r.objects);
					const manifests = parseManifests(allObjects, fileResults[0]?.sourcePath ?? "input");
					deleteTargets = manifests.map(m => ({ kind: m.kind, name: m.metadata.name }));
				} else if (parsed.kind && parsed.name) {
					deleteTargets = [{ kind: parsed.kind, name: parsed.name }];
				} else {
					ctx.showStatus("Usage: /delete -f <file> or /delete <kind> <name> [-n namespace] [--force]");
					return;
				}

				for (const target of deleteTargets) {
					const resolved = kindResolver.resolveKind(target.kind);
					const result = await client.delete(target.kind, target.name, resolved, ns);
					ctx.showStatus(
						formatOperationResult(
							result,
							{ kind: target.kind, metadata: { name: target.name }, spec: {}, rawObject: {} } as any,
							parsed.outputFormat,
						),
					);
				}
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
				const resolved = kindResolver.resolveKind(kind);
				const result = await client.get(resolved, name, ns);
				if (result.error) {
					ctx.showStatus(`Error: ${result.error.message}`);
					return;
				}
				if (result.resource) {
					ctx.showStatus(formatResourceDetail(result.resource, kind, parsed.outputFormat));
				}
				break;
			}

			case "diff": {
				if (parsed.filenames.length === 0) {
					ctx.showStatus("Usage: /diff -f <file.json|file.yaml> [-n namespace]");
					return;
				}
				const fileResults = await readManifestFiles(parsed.filenames, parsed.recursive);
				const allObjects = fileResults.flatMap(r => r.objects);
				const manifests = parseManifests(allObjects, fileResults[0]?.sourcePath ?? "input");

				for (const manifest of manifests) {
					const { result: valResult, resolved } = validateManifest(manifest, kindResolver, ns);
					if (!valResult.valid || !resolved) {
						ctx.showStatus(formatValidationErrors(manifest, valResult));
						continue;
					}
					const diffResult = await client.diff(manifest, resolved, ns);
					if (diffResult.error) {
						ctx.showStatus(`Error: ${diffResult.error.message}`);
						continue;
					}
					if (diffResult.isNew) {
						ctx.showStatus(`${manifest.kind}/${manifest.metadata.name} does not exist yet — will be created.`);
						continue;
					}
					if (diffResult.diff) {
						ctx.showStatus(formatDiff(diffResult.diff, manifest.kind, manifest.metadata.name));
					}
				}
				break;
			}

			case "get": {
				if (!parsed.kind) {
					ctx.showStatus("Usage: /get <kind> [name] [-n namespace] [-o json|yaml|table]");
					return;
				}
				const resolved = kindResolver.resolveKind(parsed.kind);
				const result = await client.get(resolved, parsed.name, ns);
				if (result.error) {
					ctx.showStatus(`Error: ${result.error.message}`);
					return;
				}
				if (result.items) {
					ctx.showStatus(formatResourceList(result.items, parsed.kind, parsed.outputFormat));
				} else if (result.resource) {
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
