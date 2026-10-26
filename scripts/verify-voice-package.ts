import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import references from "./voice-runtime-reference.json";

const MAX_FRAME = 128 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function verifyNativeArchitecture(bytes: Uint8Array, platform: string, arch: string): void {
	if (bytes.length < 64) throw new Error("Invalid native binary header");
	const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (platform === "linux") {
		if (
			bytes[0] !== 0x7f ||
			bytes[1] !== 0x45 ||
			bytes[2] !== 0x4c ||
			bytes[3] !== 0x46 ||
			bytes[4] !== 2 ||
			bytes[5] !== 1 ||
			header.getUint16(18, true) !== (arch === "arm64" ? 183 : 62)
		)
			throw new Error("Native binary architecture mismatch");
	} else if (platform === "darwin") {
		if (
			header.getUint32(0, true) !== 0xfeedfacf ||
			header.getUint32(4, true) !== (arch === "arm64" ? 0x0100000c : 0x01000007)
		)
			throw new Error("Native binary architecture mismatch");
	} else throw new Error("Unsupported native qualification platform");
}
export function decodeHelperFrame(frame: Uint8Array): Record<string, unknown> {
	if (frame.length < 4) throw new Error("Incomplete helper frame");
	const size = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
	if (size > MAX_FRAME || frame.length !== size + 4) throw new Error("Invalid helper frame length");
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(4)));
	} catch {
		throw new Error("Malformed helper frame");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed helper frame");
	return value as Record<string, unknown>;
}
function encode(value: Record<string, unknown>): Uint8Array {
	const payload = new TextEncoder().encode(JSON.stringify(value));
	const frame = new Uint8Array(payload.length + 4);
	new DataView(frame.buffer).setUint32(0, payload.length);
	frame.set(payload, 4);
	return frame;
}
interface Manifest {
	schemaVersion: number;
	buildCommit: string;
	reference: string;
	files: { path: string; sha256: string }[];
}
export async function verifyVoicePackage(directory: string, source: string, evidence: string): Promise<void> {
	if (
		!/^[0-9a-f]{40}$/.test(source) ||
		!["x64", "arm64"].includes(process.arch) ||
		!["linux", "darwin"].includes(process.platform)
	)
		throw new Error("Explicit supported source and target are required");
	const root = await realpath(directory);
	const manifestBytes = await readFile(join(root, "xcsh-voice-package.json"));
	if (manifestBytes.length > 1024 * 1024) throw new Error("Oversized voice manifest");
	const manifest = JSON.parse(manifestBytes.toString()) as Manifest;
	if (
		manifest.schemaVersion !== 1 ||
		manifest.buildCommit !== source ||
		manifest.reference !== references.reference ||
		!Array.isArray(manifest.files) ||
		!manifest.files.length ||
		manifest.files.length > 256
	)
		throw new Error("Voice package provenance mismatch");
	const files = new Map<string, string>();
	for (const entry of manifest.files) {
		if (
			typeof entry.path !== "string" ||
			!entry.path.startsWith("codex-resources/voice/") ||
			posix.normalize(entry.path) !== entry.path ||
			entry.path.split("/").some(part => !part || part === "." || part === "..") ||
			files.has(entry.path) ||
			!/^[0-9a-f]{64}$/.test(entry.sha256)
		)
			throw new Error("Invalid voice package inventory");
		const path = join(root, entry.path);
		if ((await realpath(path)) !== path || !(await stat(path)).isFile())
			throw new Error("Voice package must contain physical files");
		const bytes = await readFile(path);
		if (digest(bytes) !== entry.sha256) throw new Error("Voice package hash mismatch");
		if (
			entry.path.endsWith(".so") ||
			/\.so\.\d+$/.test(entry.path) ||
			entry.path.endsWith(".dylib") ||
			entry.path.endsWith("/codex-voice-host")
		)
			verifyNativeArchitecture(bytes, process.platform, process.arch);
		files.set(entry.path, entry.sha256);
	}
	for (const [path, expected] of Object.entries(references.files)) {
		if (path === "third_party/voice/NOTICE.md" || path.startsWith("third_party/voice/licenses/"))
			if (files.get(path.replace("third_party/voice/", "codex-resources/voice/")) !== expected)
				throw new Error("Pinned redistribution notices are required");
	}
	const runtimePath = "codex-resources/voice/runtime.json";
	if (!files.has(runtimePath)) throw new Error("Runtime receipt is required");
	const runtime = JSON.parse((await readFile(join(root, runtimePath))).toString()) as {
		target: string;
		sourceCommit: string;
		sourceManifestSha256: string;
	};
	const target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
	if (
		runtime.target !== target ||
		runtime.sourceCommit !== references.reference ||
		runtime.sourceManifestSha256 !== references.files["third_party/voice/sources.json"]
	)
		throw new Error("Pinned native runtime provenance mismatch");
	const helper = "codex-resources/voice/bin/codex-voice-host";
	if (!files.has(helper)) throw new Error("Packaged helper is required");
	await mkdir(evidence, { recursive: false });
	// Do not inherit loader paths from the SDK or credentials from the control process.
	const child = Bun.spawn([join(root, helper)], {
		cwd: root,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: "/usr/bin:/bin",
			GST_PLUGIN_PATH: "",
			GST_PLUGIN_PATH_1_0: "",
			GST_PLUGIN_SYSTEM_PATH: "",
			GST_PLUGIN_SYSTEM_PATH_1_0: "",
			GST_REGISTRY: "/dev/null",
			GST_REGISTRY_UPDATE: "no",
			GST_REGISTRY_FORK: "no",
		},
	});
	const deadline = setTimeout(() => child.kill(), 15_000);
	const reader = child.stdout.getReader();
	const captured: Uint8Array[] = [];
	const stderr = new Response(child.stderr).arrayBuffer();
	let pending = new Uint8Array(0);
	let succeeded = false;
	try {
		async function exchange(request: Record<string, unknown>, expected: string): Promise<void> {
			child.stdin.write(encode(request));
			await child.stdin.flush();
			while (
				pending.length < 4 ||
				pending.length < new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0) + 4
			) {
				if (
					pending.length >= 4 &&
					new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0) > MAX_FRAME
				)
					throw new Error("Invalid helper frame length");
				const chunk = await reader.read();
				if (chunk.done) throw new Error("Helper exited before acknowledgement");
				if (pending.length + chunk.value.length > MAX_FRAME + 4) throw new Error("Oversized helper output");
				captured.push(chunk.value);
				const next = new Uint8Array(pending.length + chunk.value.length);
				next.set(pending);
				next.set(chunk.value, pending.length);
				pending = next;
			}
			const size = new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0) + 4;
			const response = decodeHelperFrame(pending.subarray(0, size));
			pending = pending.slice(size);
			if (
				response.type !== expected ||
				Object.keys(response).some(key => key !== "type" && !(expected === "audioState" && key === "state"))
			)
				throw new Error("Unexpected helper acknowledgement");
			if (expected === "audioState") {
				const state = response.state as { microphonePeak?: unknown; speakerPeak?: unknown } | undefined;
				if (state?.microphonePeak !== 0 || state.speakerPeak !== 0)
					throw new Error("Unexpected unopened audio state");
			}
		}
		await exchange({ type: "hello", protocol: 1, buildCommit: source }, "ready");
		await exchange({ type: "initializeRuntime" }, "runtimeReady");
		await exchange({ type: "inspectAudio" }, "audioState");
		await exchange({ type: "close" }, "closed");
		child.stdin.end();
		if ((await child.exited) !== 0 || pending.length) throw new Error("Helper did not close cleanly");
		succeeded = true;
	} finally {
		clearTimeout(deadline);
		if (child.exitCode === null) child.kill();
		await child.exited;
		reader.releaseLock();
		await writeFile(
			join(evidence, "helper-stdout.private.bin"),
			Buffer.concat(captured.map(chunk => Buffer.from(chunk))),
		);
		await writeFile(join(evidence, "helper-stderr.private.log"), Buffer.from(await stderr));
		await writeFile(
			join(evidence, "receipt.json"),
			JSON.stringify(
				{
					source,
					target,
					manifestSha256: digest(manifestBytes),
					helperHandshake: succeeded ? "passed" : "failed",
					microphoneOpened: false,
					physicalAcceptance: "untested",
				},
				null,
				2,
			) + "\n",
		);
	}
}
if (import.meta.main) {
	const value = (name: string): string => {
		const at = process.argv.indexOf(`--${name}`);
		if (at < 0 || !process.argv[at + 1]) throw new Error(`Missing --${name}`);
		return process.argv[at + 1]!;
	};
	await verifyVoicePackage(resolve(value("package")), value("source"), resolve(value("evidence")));
	console.log("Packaged helper identity, runtime initialization and closure passed; microphone unopened.");
}
