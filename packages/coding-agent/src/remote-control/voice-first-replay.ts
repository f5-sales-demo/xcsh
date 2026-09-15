import type { AssembledTraceEvent } from "./trace-assembler";

export interface VoiceFirstReplayTransport {
	send(request: Record<string, unknown>): Promise<Record<string, unknown>>;
	nextNotification(timeoutMs: number): Promise<Record<string, unknown>>;
}

export interface VoiceFirstReplayResult {
	requests: string[];
	outputs: string[];
	success: boolean;
	missingSuccessSignals: string[];
	immediateCleanupSignals: string[];
}

const requiredSuccessSignals = [
	"thread/start:result",
	"thread/realtime/start:result",
	"thread/realtime/started",
	"thread/realtime/sdp",
] as const;

function name(message: Record<string, any>): string {
	if (typeof message.method === "string") return message.method;
	return "error" in message ? "error" : "result" in message ? "result" : "unknown";
}

function assertShape(expected: unknown, actual: unknown, refs: Map<string, unknown>, path = "$"): void {
	if (expected && typeof expected === "object" && !Array.isArray(expected)) {
		const marker = expected as Record<string, any>;
		if (typeof marker.$ref === "string") {
			const prior = refs.get(marker.$ref);
			if (prior === undefined) refs.set(marker.$ref, actual);
			else if (!Object.is(prior, actual)) throw new Error(`Replay identity mismatch at ${path}`);
			return;
		}
		if (typeof marker.$redacted === "string") {
			if (marker.valueType && typeof actual !== marker.valueType) throw new Error(`Replay type mismatch at ${path}`);
			if (
				typeof actual === "string" &&
				typeof marker.bytes === "number" &&
				Buffer.byteLength(actual) !== marker.bytes
			)
				throw new Error(`Replay byte length mismatch at ${path}`);
			return;
		}
		if (!actual || typeof actual !== "object" || Array.isArray(actual))
			throw new Error(`Replay object mismatch at ${path}`);
		for (const [key, value] of Object.entries(marker)) {
			if (!Object.hasOwn(actual, key)) throw new Error(`Replay missing field at ${path}.${key}`);
			assertShape(value, (actual as Record<string, unknown>)[key], refs, `${path}.${key}`);
		}
		return;
	}
	if (Array.isArray(expected)) {
		if (!Array.isArray(actual) || actual.length !== expected.length)
			throw new Error(`Replay array mismatch at ${path}`);
		for (const [index, value] of expected.entries()) assertShape(value, actual[index], refs, `${path}[${index}]`);
		return;
	}
	if (!Object.is(expected, actual)) throw new Error(`Replay value mismatch at ${path}`);
}

/**
 * Replays only requests present in the reference sequence. Every recorded output
 * is observed before the next request is sent, so a missing realtime request can
 * never be manufactured by the harness.
 */
export async function replayVoiceFirstSequence(
	events: readonly Pick<AssembledTraceEvent, "direction" | "layer" | "message">[],
	transport: VoiceFirstReplayTransport,
	timeoutMs = 5_000,
): Promise<VoiceFirstReplayResult> {
	const rpc = events.filter(event => event.layer === "rpc");
	const refs = new Map<string, unknown>();
	const requests: string[] = [];
	const outputs: string[] = [];
	let index = 0;
	while (index < rpc.length) {
		const incoming = rpc[index++];
		const request = incoming?.message as Record<string, any>;
		if (incoming?.direction !== "in" || typeof request?.method !== "string" || request.id == null)
			throw new Error(`Replay expected a client request at event ${index}`);
		requests.push(request.method);
		const response = await transport.send(request);
		let matchedResponse = false;
		while (
			index < rpc.length &&
			!(rpc[index]!.direction === "in" && typeof (rpc[index]!.message as any)?.method === "string")
		) {
			const expected = rpc[index++]!.message as Record<string, any>;
			if (expected.id != null && ("result" in expected || "error" in expected)) {
				if (matchedResponse) throw new Error(`Replay recorded duplicate response for ${request.method}`);
				assertShape(expected, response, refs);
				matchedResponse = true;
				outputs.push(`${request.method}:${"error" in response ? "error" : "result"}`);
			} else {
				const notification = await transport.nextNotification(timeoutMs);
				assertShape(expected, notification, refs);
				outputs.push(name(notification));
			}
		}
		if (!matchedResponse) throw new Error(`Replay has no response for ${request.method}`);
	}
	const missingSuccessSignals = requiredSuccessSignals.filter(signal => !outputs.includes(signal));
	const immediateCleanupSignals = outputs.filter(signal =>
		["thread/realtime/stopped", "thread/realtime/closed", "thread/archived", "thread/deleted"].includes(signal),
	);
	return {
		requests,
		outputs,
		success: missingSuccessSignals.length === 0 && immediateCleanupSignals.length === 0,
		missingSuccessSignals,
		immediateCleanupSignals,
	};
}
