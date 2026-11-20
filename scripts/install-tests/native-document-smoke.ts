import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
try {
	const child = Bun.spawn([binary, "read", `http://127.0.0.1:${server.port}/synthetic.pdf`], {
		cwd: directory,
		env: {
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
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (code !== 0 || !stdout.includes("Method: markit") || !stdout.includes("Synthetic document content.")) {
		throw new Error(`Installed native document conversion failed (${code}): ${stderr}`);
	}
	console.log("Installed native document conversion passed");
} finally {
	server.stop(true);
	await rm(directory, { recursive: true, force: true });
}
