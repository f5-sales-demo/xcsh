import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_OUTPUT_BYTES = 64 * 1024;
async function captureOutput(stream: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	let observedBytes = 0;
	let retainedBytes = 0;
	for await (const chunk of stream) {
		observedBytes += chunk.byteLength;
		const remaining = MAX_OUTPUT_BYTES - retainedBytes;
		if (remaining > 0) {
			const retained = chunk.slice(0, remaining);
			chunks.push(retained);
			retainedBytes += retained.byteLength;
		}
	}
	const bytes = Buffer.concat(chunks);
	return { bytes, text: bytes.toString("utf8"), observedBytes, truncated: observedBytes > retainedBytes };
}

const candidate = process.argv[2];
if (!candidate) throw new Error("A candidate CLI path is required");
const binary = path.resolve(candidate);
const directory = await mkdtemp(path.join(os.tmpdir(), "xcsh-native-document-"));
const stream = Buffer.from("BT /F1 12 Tf 72 720 Td (Synthetic document content.) Tj ET");
const objects = [
	"<< /Type /Catalog /Pages 2 0 R >>",
	"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
	"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
	"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets: number[] = [];
for (const [index, object] of objects.entries()) {
	offsets.push(Buffer.byteLength(pdf));
	pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += "xref\n0 6\n0000000000 65535 f \n";
for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () => new Response(pdf, { headers: { "Content-Type": "application/pdf" } }),
});
let passed = false;
try {
	const child = Bun.spawn([binary, "read", `http://127.0.0.1:${server.port}/synthetic.pdf`], {
		cwd: directory,
		env: {
			...(process.env.XCSH_RELEASE_CACHE_DIR !== undefined
				? { XCSH_RELEASE_CACHE_DIR: process.env.XCSH_RELEASE_CACHE_DIR }
				: {}),
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: os.homedir(),
			PI_CONFIG_DIR: path.join(directory, "config"),
			PI_CODING_AGENT_DIR: path.join(directory, "config/agent"),
			XDG_DATA_HOME: path.join(directory, "data"),
			XDG_STATE_HOME: path.join(directory, "state"),
			XDG_CACHE_HOME: path.join(directory, "cache"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		captureOutput(child.stdout),
		captureOutput(child.stderr),
	]);
	const criteria = {
		exitCodeZero: code === 0,
		nativeMethodMatched: stdout.text.includes("Method: markit"),
		contentMatched: stdout.text.includes("Synthetic document content."),
	};
	if (Object.values(criteria).some(matched => !matched) || stdout.truncated || stderr.truncated) {
		const diagnostic = {
			exitCode: code,
			criteria,
			stdoutSha256: createHash("sha256").update(stdout.bytes).digest("hex"),
			stderrSha256: createHash("sha256").update(stderr.bytes).digest("hex"),
			stdoutBytesObserved: stdout.observedBytes,
			stderrBytesObserved: stderr.observedBytes,
			stdoutTruncated: stdout.truncated,
			stderrTruncated: stderr.truncated,
			retainedDirectory: directory,
		};
		const failure = new Error(`NATIVE_DOCUMENT_SMOKE_FAILURE ${JSON.stringify(diagnostic)}`);
		try {
		await Promise.all([
			writeFile(path.join(directory, "stdout.private.log"), stdout.bytes, { flag: "wx", mode: 0o600 }),
			writeFile(path.join(directory, "stderr.private.log"), stderr.bytes, { flag: "wx", mode: 0o600 }),
			writeFile(path.join(directory, "diagnostic.private.json"), JSON.stringify(diagnostic), { flag: "wx", mode: 0o600 }),
		]);
		} catch (writeError) {
			throw new AggregateError([failure, writeError], "Native document conversion and evidence retention failed", { cause: failure });
		}
		throw failure;
	}
	passed = true;
	console.log("Installed native document conversion passed");
} finally {
	server.stop(true);
	if (passed) await rm(directory, { recursive: true, force: true });
}
