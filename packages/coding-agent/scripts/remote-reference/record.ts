import { startTraceCollector } from "../../src/remote-control/trace-collector";

const [socket, file, scenario] = Bun.argv.slice(2);
if (!socket || !file || !scenario || !/^[a-z0-9-]{1,64}$/.test(scenario)) {
	throw new Error("Usage: bun record.ts <private-socket-path> <private-jsonl-path> <scenario>");
}
const collector = await startTraceCollector(socket, file, {
	source: "codex",
	version: "0.153.4",
	sourceCommit: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a",
	scenario,
});
process.stdout.write("Sanitized reference recorder ready. Stop after the scripted conversation is idle.\n");
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, async () => {
		await collector.close();
		process.exit(0);
	});
