import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { BUILD_INFO } from "../internal-urls/build-info.generated";
import { ProtocolTrace } from "./trace";

export type TraceSink = Pick<ProtocolTrace, "record" | "close" | "invalidate">;

export function artifactTraceProvenance(
	executable = process.execPath,
	embedded: { commit: string } = BUILD_INFO,
): { sourceCommit: string; artifactSha256: string } {
	if (!/^[a-f0-9]{40}$/.test(embedded.commit))
		throw new Error("Protocol recording requires an embedded full source commit");
	const artifact = realpathSync(executable);
	const artifactSha256 = createHash("sha256").update(readFileSync(artifact)).digest("hex");
	return { sourceCommit: embedded.commit, artifactSha256 };
}

/** Recording is explicit and scoped to the launched test host/session. */
export function traceFromEnvironment(role: "host" | "voice", version: string): ProtocolTrace | undefined {
	const directory = process.env.XCSH_REMOTE_TRACE_DIRECTORY;
	if (!directory) return;
	const scenario = process.env.XCSH_REMOTE_TRACE_SCENARIO;
	const salt = process.env.XCSH_REMOTE_TRACE_SALT;
	if (!salt || !/^[a-f0-9]{64}$/.test(salt)) throw new Error("Protocol recording requires a shared capture salt");
	if (!scenario || !/^[a-z0-9-]{1,64}$/.test(scenario))
		throw new Error("Protocol recording requires scenario provenance");
	const provenance = artifactTraceProvenance();
	const trace = new ProtocolTrace(
		join(directory, `${role}-${process.pid}-${randomUUID()}.jsonl`),
		{
			source: "xcsh",
			version,
			...provenance,
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
