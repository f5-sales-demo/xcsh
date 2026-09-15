import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { startTraceCollector } from "../../src/remote-control/trace-collector";
import manifest from "./source-manifest.json";

const [socket, file, scenario, artifact] = Bun.argv.slice(2);
if (!socket || !file || !scenario || !artifact || !/^[a-z0-9-]{1,64}$/.test(scenario)) {
	throw new Error("Usage: bun record.ts <private-socket-path> <private-jsonl-path> <scenario> <codex-artifact>");
}
if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw new Error("Pinned source manifest has no full commit");
const artifactSha256 = createHash("sha256")
	.update(readFileSync(realpathSync(artifact)))
	.digest("hex");
const collector = await startTraceCollector(socket, file, {
	source: "codex",
	version: "0.153.4",
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
