import { truncateHead, truncateLine, truncateTail } from "../../src/session/streaming-output";

const EVENTS = 16;
const PARENT_BYTES = 8 * 1024 * 1024;
const WINDOW_BYTES = 32_000;

async function liveBytes(): Promise<number> {
	Bun.gc(true);
	Bun.gc(true);
	await Bun.sleep(50);
	const memory = process.memoryUsage();
	return Math.max(memory.heapUsed, memory.external);
}

function retainToolOutput(): string[] {
	const retained: string[] = [];
	for (let index = 0; index < EVENTS; index++) {
		const content = Buffer.alloc(PARENT_BYTES, 65 + (index % 26))
			.toString("base64")
			.replace(/.{1024}/g, "$&\n");
		retained.push(truncateHead(content, { maxBytes: WINDOW_BYTES, maxLines: 32 }).content);
		retained.push(truncateTail(content, { maxBytes: WINDOW_BYTES, maxLines: 32 }).content);
		retained.push(truncateLine(content, 1024).text);
	}
	return retained;
}

const baseline = await liveBytes();
const owner = retainToolOutput();
const retainedBytes = Math.max(0, (await liveBytes()) - baseline);
const retainedChars = owner.reduce((sum, text) => sum + text.length, 0);
await Bun.write(Bun.stdout, `${retainedBytes}\n${retainedChars}\n`);
