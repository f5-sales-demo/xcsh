import type { TraceManifest } from "./trace";

export interface CapturedTraceInput {
	role: string;
	rows: readonly Record<string, any>[];
}

export interface AssembledTraceEvent {
	sequence: number;
	producer: string;
	sourceSequence: number;
	absoluteUnixMs: number;
	elapsedMs: number;
	layer: string;
	direction: "in" | "out";
	message: unknown;
}

export interface AssembledProtocolTrace {
	schemaVersion: 1;
	manifest: TraceManifest & { artifactSha256: string };
	producers: Array<{ role: string; startedAtUnixMs: number; events: number }>;
	events: AssembledTraceEvent[];
	transportSummary: {
		byLayerDirection: Record<string, number>;
		rpcMethods: Record<string, number>;
		firstUnixMs: number;
		lastUnixMs: number;
	};
	footer: { complete: true; events: number };
}

function manifestOf(input: CapturedTraceInput): Record<string, any> {
	if (!/^[a-z][a-z0-9-]{0,31}$/.test(input.role)) throw new Error(`Invalid capture role: ${input.role}`);
	if (input.rows.length < 2 || input.rows[0]?.kind !== "manifest")
		throw new Error(`Capture ${input.role} has no manifest`);
	const manifest = input.rows[0];
	if (
		manifest.schemaVersion !== 1 ||
		!(["codex", "xcsh"] as unknown[]).includes(manifest.source) ||
		typeof manifest.version !== "string" ||
		!/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
		!/^[a-f0-9]{64}$/.test(manifest.artifactSha256) ||
		typeof manifest.scenario !== "string" ||
		!Number.isFinite(manifest.startedAtUnixMs)
	)
		throw new Error(`Capture ${input.role} has invalid provenance`);
	return manifest;
}

function eventsOf(input: CapturedTraceInput): Record<string, any>[] {
	const events = input.rows.slice(1, -1);
	const footer = input.rows.at(-1);
	if (footer?.kind !== "footer" || footer.complete !== true || footer.events !== events.length)
		throw new Error(`Capture ${input.role} is incomplete`);
	for (const [index, event] of events.entries()) {
		if (
			event.kind !== "event" ||
			event.sequence !== index + 1 ||
			!Number.isFinite(event.elapsedMs) ||
			event.elapsedMs < 0 ||
			typeof event.layer !== "string" ||
			!(["in", "out"] as unknown[]).includes(event.direction) ||
			!("message" in event)
		)
			throw new Error(`Capture ${input.role} has an invalid event sequence`);
	}
	return events;
}

/** Validate and deterministically merge complete post-TLS capture streams. */
export function assembleProtocolTraces(inputs: readonly CapturedTraceInput[]): AssembledProtocolTrace {
	if (inputs.length === 0) throw new Error("At least one capture is required");
	const roles = new Set<string>();
	const manifests = inputs.map(input => {
		if (roles.has(input.role)) throw new Error(`Duplicate capture role: ${input.role}`);
		roles.add(input.role);
		return manifestOf(input);
	});
	const baseline = manifests[0]!;
	for (const manifest of manifests.slice(1))
		for (const field of ["source", "version", "sourceCommit", "artifactSha256", "scenario"])
			if (manifest[field] !== baseline[field]) throw new Error(`Capture provenance differs at ${field}`);

	const ordered = inputs.flatMap((input, producerIndex) => {
		const manifest = manifests[producerIndex]!;
		return eventsOf(input).map(event => ({
			producerIndex,
			producer: input.role,
			sourceSequence: event.sequence,
			absoluteUnixMs: manifest.startedAtUnixMs + event.elapsedMs,
			elapsedMs: event.elapsedMs,
			layer: event.layer,
			direction: event.direction,
			message: event.message,
		}));
	});
	ordered.sort(
		(left, right) =>
			left.absoluteUnixMs - right.absoluteUnixMs ||
			left.producerIndex - right.producerIndex ||
			left.sourceSequence - right.sourceSequence,
	);
	const events: AssembledTraceEvent[] = ordered.map(({ producerIndex: _, ...event }, index) => ({
		...event,
		sequence: index + 1,
	}));
	const byLayerDirection = new Map<string, number>();
	const rpcMethods = new Map<string, number>();
	for (const event of events) {
		const route = `${event.layer}/${event.direction}`;
		byLayerDirection.set(route, (byLayerDirection.get(route) ?? 0) + 1);
		const method = (event.message as { method?: unknown } | null)?.method;
		if (event.layer === "rpc" && typeof method === "string")
			rpcMethods.set(method, (rpcMethods.get(method) ?? 0) + 1);
	}
	const sortedRecord = (values: Map<string, number>) =>
		Object.fromEntries([...values].sort(([left], [right]) => left.localeCompare(right)));
	return {
		schemaVersion: 1,
		manifest: {
			source: baseline.source,
			version: baseline.version,
			sourceCommit: baseline.sourceCommit,
			artifactSha256: baseline.artifactSha256,
			scenario: baseline.scenario,
		},
		producers: inputs.map((input, index) => ({
			role: input.role,
			startedAtUnixMs: manifests[index]!.startedAtUnixMs,
			events: input.rows.length - 2,
		})),
		events,
		transportSummary: {
			byLayerDirection: sortedRecord(byLayerDirection),
			rpcMethods: sortedRecord(rpcMethods),
			firstUnixMs: events[0]?.absoluteUnixMs ?? baseline.startedAtUnixMs,
			lastUnixMs: events.at(-1)?.absoluteUnixMs ?? baseline.startedAtUnixMs,
		},
		footer: { complete: true, events: events.length },
	};
}
