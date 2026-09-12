import { appendFile, readFile, writeFile } from "node:fs/promises";

export default async function publishDisposableTranscript(source) {
	const log = process.env.XCSH_UAT_SHARE_LOG;
	const output = process.env.XCSH_UAT_SHARE_OUTPUT;
	const failure = process.env.XCSH_UAT_SHARE_FAIL_FILE;
	if (!log || !output || !failure) throw new Error("Disposable publisher environment is incomplete");
	await appendFile(log, `${source}\0`, { mode: 0o600 });
	if (await Bun.file(failure).exists()) throw new Error("Synthetic publisher failure");
	await writeFile(output, await readFile(source), { mode: 0o600 });
	return {
		url: "https://share.invalid/disposable-result",
		message: "Disposable publisher completed",
	};
}
