import { readFile } from "node:fs/promises";
import { assembleProtocolTraces } from "../../src/remote-control/trace-assembler";

const inputs = await Promise.all(
	Bun.argv.slice(2).map(async argument => {
		const separator = argument.indexOf("=");
		if (separator < 1) throw new Error("Usage: bun assemble.ts role=capture.jsonl [role=capture.jsonl ...]");
		const role = argument.slice(0, separator);
		const file = argument.slice(separator + 1);
		const rows = (await readFile(file, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		return { role, rows };
	}),
);

process.stdout.write(`${JSON.stringify(assembleProtocolTraces(inputs), null, 2)}\n`);
