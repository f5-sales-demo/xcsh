import { stringify as yamlStringify } from "yaml";
import { formatDiff } from "./diff-engine";
import type { OperationResult, ResourceDiff, ResourceManifest } from "./types";

export type OutputFormat = "json" | "yaml" | "table" | "wide";

export function formatOperationResult(
	result: OperationResult,
	manifest: ResourceManifest,
	format: OutputFormat = "table",
): string {
	switch (result.status) {
		case "created":
			return formatMutationResult("created", manifest, result.resource, result.durationMs, format);
		case "updated":
			return formatMutationResult("configured", manifest, result.resource, result.durationMs, format, result.diff);
		case "unchanged":
			return `${manifest.kind}/${manifest.metadata.name} unchanged`;
		case "deleted":
			return `${result.kind}/${result.name} deleted (${result.durationMs}ms)`;
		case "error":
			return `Error: ${result.error.message}`;
		case "dry-run":
			if (result.action === "create") {
				return `${manifest.kind}/${manifest.metadata.name} would be created (dry-run)`;
			}
			if (result.diff) {
				return `${manifest.kind}/${manifest.metadata.name} would be updated (dry-run)\n${formatDiff(result.diff, manifest.kind, manifest.metadata.name)}`;
			}
			return `${manifest.kind}/${manifest.metadata.name} would be updated (dry-run)`;
	}
}

function formatMutationResult(
	verb: string,
	manifest: ResourceManifest,
	resource: Record<string, unknown>,
	durationMs: number,
	format: OutputFormat,
	diff?: ResourceDiff,
): string {
	if (format === "json") {
		return JSON.stringify(resource, null, 2);
	}
	if (format === "yaml") {
		return yamlStringify(resource);
	}

	const parts: string[] = [];
	parts.push(`${manifest.kind}/${manifest.metadata.name} ${verb} (${durationMs}ms)`);
	if (diff?.hasDifferences) {
		parts.push(formatDiff(diff, manifest.kind, manifest.metadata.name));
	}
	return parts.join("\n");
}

export function formatResourceList(items: Record<string, unknown>[], kind: string, format: OutputFormat): string {
	if (format === "json") {
		return JSON.stringify({ items }, null, 2);
	}
	if (format === "yaml") {
		return yamlStringify({ items });
	}

	if (items.length === 0) {
		return `No ${kind} resources found.`;
	}

	const rows: string[][] = [];
	const headers = format === "wide" ? ["NAME", "NAMESPACE", "DISABLED", "AGE", "UID"] : ["NAME", "NAMESPACE", "AGE"];

	for (const item of items) {
		const name = String(item.name ?? "");
		const namespace = String(item.namespace ?? "");
		const disabled = item.disabled === true ? "true" : "false";
		const sysMeta = item.system_metadata as Record<string, unknown> | undefined;
		const createdAt = sysMeta?.creation_timestamp ?? item.creation_timestamp;
		const age = typeof createdAt === "string" ? formatAge(createdAt) : "";
		const uid = typeof sysMeta?.uid === "string" ? sysMeta.uid.slice(0, 8) : "";

		if (format === "wide") {
			rows.push([name, namespace, disabled, age, uid]);
		} else {
			rows.push([name, namespace, age]);
		}
	}

	return formatTable(headers, rows);
}

export function formatResourceDetail(resource: Record<string, unknown>, kind: string, format: OutputFormat): string {
	if (format === "json") {
		return JSON.stringify(resource, null, 2);
	}
	if (format === "yaml") {
		return yamlStringify(resource);
	}

	const lines: string[] = [];
	const metadata = resource.metadata as Record<string, unknown> | undefined;
	const sysMeta = resource.system_metadata as Record<string, unknown> | undefined;
	const spec = resource.spec as Record<string, unknown> | undefined;

	lines.push(`Name:       ${metadata?.name ?? ""}`);
	lines.push(`Kind:       ${kind}`);
	lines.push(`Namespace:  ${metadata?.namespace ?? ""}`);

	if (sysMeta) {
		lines.push(`UID:        ${sysMeta.uid ?? ""}`);
		if (sysMeta.creation_timestamp) lines.push(`Created:    ${sysMeta.creation_timestamp}`);
		if (sysMeta.creator_id) lines.push(`Creator:    ${sysMeta.creator_id}`);
	}

	if (metadata?.labels && Object.keys(metadata.labels as object).length > 0) {
		lines.push(`Labels:     ${formatLabels(metadata.labels as Record<string, string>)}`);
	}

	if (metadata?.description) lines.push(`Description: ${metadata.description}`);
	if (metadata?.disable === true) lines.push(`Disabled:   true`);

	if (spec) {
		lines.push("");
		lines.push("Spec:");
		const specJson = JSON.stringify(spec, null, 2);
		for (const line of specJson.split("\n")) {
			lines.push(`  ${line}`);
		}
	}

	const status = resource.status;
	if (status) {
		lines.push("");
		lines.push("Status:");
		const statusJson = JSON.stringify(status, null, 2);
		for (const line of statusJson.split("\n")) {
			lines.push(`  ${line}`);
		}
	}

	return lines.join("\n");
}

export function formatMultiOperationSummary(results: OperationResult[], _manifests: ResourceManifest[]): string {
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let errors = 0;
	let dryRun = 0;

	for (const result of results) {
		switch (result.status) {
			case "created":
				created++;
				break;
			case "updated":
				updated++;
				break;
			case "unchanged":
				unchanged++;
				break;
			case "error":
				errors++;
				break;
			case "dry-run":
				dryRun++;
				break;
		}
	}

	const parts: string[] = [];
	if (created > 0) parts.push(`${created} created`);
	if (updated > 0) parts.push(`${updated} configured`);
	if (unchanged > 0) parts.push(`${unchanged} unchanged`);
	if (dryRun > 0) parts.push(`${dryRun} dry-run`);
	if (errors > 0) parts.push(`${errors} error(s)`);

	return parts.join(", ");
}

function formatTable(headers: string[], rows: string[][]): string {
	const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)));

	const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
	const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(colWidths[i])).join("  "));

	return [headerLine, ...dataLines].join("\n");
}

function formatAge(timestamp: string): string {
	const created = new Date(timestamp);
	const now = new Date();
	const diffMs = now.getTime() - created.getTime();

	if (diffMs < 0) return "0s";
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return `${days}d`;
}

function formatLabels(labels: Record<string, string>): string {
	return Object.entries(labels)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");
}
