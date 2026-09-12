import { readFile, stat } from "node:fs/promises";
import { compareProtocolTraces } from "../../src/remote-control/trace";
import { inventoryProtocolTrace } from "../../src/remote-control/trace-report";

const [reference, candidate] = Bun.argv.slice(2);
if (!reference || !candidate) throw new Error("Usage: bun compare.ts <reference.jsonl> <xcsh.jsonl>");
async function read(path: string) {
	if ((await stat(path)).size > 65 * 1024 * 1024) throw new Error("Trace exceeds comparison bounds");
	return (await readFile(path, "utf8"))
		.trim()
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line));
}
const [expected, actual] = await Promise.all([read(reference), read(candidate)]);
const comparison = compareProtocolTraces(expected, actual);
process.stdout.write(
	`${JSON.stringify({ comparison, reference: inventoryProtocolTrace(expected), xcsh: inventoryProtocolTrace(actual) }, null, 2)}\n`,
);
process.exitCode = comparison.complete ? 0 : 1;
