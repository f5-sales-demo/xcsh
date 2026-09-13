import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AutocompleteItem } from "@f5-sales-demo/pi-tui";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../modes/components/selector-frame";
import type { InteractiveModeContext } from "../modes/types";

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

interface DestinationState {
	path: string;
	exists: boolean;
	hash?: string;
	size?: number;
	mode?: string;
}

interface ManifestOutputFile {
	path: string;
	content: string;
	before: DestinationState;
	hash: string;
}

function digest(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

/**
 * macOS exposes /var and /tmp as documented logical aliases for /private/var
 * and /private/tmp. Treat only those platform aliases as equivalent; a caller
 * supplied symlink elsewhere remains a rejected export parent.
 */
function isExpectedResolvedDirectory(requested: string, resolved: string): boolean {
	const absolute = path.resolve(requested);
	const expected =
		process.platform === "darwin" && (absolute === "/var" || absolute.startsWith("/var/"))
			? `/private${absolute}`
			: process.platform === "darwin" && (absolute === "/tmp" || absolute.startsWith("/tmp/"))
				? `/private${absolute}`
				: absolute;
	return resolved === expected;
}

async function inspectDestination(filePath: string): Promise<DestinationState> {
	try {
		const stats = await fs.lstat(filePath);
		if (!stats.isFile() || stats.isSymbolicLink())
			throw new Error(`Refusing non-regular export destination: ${filePath}`);
		const content = await fs.readFile(filePath);
		return {
			path: filePath,
			exists: true,
			hash: digest(content),
			size: stats.size,
			mode: (stats.mode & 0o777).toString(8).padStart(3, "0"),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: filePath, exists: false };
		throw error;
	}
}

async function showManifestReport(
	ctx: InteractiveModeContext,
	title: string,
	purpose: string,
	content: string,
): Promise<void> {
	await ctx.showHookCustom<void>(
		(ui, _theme, _keys, done) =>
			new ReportDetailsComponent(
				title,
				purpose,
				content,
				() => done(),
				() => ui.terminal.rows,
			),
		{ overlay: true, fullscreen: true },
	);
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
	} = await import("@f5-sales-demo/pi-resource-management");
	const { kindResolver } = await import("../resource-management/index");

	const parsed = parseExportArgs(command.args);
	if ("error" in parsed) {
		ctx.showStatus(parsed.error);
		return;
	}

	const { ContextService } = await import("../services/xcsh-context");
	const { createContextEnv } = await import("../services/context-env");
	const { settings } = await import("../config/settings");

	const fmt = parsed.outputFormat;

	try {
		type Manifest = { kind: string; metadata: Record<string, unknown>; spec: Record<string, unknown> };
		const loadConnection = () => {
			let svc: typeof ContextService.prototype;
			try {
				svc = ContextService.instance;
			} catch {
				throw new Error("No F5 XC context active. Run /context create to configure one first.");
			}
			const status = svc.getStatus();
			if (!status.isConfigured)
				throw new Error("No F5 XC context active. Run /context create to configure one first.");
			const contextEnv = createContextEnv(settings);
			const apiUrl = contextEnv.get("XCSH_API_URL");
			const apiToken = contextEnv.get("XCSH_API_TOKEN");
			const defaultNamespace = contextEnv.get("XCSH_NAMESPACE") ?? "";
			if (!apiUrl || !apiToken) throw new Error("Missing API credentials. Check your context configuration.");
			const namespace = parsed.namespace ?? defaultNamespace;
			return {
				apiUrl,
				namespace,
				revision: digest(JSON.stringify({ apiUrl, apiToken, namespace, status })),
				client: new ResourceClient({ apiUrl, apiToken, namespace }),
			};
		};

		const fetchSnapshot = async () => {
			const connection = loadConnection();
			const manifests: Manifest[] = [];
			const warnings: string[] = [];
			if (parsed.all) {
				const result = await connection.client.exportAll(kindResolver, connection.namespace, (kind, count) => {
					ctx.showStatus(`Loading ${kind} (${count} found)…`);
				});
				warnings.push(...result.errors.map(error => `${error.kind}: ${error.error.message}`));
				manifests.push(...result.manifests);
			} else if (parsed.kind && parsed.name) {
				const resolved = kindResolver.resolveKind(parsed.kind);
				const result = await connection.client.exportOne(parsed.kind, resolved, parsed.name, connection.namespace);
				if (result.error) throw new Error(result.error.message);
				if (result.manifest) manifests.push(result.manifest);
			} else if (parsed.kind) {
				const resolved = kindResolver.resolveKind(parsed.kind);
				const result = await connection.client.get(resolved, undefined, connection.namespace);
				if (result.error) throw new Error(result.error.message);
				for (const item of result.items ?? []) manifests.push(toManifest(item, parsed.kind));
			}
			for (const manifest of manifests) {
				const filter = buildMinimalExportFilter(manifest.kind);
				if (filter) manifest.spec = applyMinimalExportFilter(manifest.spec, filter);
			}
			return { connection, manifests, warnings };
		};

		const first = await fetchSnapshot();
		if (first.manifests.length === 0) {
			await showManifestReport(
				ctx,
				"Manifest export",
				"No matching remote resources; no local files were written",
				first.warnings.length > 0 ? first.warnings.join("\n") : "No resources found to export.",
			);
			return;
		}
		if (!parsed.outputFile) {
			const output = formatManifestOutput(first.manifests, fmt);
			await showManifestReport(
				ctx,
				"Resource manifests",
				`Read-only export · namespace ${first.connection.namespace || "default"}${first.warnings.length ? ` · ${first.warnings.length} unavailable kind(s)` : ""}`,
				[first.warnings.length ? `Warnings:\n${first.warnings.join("\n")}\n` : "", output].join("\n"),
			);
			return;
		}

		const completed = new Set<string>();
		const outcomes = new Map<string, string>();
		const buildFiles = async (manifests: Manifest[]): Promise<ManifestOutputFile[]> => {
			const files: Array<Omit<ManifestOutputFile, "before">> = [];
			if (parsed.outputFile!.endsWith("/")) {
				const base = path.resolve(parsed.outputFile!);
				const extension = fmt === "yaml" ? "yaml" : "json";
				for (const manifest of manifests) {
					const safeKind = manifest.kind.replace(/[/\\]/g, "_");
					const safeName = String(manifest.metadata.name ?? "unknown").replace(/[/\\]/g, "_");
					const destination = path.resolve(base, `${safeKind}-${safeName}.${extension}`);
					if (!destination.startsWith(`${base}${path.sep}`))
						throw new Error(`Unsafe resource export name: ${manifest.metadata.name}`);
					const content = formatManifestOutput([manifest], fmt);
					files.push({ path: destination, content, hash: digest(content) });
				}
			} else {
				const content = formatManifestOutput(manifests, fmt);
				files.push({ path: path.resolve(parsed.outputFile!), content, hash: digest(content) });
			}
			const pending = files.filter(file => !completed.has(file.path));
			return Promise.all(pending.map(async file => ({ ...file, before: await inspectDestination(file.path) })));
		};

		let latestWarnings: string[] = [];
		const prepare = async () => {
			const snapshot = await fetchSnapshot();
			latestWarnings = snapshot.warnings;
			const files = await buildFiles(snapshot.manifests);
			if (files.length === 0) throw new Error("All reviewed manifest files have already completed.");
			let endpoint = snapshot.connection.apiUrl;
			try {
				endpoint = new URL(endpoint).origin;
			} catch {
				// Keep the configured endpoint when it is not a standard URL.
			}
			const review: ActionReview = {
				identity: `manifest-export:${digest(path.resolve(parsed.outputFile!)).slice(0, 16)}`,
				scope: `Local manifest export · ${path.resolve(parsed.outputFile!)}`,
				revision: digest(
					JSON.stringify({
						connection: snapshot.connection.revision,
						namespace: snapshot.connection.namespace,
						files: files.map(file => ({ path: file.path, before: file.before, hash: file.hash })),
						warnings: snapshot.warnings,
					}),
				),
				changes: files.map(file => ({
					field: file.path,
					before: file.before.exists
						? `${file.before.size} bytes · SHA256 ${file.before.hash?.slice(0, 12)} · permissions ${file.before.mode}`
						: "Absent",
					after:
						file.before.hash === file.hash
							? `${file.content.length} bytes · SHA256 ${file.hash.slice(0, 12)} (unchanged; no write)`
							: `${file.content.length} bytes · SHA256 ${file.hash.slice(0, 12)} · permissions 600`,
				})),
				consequence: `Writes ${files.length} local manifest file${files.length === 1 ? "" : "s"} from ${endpoint}, namespace ${snapshot.connection.namespace || "default"}. Existing changed files are atomically replaced; matching files are not written.${snapshot.warnings.length ? ` ${snapshot.warnings.length} remote kind(s) were unavailable and are omitted.` : ""} Only unresolved file failures are offered on retry.`,
			};
			return { review, target: files };
		};

		const proposal = await prepare();
		const outcome = await runReviewedAction(ctx, "manifest file export", {
			review: proposal.review,
			resolve: prepare,
			execute: async files => {
				let failures = 0;
				for (const file of files) {
					try {
						if (JSON.stringify(await inspectDestination(file.path)) !== JSON.stringify(file.before))
							throw new Error("Destination changed after review");
						if (file.before.hash !== file.hash) {
							const parent = path.dirname(file.path);
							await fs.mkdir(parent, { recursive: true });
							if (!isExpectedResolvedDirectory(parent, await fs.realpath(parent)))
								throw new Error("Destination parent resolves through a symbolic link");
							const temporary = path.join(parent, `.xcsh-manifest-${Snowflake.next()}.tmp`);
							const handle = await fs.open(temporary, "wx", 0o600);
							try {
								await handle.writeFile(file.content, "utf8");
								await handle.sync();
								await handle.close();
								if (JSON.stringify(await inspectDestination(file.path)) !== JSON.stringify(file.before))
									throw new Error("Destination changed while preparing the write");
								await fs.rename(temporary, file.path);
							} finally {
								await handle.close().catch(() => {});
								await fs.unlink(temporary).catch(() => {});
							}
						}
						completed.add(file.path);
						outcomes.set(file.path, file.before.hash === file.hash ? "unchanged" : "written");
					} catch (error) {
						failures++;
						outcomes.set(file.path, `error: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
				if (failures)
					throw new Error(
						`${failures} manifest file${failures === 1 ? "" : "s"} failed. Completed files will not be retried.`,
					);
			},
		});
		if (outcome === "busy") ctx.showStatus("Another reviewed action is already open.");
		else if (outcomes.size > 0 && (outcome === "succeeded" || outcome === "unresolved"))
			await showManifestReport(
				ctx,
				outcome === "succeeded" ? "Manifest export complete" : "Manifest export partially failed",
				`Observed local file results${latestWarnings.length ? ` · ${latestWarnings.length} remote warning(s)` : ""}`,
				[
					...Array.from(outcomes.entries(), ([destination, result]) => `${destination}: ${result}`),
					...latestWarnings.map(warning => `remote warning: ${warning}`),
				].join("\n"),
			);
	} catch (err) {
		if (err instanceof KindResolutionError) {
			ctx.showError(err.message);
		} else {
			ctx.showError((err as Error).message);
		}
	}
}

export { getExportKindCompletions };
