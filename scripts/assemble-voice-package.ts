import references from "./voice-runtime-reference.json";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
const LIVE_REFERENCE = references.reference;
const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(`--${name}`);
	if (at < 0 || !args[at + 1]) throw new Error(`Missing --${name}`);
	return args[at + 1]!;
};
const helper = resolve(option("helper")),
	runtime = resolve(option("runtime")),
	output = resolve(option("output")),
	source = option("source");
if (!/^[0-9a-f]{40}$/.test(source)) throw new Error("An immutable source revision is required");
// Refuse files, directories and dangling symlinks before probing any input.
// mkdir below claims the destination atomically, including against concurrent assembly.
try {
	await lstat(output);
	throw new Error("Package output already exists");
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const probe = Bun.spawn([helper, "--build-commit"], { stdout: "pipe", stderr: "pipe" });
const probeDeadline = setTimeout(() => probe.kill(), 10_000);
let identity: string;
let probeExit: number;
try {
	const [stdout, , exit] = await Promise.all([
		new Response(probe.stdout).text(),
		new Response(probe.stderr).text(),
		probe.exited,
	]);
	identity = stdout.trim();
	probeExit = exit;
} finally {
	clearTimeout(probeDeadline);
}
if (probeExit !== 0 || identity !== source) throw new Error("Helper build does not match the application source");
const inventory = (await Bun.file(join(runtime, "runtime.json")).json()) as {
	target: string;
	sourceCommit: string;
	libraries: { path: string; sha256: string }[];
};
if (inventory.sourceCommit !== LIVE_REFERENCE || !inventory.libraries.length)
	throw new Error("Runtime is not bound to the pinned native source");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inputs = new Map<string, Uint8Array>();
for (const entry of inventory.libraries) {
	if (
		!/^(?:lib|bin|plugins)\/[A-Za-z0-9_.+/-]+$/.test(entry.path) ||
		entry.path.split("/").some(part => part === ".." || part === "." || part === "") ||
		inputs.has(entry.path)
	)
		throw new Error("Invalid or duplicate runtime path");
	const bytes = await Bun.file(join(runtime, entry.path)).bytes();
	if (digest(bytes) !== entry.sha256) throw new Error("Runtime changed after qualification");
	inputs.set(entry.path, bytes);
}
const licenseInputs: { path: string; bytes: Uint8Array }[] = [];
for (const [path, expected] of Object.entries(references.files)) {
	if (path !== "third_party/voice/NOTICE.md" && !path.startsWith("third_party/voice/licenses/")) continue;
	const bytes = await Bun.file(join(dirname(runtime), path)).bytes();
	if (digest(bytes) !== expected) throw new Error("Pinned redistribution notice changed");
	licenseInputs.push({ path: path.replace("third_party/voice/", ""), bytes });
}
const apache = await Bun.file(join(import.meta.dir, "../crates/xcsh-voice-host/LICENSE")).bytes();
licenseInputs.push({ path: "licenses/Apache-2.0.txt", bytes: apache });
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
const voice = join(output, "codex-resources/voice");
await mkdir(join(voice, "bin"), { recursive: true });
const files: { path: string; sha256: string }[] = [];

for (const entry of inventory.libraries) {
	if (!/^[A-Za-z0-9_.+/-]+$/.test(entry.path) || entry.path.startsWith("/") || entry.path.split("/").includes(".."))
		throw new Error("Invalid runtime path");
	const bytes = inputs.get(entry.path)!;
	const relative = `codex-resources/voice/${entry.path}`;
	await mkdir(dirname(join(output, relative)), { recursive: true });
	await Bun.write(join(output, relative), bytes);
	files.push({ path: relative, sha256: entry.sha256 });
}
for (const license of licenseInputs) {
	const relative = `codex-resources/voice/${license.path}`;
	await mkdir(dirname(join(output, relative)), { recursive: true });
	await Bun.write(join(output, relative), license.bytes);
	files.push({ path: relative, sha256: digest(license.bytes) });
}
const helperName = process.platform === "win32" ? "codex-voice-host.exe" : "codex-voice-host";
await cp(helper, join(voice, "bin", helperName));
files.push({ path: `codex-resources/voice/bin/${helperName}`, sha256: digest(await Bun.file(helper).bytes()) });
const receipt = await Bun.file(join(runtime, "runtime.json")).bytes();
await Bun.write(join(voice, "runtime.json"), receipt);
files.push({ path: "codex-resources/voice/runtime.json", sha256: digest(receipt) });
const appAt = args.indexOf("--app");
let application: { path: string; sha256: string } | undefined;
if (appAt >= 0) {
	const app = resolve(args[appAt + 1]!);
	await mkdir(join(output, "bin"), { recursive: true });
	await cp(app, join(output, "bin", "xcsh"));
	application = { path: "bin/xcsh", sha256: digest(await Bun.file(app).bytes()) };
}
for (const file of files)
	if (
		!(await stat(join(output, file.path))).isFile() ||
		digest(await Bun.file(join(output, file.path)).bytes()) !== file.sha256
	)
		throw new Error("Copied package hash mismatch");
const manifest = {
	schemaVersion: 1,
	buildCommit: source,
	reference: LIVE_REFERENCE,
	files: files.sort((a, b) => a.path.localeCompare(b.path)),
};
await Bun.write(join(output, "xcsh-voice-package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await Bun.write(
	join(output, "qualification.json"),
	`${JSON.stringify({ source, target: inventory.target, application, manifestSha256: digest(await Bun.file(join(output, "xcsh-voice-package.json")).bytes()), buildMode: "voice-development", releaseEligible: false, licensedVertexClientEmbedded: false, physicalAcceptance: "untested" }, null, 2)}\n`,
);
