import { realpathSync } from "node:fs";
import { startTraceCollector } from "../../src/remote-control/trace-collector";
import { loadReferenceBaseline, verifyArtifactHash } from "./baseline";

const [version, socket, file, scenario, artifact, expectedArtifactSha256] = Bun.argv.slice(2);
if (
	!version ||
	!socket ||
	!file ||
	!scenario ||
	!artifact ||
	!expectedArtifactSha256 ||
	!/^[a-z0-9-]{1,64}$/.test(scenario)
) {
	throw new Error(
		"Usage: bun record.ts <0.153.4|0.154.0> <private-socket-path> <private-jsonl-path> <scenario> <codex-artifact> <artifact-sha256>",
	);
}
const manifest = await loadReferenceBaseline(version);
const artifactSha256 = await verifyArtifactHash(realpathSync(artifact), expectedArtifactSha256);
const collector = await startTraceCollector(socket, file, {
	source: "codex",
	version: manifest.version,
	sourceCommit: manifest.sourceCommit,
	artifactSha256,
	scenario,
});
process.stdout.write("Sanitized reference recorder ready. Stop after the scripted conversation is idle.\n");
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, async () => {
		await collector.close();
		process.exit(0);
	});
