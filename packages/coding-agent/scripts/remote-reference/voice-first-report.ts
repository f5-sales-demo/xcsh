import { readFile, stat } from "node:fs/promises";
import type { AssembledProtocolTrace } from "../../src/remote-control/trace-assembler";
import { compareVoiceFirstInitialization } from "../../src/remote-control/trace-report";

const [referencePath, candidatePath] = Bun.argv.slice(2);
if (!referencePath || !candidatePath)
	throw new Error("Usage: bun voice-first-report.ts <reference-assembled.json> <candidate-assembled.json>");

async function read(path: string): Promise<AssembledProtocolTrace> {
	if ((await stat(path)).size > 65 * 1024 * 1024) throw new Error("Assembled trace exceeds report bounds");
	const value = JSON.parse(await readFile(path, "utf8"));
	if (value?.schemaVersion !== 1 || value?.footer?.complete !== true || value.footer.events !== value.events?.length)
		throw new Error("Invalid or incomplete assembled trace");
	return value;
}

const [reference, candidate] = await Promise.all([read(referencePath), read(candidatePath)]);
process.stdout.write(
	`${JSON.stringify(compareVoiceFirstInitialization(reference.events, candidate.events), null, 2)}\n`,
);
