import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectHostAvx2Support } from "./host-detect";
import { type NativeManifest, verifyNativeManifest } from "./ci-native-manifest";

/** Generated bindings are the runtime contract; interfaces/type aliases have no runtime value. */
export function missingNativeExports(declarations: string, native: Record<string, unknown>): string[] {
	return [...declarations.matchAll(/^export declare (class|function|enum|const) (\w+)/gm)]
		.filter(([, kind, name]) => kind === "class" || kind === "function"
			? typeof native[name] !== "function" : native[name] === undefined)
		.map(([, , name]) => name);
}

interface NativeReadiness {
	sourceVersion?(): Promise<string>;
	current(): Promise<boolean>;
	probe(): Promise<string[]>;
	build(): Promise<void>;
	record(expectedSource?: string): Promise<void>;
}

export async function ensureNativeReady(operations: NativeReadiness): Promise<void> {
	const initialSource = await operations.sourceVersion?.();
	if (await operations.current() && (await operations.probe()).length === 0
		&& initialSource === await operations.sourceVersion?.()) return;
	const buildSource = await operations.sourceVersion?.();
	await operations.build();
	const missing = await operations.probe();
	if (missing.length) throw new Error(`Native addon remains incompatible after rebuilding: ${missing.join(", ")}`);
	if (buildSource !== await operations.sourceVersion?.())
		throw new Error("Native sources changed during preparation. Rerun the command to build the current sources; no readiness receipt was saved.");
	await operations.record(buildSource);
}

const repoRoot = join(import.meta.dir, "..");

export async function verifyConfiguredNativeManifest(
	environment: Record<string, string | undefined> = Bun.env,
	root = repoRoot,
	verify = verifyNativeManifest,
): Promise<boolean> {
	const manifestPath = environment.XCSH_VERIFIED_NATIVE_MANIFEST;
	if (!manifestPath) return false;
	const sourceSha = environment.GITHUB_SHA;
	if (!sourceSha) throw new Error("GITHUB_SHA is required when reusing verified native artifacts");
	const manifest = (await Bun.file(manifestPath).json()) as NativeManifest;
	await verify(root, manifest, sourceSha);
	return true;
}

/** Serialize the entire check/build/probe/receipt transaction, not just Cargo. */
export async function withNativePreparationLock<T>(
	lockPath: string,
	work: () => Promise<T>,
	options: { timeoutMs?: number; pollMs?: number; waiting?: (owner: string) => void } = {},
): Promise<T> {
	await mkdir(dirname(lockPath), { recursive: true });
	const deadline = performance.now() + (options.timeoutMs ?? 10 * 60_000);
	let notified = false;
	let lock: Awaited<ReturnType<typeof open>>;
	for (;;) {
		try {
			lock = await open(lockPath, "wx", 0o600);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const owner = await readFile(lockPath, "utf8").catch(() => "owner not yet recorded");
			if (!notified) { options.waiting?.(owner.trim()); notified = true; }
			if (performance.now() >= deadline)
				throw new Error(`Native preparation lock timed out: ${lockPath} (${owner.trim()}). Check that preparation and its build subprocess have ended before removing an abandoned lock; do not delete a live owner's lock.`);
			await Bun.sleep(options.pollMs ?? 100);
		}
	}
	try {
		await lock.writeFile(`pid=${process.pid} started=${new Date().toISOString()}\n`);
		return await work();
	} finally {
		await lock.close();
		await unlink(lockPath);
	}
}

export async function probeNative(root = repoRoot): Promise<string[]> {
	// A separate process is mandatory: native modules cannot reliably be unloaded after rebuilding.
	const child = Bun.spawn([process.execPath, import.meta.path, "--probe", root], {
		cwd: repoRoot, stdout: "pipe", stderr: "pipe",
	});
	const [code, output, error] = await Promise.all([
		child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
	]);
	if (code !== 0) return [error.trim() || `native probe exited ${code}`];
	return JSON.parse(output) as string[];
}

async function prepare(): Promise<void> {
	if (await verifyConfiguredNativeManifest()) return;
	const variant = process.arch === "x64"
		? process.env.PI_NATIVE_VARIANT || (detectHostAvx2Support() ? "modern" : "baseline") : undefined;
	if (variant && variant !== "modern" && variant !== "baseline") throw new Error("Invalid PI_NATIVE_VARIANT; use modern or baseline.");
	if (process.env.CROSS_TARGET || (process.env.TARGET_PLATFORM && process.env.TARGET_PLATFORM !== process.platform)
		|| (process.env.TARGET_ARCH && process.env.TARGET_ARCH !== process.arch)) {
		throw new Error("Development tests require a host addon. Unset cross-compilation targets before running the development bootstrap.");
	}
	const artifact = join(repoRoot, "packages/natives/native", `pi_natives.${process.platform}-${process.arch}${variant ? `-${variant}` : ""}.node`);
	const receipt = join(repoRoot, "node_modules/.cache/xcsh-native-ready.json");
	const fingerprint = async (sourceOnly = false) => {
		const child = Bun.spawn(["git", "ls-files", "-c", "-o", "--exclude-standard", "-z", "--",
			"Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo", "crates", "packages/natives", "scripts/host-detect.ts", "scripts/ensure-dev-native.ts"],
			{ cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
		const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		if (code !== 0) throw new Error(`Cannot fingerprint native sources: ${error.trim()}`);
		const hash = createHash("sha256");
		for (const file of [...new Set(output.split("\0").filter(Boolean))].sort()) {
			// napi generates these outputs while building; they are checked by the full readiness fingerprint.
			if (sourceOnly && /^packages\/natives\/native\/index\.(js|d\.ts)$/.test(file)) continue;
			hash.update(file).update("\0");
			const source = Bun.file(join(repoRoot, file));
			hash.update(await source.exists() ? await source.bytes() : "[deleted]");
		}
		hash.update(JSON.stringify({ platform: process.platform, arch: process.arch, variant,
			bun: Bun.version, rustflags: process.env.RUSTFLAGS ?? "", ci: Boolean(process.env.CI) }));
		if (!sourceOnly) {
			const binary = Bun.file(artifact);
			hash.update(await binary.exists() ? await binary.bytes() : "[missing artifact]");
		}
		return hash.digest("hex");
	};
	await withNativePreparationLock(`${receipt}.lock`, () => ensureNativeReady({
		sourceVersion: () => fingerprint(true),
		current: async () => {
			if (!await Bun.file(artifact).exists() || !await Bun.file(receipt).exists()) return false;
			return await Bun.file(receipt).text() === await fingerprint();
		},
		probe: () => probeNative(),
		build: async () => {
			process.stderr.write("Preparing the source-matched native addon (missing, changed, or incompatible)…\n");
			const child = Bun.spawn([process.execPath, "run", "build:native"], { cwd: repoRoot,
				stdout: "inherit", stderr: "inherit", env: { ...process.env, TARGET_VARIANT: variant } });
			if (await child.exited !== 0) throw new Error("Native build failed. Check the Rust/Zig prerequisites in DEVELOPING.md; no readiness receipt was saved.");
			if (!await Bun.file(artifact).exists()) throw new Error(`Native build did not produce the required host artifact: ${artifact}`);
		},
		record: async expectedSource => {
			await mkdir(dirname(receipt), { recursive: true });
			const readyFingerprint = await fingerprint();
			if (await fingerprint(true) !== expectedSource)
				throw new Error("Native sources changed before readiness could be recorded. Rerun preparation.");
			const temporary = `${receipt}.${process.pid}.tmp`;
			await Bun.write(temporary, readyFingerprint);
			await rename(temporary, receipt);
		},
	}), { waiting: owner => process.stderr.write(`Waiting for native preparation (${owner})…\n`) });
}

if (import.meta.main) {
	try {
		if (process.argv[2] === "--probe") {
			const root = process.argv[3] ?? repoRoot;
			const native = await import(pathToFileURL(join(root, "packages/natives/native/index.js")).href);
			const declarations = await Bun.file(join(root, "packages/natives/native/index.d.ts")).text();
			process.stdout.write(JSON.stringify(missingNativeExports(declarations, native)));
		} else await prepare();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
