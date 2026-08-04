import { stringify as yamlStringify } from "yaml";
import { formatDiff } from "./diff-engine";
import { readManifestFiles } from "./file-reader";
import { toManifestList } from "./manifest-export";
import { parseManifests } from "./manifest-parser";
import { validateManifest } from "./manifest-validator";
import type { ResourceClient } from "./resource-client";
import type {
	KindResolver,
	ManifestOperationInput,
	OperationResult,
	ResourceError,
	ResourceOperation,
	ResourceOperationItem,
	ResourceOperationReport,
} from "./types";

export interface RunResourceOperationOptions {
	operation: ResourceOperation;
	kindResolver: KindResolver;
	client?: ResourceClient;
	inputs?: ManifestOperationInput[];
	kind?: string;
	name?: string;
	all?: boolean;
	namespaceOverride?: string;
	defaultNamespace?: string;
	dryRun?: "client";
}

const MANIFEST_OPERATIONS = new Set<ResourceOperation>(["apply", "create", "update", "delete", "diff", "validate"]);

export async function readManifestInputs(filenames: string[], recursive: boolean): Promise<ManifestOperationInput[]> {
	const files = await readManifestFiles(filenames, recursive);
	const inputs: ManifestOperationInput[] = [];
	let index = 0;
	for (const file of files) {
		for (const manifest of parseManifests(file.objects, file.sourcePath)) {
			inputs.push({ index, sourcePath: file.sourcePath, manifest });
			index++;
		}
	}
	return inputs;
}

export async function runResourceOperation(options: RunResourceOperationOptions): Promise<ResourceOperationReport> {
	if (options.operation === "get" && options.inputs !== undefined) return runManifestGet(options);
	if (MANIFEST_OPERATIONS.has(options.operation)) return runManifestOperation(options);
	if (!options.client) return reportForError(options.operation, "API credentials are required for this operation.");
	if (options.operation === "get") return runGet(options);
	return runExport(options);
}

async function runManifestGet(options: RunResourceOperationOptions): Promise<ResourceOperationReport> {
	const inputs = options.inputs ?? [];
	if (inputs.length === 0) return reportForError("get", "No resource manifests were provided.");

	const validations = inputs.map(input => {
		const namespace = options.namespaceOverride ?? input.manifest.metadata.namespace ?? options.defaultNamespace;
		return validateManifest(input.manifest, options.kindResolver, namespace, { operation: "identity" });
	});
	if (validations.some(validation => !validation.result.valid || !validation.resolved)) {
		return buildReport(
			"get",
			inputs.map((input, index) => {
				const validation = validations[index].result;
				if (validation.valid && validations[index].resolved) {
					return itemFromInput(input, options, {
						status: "skipped",
						error: validationError("Batch validation failed; no operations were executed."),
					});
				}
				return itemFromInput(input, options, {
					status: "error",
					validation,
					error: validationError(validation.errors.map(error => `${error.path}: ${error.message}`).join("; ")),
				});
			}),
		);
	}
	if (!options.client) return reportForError("get", "API credentials are required for this operation.");

	const results: ResourceOperationItem[] = [];
	for (let index = 0; index < inputs.length; index++) {
		const input = inputs[index];
		try {
			const result = await options.client.get(
				validations[index].resolved!,
				input.manifest.metadata.name,
				options.namespaceOverride ?? input.manifest.metadata.namespace ?? options.defaultNamespace,
			);
			results.push(
				result.error
					? itemFromInput(input, options, { status: "error", error: result.error })
					: itemFromInput(input, options, { status: "found", resource: result.resource }),
			);
		} catch (error) {
			results.push(itemFromInput(input, options, { status: "error", error: unexpectedError(error) }));
		}
	}
	return buildReport("get", results);
}

async function runManifestOperation(options: RunResourceOperationOptions): Promise<ResourceOperationReport> {
	const inputs = options.inputs ?? [];
	if (inputs.length === 0) return reportForError(options.operation, "No resource manifests were provided.");

	const validationMode =
		options.operation === "delete" ? "identity" : options.operation === "update" ? "update" : "create";
	const validations = inputs.map(input => {
		const namespace = options.namespaceOverride ?? input.manifest.metadata.namespace ?? options.defaultNamespace;
		return validateManifest(input.manifest, options.kindResolver, namespace, { operation: validationMode });
	});
	const invalid = validations.some(validation => !validation.result.valid || !validation.resolved);
	if (invalid) {
		const results = inputs.map((input, index): ResourceOperationItem => {
			const validation = validations[index].result;
			if (validation.valid && validations[index].resolved) {
				return itemFromInput(input, options, {
					status: "skipped",
					error: validationError("Batch validation failed; no operations were executed."),
				});
			}
			return itemFromInput(input, options, {
				status: "error",
				validation,
				error: validationError(validation.errors.map(error => `${error.path}: ${error.message}`).join("; ")),
			});
		});
		return buildReport(options.operation, results);
	}

	if (options.operation === "validate") {
		return buildReport(
			options.operation,
			inputs.map(input => itemFromInput(input, options, { status: "valid" })),
		);
	}
	if (!options.client) return reportForError(options.operation, "API credentials are required for this operation.");

	const results: ResourceOperationItem[] = [];
	for (let index = 0; index < inputs.length; index++) {
		const input = inputs[index];
		const resolved = validations[index].resolved!;
		try {
			if (options.operation === "diff") {
				const diff = await options.client.diff(input.manifest, resolved, options.namespaceOverride);
				if (diff.error) {
					results.push(itemFromInput(input, options, { status: "error", error: diff.error }));
				} else {
					results.push(
						itemFromInput(input, options, {
							status: diff.isNew ? "new" : diff.diff?.hasDifferences ? "different" : "identical",
							diff: diff.diff,
							isNew: diff.isNew,
						}),
					);
				}
				continue;
			}

			let operationResult: OperationResult;
			if (options.operation === "apply") {
				operationResult = await options.client.apply(
					input.manifest,
					resolved,
					options.namespaceOverride,
					options.dryRun,
				);
			} else if (options.operation === "create") {
				operationResult = await options.client.create(
					input.manifest,
					resolved,
					options.namespaceOverride,
					options.dryRun,
				);
			} else if (options.operation === "update") {
				operationResult = await options.client.update(
					input.manifest,
					resolved,
					options.namespaceOverride,
					options.dryRun,
				);
			} else {
				operationResult = await options.client.delete(
					input.manifest.kind,
					input.manifest.metadata.name,
					resolved,
					options.namespaceOverride ?? input.manifest.metadata.namespace,
					options.dryRun,
				);
			}
			results.push(operationResultToItem(input, options, operationResult));
		} catch (error) {
			results.push(itemFromInput(input, options, { status: "error", error: unexpectedError(error) }));
		}
	}
	return buildReport(options.operation, results);
}

async function runGet(options: RunResourceOperationOptions): Promise<ResourceOperationReport> {
	if (!options.kind) return reportForError("get", "A resource kind is required.");
	try {
		const resolved = options.kindResolver.resolveKind(options.kind);
		const result = await options.client!.get(
			resolved,
			options.name,
			options.namespaceOverride ?? options.defaultNamespace,
		);
		if (result.error)
			return buildReport("get", [
				{ index: 0, kind: options.kind, name: options.name, status: "error", error: result.error },
			]);
		return buildReport("get", [
			{
				index: 0,
				kind: options.kind,
				name: options.name,
				status: options.name ? "found" : "listed",
				resource: result.resource,
				items: result.items,
			},
		]);
	} catch (error) {
		return reportForError("get", (error as Error).message);
	}
}

async function runExport(options: RunResourceOperationOptions): Promise<ResourceOperationReport> {
	try {
		if (options.all) {
			const result = await options.client!.exportAll(
				options.kindResolver,
				options.namespaceOverride ?? options.defaultNamespace,
			);
			const items: ResourceOperationItem[] = result.manifests.map((manifest, index) => ({
				index,
				kind: manifest.kind,
				name: String(manifest.metadata.name ?? ""),
				status: "exported",
				manifest,
			}));
			for (const entry of result.errors) {
				items.push({ index: items.length, kind: entry.kind, status: "error", error: entry.error });
			}
			return buildReport("export", items);
		}
		if (!options.kind) return reportForError("export", "A resource kind or --all is required.");
		const resolved = options.kindResolver.resolveKind(options.kind);
		if (options.name) {
			const result = await options.client!.exportOne(
				options.kind,
				resolved,
				options.name,
				options.namespaceOverride ?? options.defaultNamespace,
			);
			if (result.error)
				return buildReport("export", [
					{ index: 0, kind: options.kind, name: options.name, status: "error", error: result.error },
				]);
			return buildReport("export", [
				{ index: 0, kind: options.kind, name: options.name, status: "exported", manifest: result.manifest },
			]);
		}
		const result = await options.client!.get(
			resolved,
			undefined,
			options.namespaceOverride ?? options.defaultNamespace,
		);
		if (result.error)
			return buildReport("export", [{ index: 0, kind: options.kind, status: "error", error: result.error }]);
		const manifests = toManifestList({ items: result.items ?? [] }, options.kind);
		return buildReport(
			"export",
			manifests.map((manifest, index) => ({
				index,
				kind: options.kind,
				name: String(manifest.metadata.name ?? ""),
				status: "exported",
				manifest,
			})),
		);
	} catch (error) {
		return reportForError("export", (error as Error).message);
	}
}

function operationResultToItem(
	input: ManifestOperationInput,
	options: RunResourceOperationOptions,
	result: OperationResult,
): ResourceOperationItem {
	if (result.status === "error") return itemFromInput(input, options, { status: "error", error: result.error });
	if (result.status === "deleted")
		return itemFromInput(input, options, { status: result.status, durationMs: result.durationMs });
	if (result.status === "dry-run")
		return itemFromInput(input, options, { status: result.status, action: result.action, diff: result.diff });
	if (result.status === "updated")
		return itemFromInput(input, options, {
			status: result.status,
			durationMs: result.durationMs,
			resource: result.resource,
			diff: result.diff,
		});
	if (result.status === "created")
		return itemFromInput(input, options, {
			status: result.status,
			durationMs: result.durationMs,
			resource: result.resource,
		});
	return itemFromInput(input, options, { status: result.status, resource: result.resource });
}

function itemFromInput(
	input: ManifestOperationInput,
	options: RunResourceOperationOptions,
	extra: Partial<ResourceOperationItem> & Pick<ResourceOperationItem, "status">,
): ResourceOperationItem {
	return {
		index: input.index,
		sourcePath: input.sourcePath,
		kind: input.manifest.kind,
		name: input.manifest.metadata.name,
		namespace: options.namespaceOverride ?? input.manifest.metadata.namespace ?? options.defaultNamespace,
		...extra,
	};
}

function validationError(message: string): ResourceError {
	return { kind: "validation", message };
}

function unexpectedError(error: unknown): ResourceError {
	return { kind: "api", message: error instanceof Error ? error.message : String(error) };
}

function reportForError(operation: ResourceOperation, message: string): ResourceOperationReport {
	return buildReport(operation, [{ index: 0, status: "error", error: validationError(message) }]);
}

function buildReport(operation: ResourceOperation, results: ResourceOperationItem[]): ResourceOperationReport {
	const failed = results.filter(result => result.status === "error" || result.status === "skipped").length;
	const counts = {
		total: results.length,
		succeeded: results.length - failed,
		failed,
	} as ResourceOperationReport["counts"];
	for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
	return { schemaVersion: 1, operation, success: failed === 0, counts, results };
}

export function formatResourceOperationReport(
	report: ResourceOperationReport,
	format: "json" | "yaml" | "table" | "wide" = "table",
): string {
	if (format === "json") return JSON.stringify(report, null, 2);
	if (format === "yaml") return yamlStringify(report);
	const lines = report.results.map(result => {
		const identity =
			result.kind && result.name
				? `${result.kind}/${result.name}`
				: (result.kind ?? result.sourcePath ?? "resource");
		if (result.error) return `${identity} error: ${result.error.message}`;
		if (result.diff?.hasDifferences) {
			return `${identity} ${result.status}\n${formatDiff(result.diff, result.kind ?? "resource", result.name ?? "unknown")}`;
		}
		return `${identity} ${result.status}`;
	});
	lines.push(`${report.counts.succeeded} succeeded, ${report.counts.failed} failed, ${report.counts.total} total`);
	return lines.join("\n");
}
