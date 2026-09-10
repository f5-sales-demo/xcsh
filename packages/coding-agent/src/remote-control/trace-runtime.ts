import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ProtocolTrace } from "./trace";

export type TraceSink = Pick<ProtocolTrace, "record" | "close" | "invalidate">;

/** Recording is explicit and scoped to the launched test host/session. */
export function traceFromEnvironment(role: "host" | "voice", version: string): ProtocolTrace | undefined {
	const directory = process.env.XCSH_REMOTE_TRACE_DIRECTORY;
	if (!directory) return;
	const sourceCommit = process.env.XCSH_REMOTE_TRACE_COMMIT;
	const scenario = process.env.XCSH_REMOTE_TRACE_SCENARIO;
	const salt = process.env.XCSH_REMOTE_TRACE_SALT;
	if (!salt || !/^[a-f0-9]{64}$/.test(salt)) throw new Error("Protocol recording requires a shared capture salt");
	if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit) || !scenario || !/^[a-z0-9-]{1,64}$/.test(scenario)) {
		throw new Error("Protocol recording requires commit and scenario provenance");
	}
	const trace = new ProtocolTrace(
		join(directory, `${role}-${process.pid}-${randomUUID()}.jsonl`),
		{
			source: "xcsh",
			version,
			sourceCommit,
			scenario,
		},
		undefined,
		salt,
	);
	process.once("exit", () => {
		try {
			trace.close();
		} catch {
			/* Missing footer marks incomplete evidence. */
		}
	});
	return trace;
}

export function traceJson(trace: TraceSink | undefined, layer: string, direction: "in" | "out", text: string): void {
	if (!trace) return;
	try {
		trace.record(layer, direction, JSON.parse(text));
	} catch {
		trace.record(layer, direction, { type: "malformed", bytes: Buffer.byteLength(text) });
	}
}
