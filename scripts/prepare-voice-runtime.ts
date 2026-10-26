import { projectSystemAlsa } from "./prepare-system-alsa";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import references from "./voice-runtime-reference.json";

const LIVE_REFERENCE = references.reference;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function run(args: string[], cwd: string, log: string): Promise<void> {
	const child = Bun.spawn(args, {
		cwd,
		stdout: Bun.file(log),
		stderr: Bun.file(`${log}.stderr`),
		env: { ...Bun.env, CI: "true" },
	});
	if ((await child.exited) !== 0) throw new Error(`Native runtime command failed; preserved log: ${log}`);
}
async function executable(name: string): Promise<string> {
	const child = Bun.spawn(["/bin/sh", "-c", 'command -v "$1"', "voice-tool", name], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const value = (await new Response(child.stdout).text()).trim();
	if ((await child.exited) || !value.startsWith("/")) throw new Error(`Missing native build tool: ${name}`);
	return value;
}
export interface VoiceNativeEnvironment {
	root: string;
	environment: Record<string, string>;
}
async function inventory(root: string, name: "sdk" | "runtime", target: string): Promise<void> {
	const manifest = (await Bun.file(join(root, name, name === "sdk" ? "sdk.json" : "runtime.json")).json()) as {
		target?: string;
		sourceCommit?: string;
		sourceManifestSha256?: string;
		schemaVersion?: number;
		files?: { path: string; sha256: string }[];
		libraries?: { path: string; sha256: string }[];
	};
	if (
		manifest.schemaVersion !== 1 ||
		manifest.target !== target ||
		manifest.sourceCommit !== LIVE_REFERENCE ||
		manifest.sourceManifestSha256 !== references.files["third_party/voice/sources.json"]
	)
		throw new Error("Voice runtime source or target mismatch");
	const entries = manifest.files ?? manifest.libraries;
	if (!entries?.length) throw new Error("Missing native inventory");
	for (const entry of entries) {
		if (!/^[a-zA-Z0-9_.+/-]+$/.test(entry.path) || entry.path.split("/").includes("..") || entry.path.startsWith("/"))
			throw new Error("Invalid native inventory path");
		if (hash(await Bun.file(join(root, name, entry.path)).bytes()) !== entry.sha256)
			throw new Error("Native inventory hash mismatch");
	}
}
export async function prepareVoiceRuntime(repo = resolve(import.meta.dir, "..")): Promise<VoiceNativeEnvironment> {
	if (process.platform === "darwin" && Bun.env.GITHUB_ACTIONS !== "true")
		throw new Error("Build Mac native artifacts on approved CI, then validate the prebuilt artifact");
	if (!["linux", "darwin"].includes(process.platform) || !["x64", "arm64"].includes(process.arch))
		throw new Error("Native voice qualification supports Linux GNU and macOS");
	const target = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}`;
	const cache =
		Bun.env.XCSH_VOICE_NATIVE_CACHE ?? join(repo, "node_modules/.cache/voice-native", LIVE_REFERENCE, target);
	await mkdir(cache, { recursive: true });
	const current = join(cache, "current.json");
	if (references.reference !== LIVE_REFERENCE) throw new Error("Native source reference mismatch");
	let root: string | undefined;
	if (await Bun.file(current).exists()) {
		root = ((await Bun.file(current).json()) as { root: string }).root;
		await inventory(root, "sdk", target);
		await inventory(root, "runtime", target);
	}
	if (!root) {
		root = join(cache, `attempt-${Date.now()}-${process.pid}`);
		await mkdir(root, { recursive: true });
		for (const [path, digest] of Object.entries(references.files)) {
			const response = await fetch(`https://raw.githubusercontent.com/openai/codex/${LIVE_REFERENCE}/${path}`, {
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`Pinned source fetch failed: ${path}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (hash(bytes) !== digest) throw new Error(`Pinned source hash mismatch: ${path}`);
			await mkdir(dirname(join(root, path)), { recursive: true });
			await Bun.write(join(root, path), bytes);
		}
		const archives = join(root, "archives");
		await mkdir(archives);
		const sources = (await Bun.file(join(root, "third_party/voice/sources.json")).json()) as {
			sources: { name: string; url: string; archive: string; sha256: string }[];
		};
		for (const source of sources.sources) {
			const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
			if (!response.ok) throw new Error(`Native archive fetch failed: ${source.name}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.length > 64 * 1024 * 1024 || hash(bytes) !== source.sha256)
				throw new Error(`Native archive hash mismatch: ${source.name}`);
			await Bun.write(join(archives, source.archive), bytes);
		}
		const python = await executable("python3");
		const tools = await Promise.all(["cc", "c++", "cmake", "make", "pkg-config", "bash"].map(executable));
		await Bun.write(
			join(root, "build-inputs.json"),
			JSON.stringify({ reference: LIVE_REFERENCE, target, python, tools }),
		);
		const build = [
			python,
			"third_party/voice/build_native.py",
			"--archives",
			archives,
			"--output",
			join(root, "build"),
			"--target",
			target,
			"--cc",
			tools[0]!,
			"--cxx",
			tools[1]!,
			"--cmake",
			tools[2]!,
			"--make",
			tools[3]!,
			"--pkg-config",
			tools[4]!,
			"--shell",
			tools[5]!,
			"--jobs",
			"8",
		];
		if (process.platform === "darwin") build.push("--deployment-target", "13.0");
		await run(build, root, join(root, "build.private.log"));
		await run(
			["tar", "-cf", join(root, "prefix.tar"), "-C", join(root, "build/prefix"), "."],
			root,
			join(root, "archive.private.log"),
		);
		await Bun.write(join(root, "status.txt"), `STABLE_GIT_COMMIT ${LIVE_REFERENCE}\n`);
		await run(
			[
				python,
				"third_party/voice/prepare_built_runtime.py",
				"--prefix",
				join(root, "prefix.tar"),
				"--build-receipt",
				join(root, "build/built.json"),
				"--status",
				join(root, "status.txt"),
				"--target",
				target,
				"--output",
				join(root, "runtime"),
				"--sdk-output",
				join(root, "sdk"),
			],
			root,
			join(root, "projection.private.log"),
		);
		await inventory(root, "sdk", target);
		await inventory(root, "runtime", target);
		await Bun.write(current, JSON.stringify({ root, target, reference: LIVE_REFERENCE }));
	}
	// Cached SDKs also need the pinned redistribution notices. Validate each
	// existing file; fetch only absent files and never bless changed content.
	for (const [path, digest] of Object.entries(references.files)) {
		if (path !== "third_party/voice/NOTICE.md" && !path.startsWith("third_party/voice/licenses/")) continue;
		const file = Bun.file(join(root, path));
		if (!(await file.exists())) {
			const response = await fetch(`https://raw.githubusercontent.com/openai/codex/${LIVE_REFERENCE}/${path}`, {
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`Pinned license fetch failed: ${path}`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (hash(bytes) !== digest) throw new Error(`Pinned license hash mismatch: ${path}`);
			await mkdir(dirname(join(root, path)), { recursive: true });
			await Bun.write(join(root, path), bytes);
		}
		if (hash(await Bun.file(join(root, path)).bytes()) !== digest) throw new Error(`Pinned license changed: ${path}`);
	}
	const pkgConfig = await executable("pkg-config");
	const wrapper = join(root, "pkg-config-sdk");
	await Bun.write(wrapper, `#!/bin/sh\nexec '${pkgConfig.replaceAll("'", "'\\''")}' --define-prefix "$@"\n`);
	await run(["chmod", "+x", wrapper], root, join(root, "wrapper.private.log"));
	let systemPc = "";
	if (process.platform === "linux") {
		const child = Bun.spawn([pkgConfig, "--variable=pcfiledir", "alsa"], { stdout: "pipe", stderr: "pipe" });
		systemPc = (await new Response(child.stdout).text()).trim();
		if ((await child.exited) !== 0) systemPc = await projectSystemAlsa(cache);
	}
	return {
		root,
		environment: {
			PKG_CONFIG: wrapper,
			PKG_CONFIG_PATH: "",
			PKG_CONFIG_LIBDIR: join(root, "sdk/lib/pkgconfig") + (systemPc ? `:${systemPc}` : ""),
			CODEX_TEST_VOICE_RUNTIME: join(root, "runtime"),
			...(process.platform === "linux"
				? { LD_LIBRARY_PATH: join(root, "sdk/lib"), RUSTFLAGS: "-C link-arg=-Wl,-rpath,$ORIGIN/../lib" }
				: { DYLD_LIBRARY_PATH: join(root, "sdk/lib"), RUSTFLAGS: "-C link-arg=-Wl,-rpath,@loader_path/../lib" }),
		},
	};
}
if (import.meta.main) {
	const result = await prepareVoiceRuntime();
	await Bun.write(
		Bun.env.XCSH_VOICE_ENV_OUTPUT ??
			join(resolve(import.meta.dir, ".."), "node_modules/.cache/voice-native-env.private.json"),
		JSON.stringify(result, null, 2),
	);
}
