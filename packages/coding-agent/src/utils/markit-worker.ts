import { Markit } from "@shiftlabs/markit";

const MAX_REQUEST_BYTES = 256 * 1024 * 1024;
try {
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	for await (const chunk of process.stdin) {
		if (!(chunk instanceof Uint8Array)) throw new Error("Conversion worker received non-binary input");
		bytes += chunk.byteLength;
		if (bytes > MAX_REQUEST_BYTES) throw new Error("Conversion request exceeds size limit");
		chunks.push(chunk);
	}
	const request: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (typeof request !== "object" || request === null || !("operation" in request)) {
		throw new Error("Invalid conversion request");
	}
	const markit = new Markit();
	let markdown: string | undefined;
	if (request.operation === "file" && "path" in request && typeof request.path === "string") {
		markdown = (await markit.convertFile(request.path)).markdown;
	} else {
		throw new Error("Invalid conversion operation");
	}
	if (typeof markdown !== "string") throw new Error("Conversion did not return markdown");
	process.stdout.write(JSON.stringify({ markdown }));
} catch (error) {
	process.stderr.write(error instanceof Error ? error.message : "Native document conversion failed");
	process.exitCode = 1;
}
