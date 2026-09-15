import { readFile } from "node:fs/promises";
import { assembleProtocolTraces, verifyTraceArtifactProvenance } from "../../src/remote-control/trace-assembler";

const arguments_ = Bun.argv.slice(2);
const artifacts = new Map<string, string>();
const captures: string[] = [];
for (let index = 0; index < arguments_.length; index++) {
	const argument = arguments_[index]!;
	if (argument !== "--artifact") {
		captures.push(argument);
		continue;
	}
	const value = arguments_[++index];
	const separator = value?.indexOf("=") ?? -1;
	if (!value || separator < 1) throw new Error("Usage: --artifact role=/path/to/executable");
	const role = value.slice(0, separator);
	if (artifacts.has(role)) throw new Error(`Duplicate artifact role: ${role}`);
	artifacts.set(role, value.slice(separator + 1));
}

const inputs = await Promise.all(
	captures.map(async argument => {
		const separator = argument.indexOf("=");
		if (separator < 1)
			throw new Error(
				"Usage: bun assemble.ts role=capture.jsonl [role=capture.jsonl ...] [--artifact role=/path/to/executable]",
			);
		const role = argument.slice(0, separator);
		const file = argument.slice(separator + 1);
		const rows = (await readFile(file, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		const artifact = artifacts.get(role);
		const sourceCommit = rows[0]?.sourceCommit;
		const verifiedArtifact = artifact ? await verifyTraceArtifactProvenance(artifact, sourceCommit) : undefined;
		artifacts.delete(role);
		return { role, rows, verifiedArtifact };
	}),
);
if (artifacts.size > 0) throw new Error(`Artifact has no capture role: ${artifacts.keys().next().value}`);

process.stdout.write(`${JSON.stringify(assembleProtocolTraces(inputs), null, 2)}\n`);
