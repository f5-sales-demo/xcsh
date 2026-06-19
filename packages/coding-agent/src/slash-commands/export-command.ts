import type { AutocompleteItem } from "@f5xc-salesdemos/pi-tui";
import type { InteractiveModeContext } from "../modes/types";

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

function getExportKindCompletions(prefix: string): AutocompleteItem[] | null {
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

export async function handleExportResourceCommand(
	command: ParsedBuiltinSlashCommand,
	ctx: InteractiveModeContext,
): Promise<void> {
	ctx.editor.addToHistory(command.text);
	ctx.editor.setText("");

	const {
		parseExportArgs,
		ResourceClient,
		KindResolutionError,
		toManifest,
		formatManifestOutput,
		buildMinimalExportFilter,
		applyMinimalExportFilter,
	} = await import("@f5xc-salesdemos/pi-resource-management");
	const { kindResolver } = await import("../resource-management/index");

	const parsed = parseExportArgs(command.args);
	if ("error" in parsed) {
		ctx.showStatus(parsed.error);
		return;
	}

	const { ContextService } = await import("../services/f5xc-context");
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
	const apiUrl = contextEnv.get("F5XC_API_URL");
	const apiToken = contextEnv.get("F5XC_API_TOKEN");
	const defaultNamespace = contextEnv.get("F5XC_NAMESPACE") ?? "";

	if (!apiUrl || !apiToken) {
		ctx.showStatus("Missing API credentials. Check your context configuration.");
		return;
	}

	const ns = parsed.namespace ?? defaultNamespace;
	const client = new ResourceClient({
		apiUrl,
		apiToken,
		namespace: ns,
	});

	const fmt = parsed.outputFormat;

	try {
		const manifests: Array<{ kind: string; metadata: Record<string, unknown>; spec: Record<string, unknown> }> = [];

		if (parsed.all) {
			const result = await client.exportAll(kindResolver, ns, (kind, count) => {
				ctx.showStatus(`Exporting ${kind} (${count} found)...`);
			});

			for (const err of result.errors) {
				ctx.showStatus(`Warning: ${err.kind}: ${err.error.message}`);
			}

			manifests.push(...result.manifests);
		} else if (parsed.kind && parsed.name) {
			const resolved = kindResolver.resolveKind(parsed.kind);
			const result = await client.exportOne(parsed.kind, resolved, parsed.name, ns);
			if (result.error) {
				ctx.showStatus(`Error: ${result.error.message}`);
				return;
			}
			manifests.push(result.manifest!);
		} else if (parsed.kind) {
			const resolved = kindResolver.resolveKind(parsed.kind);
			const getResult = await client.get(resolved, undefined, ns);
			if (getResult.error) {
				ctx.showStatus(`Error: ${getResult.error.message}`);
				return;
			}
			if (!getResult.items || getResult.items.length === 0) {
				ctx.showStatus(`No ${parsed.kind} resources found.`);
				return;
			}
			for (const item of getResult.items) {
				manifests.push(toManifest(item, parsed.kind));
			}
		}

		if (manifests.length === 0) {
			ctx.showStatus("No resources found to export.");
			return;
		}

		// Emit only minimum (non-default) settings: strip server-applied defaults
		// per kind. Kinds with no defaults coverage are left untouched (full spec).
		for (const m of manifests) {
			const filter = buildMinimalExportFilter(m.kind);
			if (filter) {
				m.spec = applyMinimalExportFilter(m.spec, filter);
			}
		}

		const output = formatManifestOutput(manifests, fmt);

		if (parsed.outputFile) {
			const { writeFile, mkdir } = await import("node:fs/promises");
			const { dirname, resolve, sep } = await import("node:path");
			const isDir = parsed.outputFile.endsWith("/");

			if (isDir) {
				await mkdir(parsed.outputFile, { recursive: true });
				const baseDir = resolve(parsed.outputFile);
				const ext = fmt === "yaml" ? "yaml" : "json";
				for (const m of manifests) {
					const safeKind = m.kind.replace(/[/\\]/g, "_");
					const safeName = ((m.metadata.name as string) ?? "unknown").replace(/[/\\]/g, "_");
					const filename = `${safeKind}-${safeName}.${ext}`;
					const filepath = resolve(parsed.outputFile, filename);
					if (!filepath.startsWith(baseDir + sep) && filepath !== baseDir) {
						ctx.showStatus(`Skipping unsafe resource name: ${m.metadata.name}`);
						continue;
					}
					const content = formatManifestOutput([m], fmt);
					await writeFile(filepath, content, "utf-8");
				}
				ctx.showStatus(`Exported ${manifests.length} resource(s) to ${parsed.outputFile}`);
			} else {
				await mkdir(dirname(parsed.outputFile), { recursive: true });
				await writeFile(parsed.outputFile, output, "utf-8");
				ctx.showStatus(`Exported ${manifests.length} resource(s) to ${parsed.outputFile}`);
			}
		} else {
			ctx.showStatus(output);
		}
	} catch (err) {
		if (err instanceof KindResolutionError) {
			ctx.showStatus(`Error: ${err.message}`);
		} else {
			ctx.showStatus(`Unexpected error: ${(err as Error).message}`);
		}
	}
}

export { getExportKindCompletions };
