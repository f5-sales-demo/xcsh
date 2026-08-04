import * as fs from "node:fs/promises";
import {
	formatManifestOutput,
	formatResourceOperationReport,
	ResourceClient,
	type ResourceOperation,
	type ResourceOperationReport,
	readManifestInputs,
	runResourceOperation,
} from "@f5-sales-demo/pi-resource-management";
import { kindResolver } from "../resource-management/index";

export interface ResourceCliArgs {
	operation: ResourceOperation;
	filenames?: string[];
	kind?: string;
	name?: string;
	all?: boolean;
	namespace?: string;
	outputFormat?: "json" | "yaml" | "table" | "wide";
	recursive?: boolean;
	dryRun?: "client";
	resultFile?: string;
	outputFile?: string;
}

export interface ResourceEnvironment {
	apiUrl?: string;
	apiToken?: string;
	defaultNamespace?: string;
}

export function resolveResourceEnvironment(
	env: Readonly<Record<string, string | undefined>> = process.env,
): ResourceEnvironment {
	return {
		apiUrl: env.XCSH_API_URL,
		apiToken: env.XCSH_API_TOKEN,
		defaultNamespace: env.XCSH_NAMESPACE,
	};
}

export function exitCodeForResourceReport(report: ResourceOperationReport): 0 | 1 | 2 {
	if (report.success) return 0;
	const failures = report.results.filter(result => result.status === "error" || result.status === "skipped");
	return failures.length > 0 && failures.every(result => result.error?.kind === "validation") ? 2 : 1;
}

export function formatResourceCliOutput(
	report: ResourceOperationReport,
	format: "json" | "yaml" | "table" | "wide",
): string {
	if (report.operation === "export" && (format === "json" || format === "yaml")) {
		const manifests = report.results.flatMap(result => (result.manifest ? [result.manifest] : []));
		return formatManifestOutput(manifests, format);
	}
	return formatResourceOperationReport(report, format);
}

export async function runResourceCli(args: ResourceCliArgs): Promise<void> {
	const env = resolveResourceEnvironment();
	let report: ResourceOperationReport;

	try {
		const manifestOperation = ["apply", "create", "update", "get", "delete", "diff", "validate"].includes(
			args.operation,
		);
		let inputs =
			manifestOperation && (args.filenames?.length ?? 0) > 0
				? await readManifestInputs(args.filenames ?? [], args.recursive ?? false)
				: undefined;

		if (args.operation === "delete" && !inputs && args.kind && args.name) {
			const namespace = args.namespace ?? env.defaultNamespace;
			const rawObject = { kind: args.kind, metadata: { name: args.name, namespace }, spec: {} };
			inputs = [
				{
					index: 0,
					sourcePath: "command-line",
					manifest: {
						kind: args.kind,
						metadata: { name: args.name, namespace },
						spec: {},
						rawObject,
					},
				},
			];
		}

		const requiresApi = args.operation !== "validate";
		const client =
			requiresApi && env.apiUrl && env.apiToken
				? new ResourceClient({
						apiUrl: env.apiUrl,
						apiToken: env.apiToken,
						namespace: env.defaultNamespace ?? "",
					})
				: undefined;

		report = await runResourceOperation({
			operation: args.operation,
			kindResolver,
			client,
			inputs,
			kind: args.kind,
			name: args.name,
			all: args.all,
			namespaceOverride: args.namespace,
			defaultNamespace: env.defaultNamespace,
			dryRun: args.dryRun,
		});
	} catch (error) {
		report = {
			schemaVersion: 1,
			operation: args.operation,
			success: false,
			counts: { total: 1, succeeded: 0, failed: 1, error: 1 },
			results: [
				{
					index: 0,
					status: "error",
					error: { kind: "validation", message: error instanceof Error ? error.message : String(error) },
				},
			],
		};
	}

	const json = `${JSON.stringify(report, null, 2)}\n`;
	if (args.resultFile) await fs.writeFile(args.resultFile, json, "utf8");
	const output = `${formatResourceCliOutput(report, args.outputFormat ?? "table")}\n`;
	if (args.outputFile) await fs.writeFile(args.outputFile, output, "utf8");
	else process.stdout.write(output);
	process.exitCode = exitCodeForResourceReport(report);
}
