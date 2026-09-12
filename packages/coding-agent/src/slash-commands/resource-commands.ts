import { createHash } from "node:crypto";
import type {
	ManifestOperationInput,
	ResourceOperationItem,
	ResourceOperationReport,
} from "@f5-sales-demo/pi-resource-management";
import type { AutocompleteItem } from "@f5-sales-demo/pi-tui";
import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import { ReportDetailsComponent } from "../modes/components/selector-frame";
import type { InteractiveModeContext } from "../modes/types";

interface ParsedBuiltinSlashCommand {
	name: string;
	args: string;
	text: string;
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonical(item)]),
		);
	return value;
}

function digest(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}

function resourceIdentity(
	input: ManifestOperationInput,
	namespaceOverride: string | undefined,
	fallback: string,
): string {
	const namespace = namespaceOverride ?? input.manifest.metadata.namespace ?? fallback;
	return `${input.manifest.kind}/${input.manifest.metadata.name} · namespace ${namespace || "default"}`;
}

function preflightSummary(item: ResourceOperationItem | undefined, operation: "apply" | "create" | "delete"): string {
	if (!item) return "Unavailable";
	if (item.error) return `Unavailable (${item.error.kind})`;
	if (operation === "delete") return `Present · SHA256 ${digest(item.resource).slice(0, 12)}`;
	if (item.isNew) return "Absent";
	if (item.diff)
		return item.diff.hasDifferences
			? `Present · ${item.diff.added.length} added, ${item.diff.changed.length} changed, ${item.diff.removed.length} removed fields`
			: "Present · already matches";
	return item.status;
}

async function showResourceReport(
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

function operationReport(
	operation: "apply" | "create" | "delete",
	results: ResourceOperationItem[],
): ResourceOperationReport {
	const failed = results.filter(result => result.status === "error" || result.status === "skipped").length;
	const counts: ResourceOperationReport["counts"] = {
		total: results.length,
		succeeded: results.length - failed,
		failed,
	};
	for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
	return { schemaVersion: 1, operation, success: failed === 0, counts, results };
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
	const { kindResolver } = await import("../resource-management/index");

	const parsed = parseResourceArgs(command.args);
	if ("error" in parsed) {
		ctx.showStatus(parsed.error);
		return;
	}

	const { ContextService } = await import("../services/xcsh-context");
	const { createContextEnv } = await import("../services/context-env");
	const { settings } = await import("../config/settings");

	const loadConnection = () => {
		let svc: typeof ContextService.prototype;
		try {
			svc = ContextService.instance;
		} catch {
			throw new Error("No F5 XC context active. Run /context create to configure one first.");
		}
		const status = svc.getStatus();
		if (!status.isConfigured) throw new Error("No F5 XC context active. Run /context create to configure one first.");
		const contextEnv = createContextEnv(settings);
		const apiUrl = contextEnv.get("XCSH_API_URL");
		const apiToken = contextEnv.get("XCSH_API_TOKEN");
		const defaultNamespace = contextEnv.get("XCSH_NAMESPACE") ?? "";
		if (!apiUrl || !apiToken) throw new Error("Missing API credentials. Check your context configuration.");
		return {
			apiUrl,
			defaultNamespace,
			credentialRevision: digest({ apiUrl, apiToken, defaultNamespace, status }),
			client: new ResourceClient({
				apiUrl,
				apiToken,
				namespace: defaultNamespace,
				resolvePayloadVars: (json: string) => contextEnv.resolvePayloadVars(json),
			}),
		};
	};

	const runReadOnly = async (
		operation: "diff" | "get",
		inputs?: ManifestOperationInput[],
		kind?: string,
		name?: string,
	) => {
		const connection = loadConnection();
		return runResourceOperation({
			operation,
			inputs,
			kind,
			name,
			kindResolver,
			client: connection.client,
			namespaceOverride: parsed.namespace,
			defaultNamespace: connection.defaultNamespace,
		});
	};

	const runBatch = async (
		operation: "apply" | "create" | "delete" | "diff",
		inputs: ManifestOperationInput[],
	): Promise<void> => {
		if (operation === "diff" || parsed.dryRun) {
			const connection = loadConnection();
			const report = await runResourceOperation({
				operation,
				inputs,
				kindResolver,
				client: connection.client,
				namespaceOverride: parsed.namespace,
				defaultNamespace: connection.defaultNamespace,
				dryRun: parsed.dryRun,
			});
			await showResourceReport(
				ctx,
				operation === "diff" ? "Resource differences" : `Resource ${operation} dry run`,
				parsed.dryRun
					? "Client dry run; no remote resources were changed"
					: "Live state compared with the supplied manifests; no resources were changed",
				formatResourceOperationReport(report, parsed.outputFormat),
			);
			return;
		}

		const completed = new Set<string>();
		const observed = new Map<string, ResourceOperationItem>();
		let latestReport: ResourceOperationReport | undefined;
		const prepare = async () => {
			const connection = loadConnection();
			const freshInputs = await readManifestInputs(parsed.filenames, parsed.recursive);
			const sourceInputs = parsed.filenames.length > 0 ? freshInputs : inputs;
			const pending = sourceInputs.filter(
				input => !completed.has(resourceIdentity(input, parsed.namespace, connection.defaultNamespace)),
			);
			if (pending.length === 0) throw new Error("All reviewed resources have already completed.");
			const preflight = await runResourceOperation({
				operation: operation === "delete" ? "get" : "diff",
				inputs: pending,
				kindResolver,
				client: connection.client,
				namespaceOverride: parsed.namespace,
				defaultNamespace: connection.defaultNamespace,
			});
			if (!preflight.success)
				throw new Error(
					`Target resolution failed; no changes were made. ${formatResourceOperationReport(preflight, "table")}`,
				);
			const identities = pending.map(input =>
				resourceIdentity(input, parsed.namespace, connection.defaultNamespace),
			);
			const namespaces = [
				...new Set(
					pending.map(
						input =>
							(parsed.namespace ?? input.manifest.metadata.namespace ?? connection.defaultNamespace) ||
							"default",
					),
				),
			];
			let endpoint = connection.apiUrl;
			try {
				endpoint = new URL(connection.apiUrl).origin;
			} catch {
				// Keep the configured endpoint when it is not a standard URL.
			}
			const review: ActionReview = {
				identity: `xc-resource-batch:${operation}:${digest({ files: parsed.filenames, typed: inputs.map(i => i.sourcePath) }).slice(0, 16)}`,
				scope: `F5 XC ${endpoint} · namespace${namespaces.length === 1 ? "" : "s"} ${namespaces.join(", ")}`,
				revision: digest({
					credential: connection.credentialRevision,
					inputs: pending,
					preflight,
					completed: [...completed].sort(),
				}),
				changes: pending.map((input, index) => ({
					field: identities[index],
					before: preflightSummary(preflight.results[index], operation),
					after:
						operation === "delete"
							? "Removed"
							: `Desired manifest · SHA256 ${digest(input.manifest).slice(0, 12)}`,
				})),
				consequence:
					operation === "delete"
						? `Permanently deletes ${pending.length} resolved remote resource${pending.length === 1 ? "" : "s"}. Only unresolved failures are offered on retry.`
						: `${operation === "create" ? "Creates" : "Creates or updates"} ${pending.length} remote resource${pending.length === 1 ? "" : "s"} from the supplied manifests. Review summaries intentionally omit manifest values that may contain secrets. Only unresolved failures are offered on retry.`,
			};
			return { review, target: { connection, inputs: pending } };
		};

		const proposal = await prepare();
		const outcome = await runReviewedAction(ctx, `resource ${operation}`, {
			review: proposal.review,
			resolve: prepare,
			execute: async target => {
				let failures = 0;
				for (const input of target.inputs) {
					const report = await runResourceOperation({
						operation,
						inputs: [input],
						kindResolver,
						client: target.connection.client,
						namespaceOverride: parsed.namespace,
						defaultNamespace: target.connection.defaultNamespace,
					});
					const key = resourceIdentity(input, parsed.namespace, target.connection.defaultNamespace);
					const result = report.results[0] ?? {
						index: input.index,
						kind: input.manifest.kind,
						name: input.manifest.metadata.name,
						status: "error",
						error: { kind: "api", message: "Operation returned no result." },
					};
					observed.set(key, result);
					if (report.success) completed.add(key);
					else failures++;
				}
				latestReport = operationReport(operation, [...observed.values()]);
				if (failures > 0)
					throw new Error(
						`${failures} resource operation${failures === 1 ? "" : "s"} failed. Successful resources will not be retried.`,
					);
			},
		});
		if (outcome === "busy") {
			ctx.showStatus("Another reviewed action is already open.");
			return;
		}
		if (latestReport && (outcome === "succeeded" || outcome === "unresolved"))
			await showResourceReport(
				ctx,
				latestReport.success ? `Resource ${operation} complete` : `Resource ${operation} partially failed`,
				latestReport.success
					? "Backing operations completed; this is the observed remote result"
					: "Completed resources are retained; reopen or retry only unresolved operations",
				formatResourceOperationReport(latestReport, parsed.outputFormat),
			);
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
					const namespace = parsed.namespace ?? loadConnection().defaultNamespace;
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
				const report = await runReadOnly("get", undefined, kind, name);
				const result = report.results[0];
				if (result?.error) {
					ctx.showError(result.error.message);
					return;
				}
				if (result?.resource) {
					await showResourceReport(
						ctx,
						`${kind}/${name}`,
						`Resolved remote resource · namespace ${parsed.namespace ?? (loadConnection().defaultNamespace || "default")}`,
						formatResourceDetail(result.resource, kind, parsed.outputFormat),
					);
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
				const report = await runReadOnly("get", undefined, parsed.kind, parsed.name);
				const result = report.results[0];
				if (result?.error) {
					ctx.showError(result.error.message);
					return;
				}
				if (result?.items) {
					await showResourceReport(
						ctx,
						`${parsed.kind} resources`,
						`Remote list · namespace ${parsed.namespace ?? (loadConnection().defaultNamespace || "default")}`,
						formatResourceList(result.items, parsed.kind, parsed.outputFormat),
					);
				} else if (result?.resource) {
					await showResourceReport(
						ctx,
						`${parsed.kind}/${parsed.name}`,
						`Resolved remote resource · namespace ${parsed.namespace ?? (loadConnection().defaultNamespace || "default")}`,
						formatResourceDetail(result.resource, parsed.kind, parsed.outputFormat),
					);
				}
				break;
			}
		}
	} catch (err) {
		if (err instanceof ManifestFileError || err instanceof ManifestParseError || err instanceof KindResolutionError) {
			ctx.showError(err.message);
		} else {
			ctx.showError((err as Error).message);
		}
	}
}

export { getKindCompletions };
