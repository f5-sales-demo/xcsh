import { expect, test, vi } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ensureNativeReady,
	missingNativeExports,
	probeNative,
	verifyConfiguredNativeManifest,
	withNativePreparationLock,
} from "../../../../scripts/ensure-dev-native";

test("verified CI native manifests bypass developer rebuild preparation", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-verified-native-"));
	const manifestPath = join(root, "native-manifest.json");
	const manifest = { schema_version: 1 as const, source_sha: "a".repeat(40), files: [] };
	const verify = vi.fn(async () => {});
	try {
		await Bun.write(manifestPath, JSON.stringify(manifest));
		expect(await verifyConfiguredNativeManifest({}, root, verify)).toBe(false);
		await expect(
			verifyConfiguredNativeManifest({ XCSH_VERIFIED_NATIVE_MANIFEST: manifestPath }, root, verify),
		).rejects.toThrow("GITHUB_SHA");
		expect(
			await verifyConfiguredNativeManifest(
				{ XCSH_VERIFIED_NATIVE_MANIFEST: manifestPath, GITHUB_SHA: manifest.source_sha },
				root,
				verify,
			),
		).toBe(true);
		expect(verify).toHaveBeenCalledWith(root, manifest, manifest.source_sha);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("concurrent preparation waits and rechecks readiness instead of building twice", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-lock-"));
	const lock = join(root, "ready.lock");
	let ready = false;
	let release!: () => void;
	const hold = new Promise<void>(resolve => {
		release = resolve;
	});
	let entered!: () => void;
	const started = new Promise<void>(resolve => {
		entered = resolve;
	});
	const build = vi.fn(async () => {
		entered();
		await hold;
	});
	const work = () =>
		ensureNativeReady({
			current: async () => ready,
			probe: async () => [],
			build,
			record: async () => {
				ready = true;
			},
		});
	try {
		const first = withNativePreparationLock(lock, work);
		await started;
		let waited!: () => void;
		const waiting = new Promise<void>(resolve => {
			waited = resolve;
		});
		const second = withNativePreparationLock(lock, work, { pollMs: 1, waiting: () => waited() });
		await waiting;
		expect(build).toHaveBeenCalledTimes(1);
		release();
		await Promise.all([first, second]);
		expect(build).toHaveBeenCalledTimes(1);
		expect(await Bun.file(lock).exists()).toBe(false);
	} finally {
		release();
		await rm(root, { recursive: true, force: true });
	}
});

test("failed preparation releases its lock; timed-out wait never removes another owner's lock", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-lock-failure-"));
	const lock = join(root, "ready.lock");
	try {
		await expect(
			withNativePreparationLock(lock, async () => {
				throw new Error("fixture build failed");
			}),
		).rejects.toThrow("fixture build failed");
		expect(await Bun.file(lock).exists()).toBe(false);
		await Bun.write(lock, "fixture owner");
		const work = vi.fn(async () => {});
		await expect(withNativePreparationLock(lock, work, { timeoutMs: 2, pollMs: 1 })).rejects.toThrow(
			"lock timed out",
		);
		expect(work).not.toHaveBeenCalled();
		expect(await Bun.file(lock).text()).toBe("fixture owner");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("independent developer processes share one preparation and reuse the resulting receipt", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-process-lock-"));
	const script = resolve(import.meta.dir, "../../../../scripts/ensure-dev-native.ts");
	const code = `
		import { withNativePreparationLock, ensureNativeReady } from ${JSON.stringify(script)};
		const root = process.argv[1];
		await withNativePreparationLock(root + '/ready.lock', () => ensureNativeReady({
			current: () => Bun.file(root + '/receipt').exists(),
			probe: async () => [],
			build: async () => {
				const file = Bun.file(root + '/builds');
				const count = await file.exists() ? Number(await file.text()) : 0;
				await Bun.sleep(50);
				await Bun.write(root + '/builds', String(count + 1));
			},
			record: async () => { await Bun.write(root + '/receipt', 'ready'); },
		}), { pollMs: 1 });
	`;
	try {
		const children = [0, 1].map(() =>
			Bun.spawn([process.execPath, "-e", code, root], { stdout: "pipe", stderr: "pipe" }),
		);
		const results = await Promise.all(
			children.map(async child => ({ code: await child.exited, error: await new Response(child.stderr).text() })),
		);
		expect(results).toEqual([
			{ code: 0, error: "" },
			{ code: 0, error: "" },
		]);
		expect(await Bun.file(join(root, "builds")).text()).toBe("1");
		expect(await Bun.file(join(root, "receipt")).text()).toBe("ready");
		expect(await Bun.file(join(root, "ready.lock")).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("real subprocess rejects a stale JS stub and reloads its replacement", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-probe-"));
	try {
		const directory = join(root, "packages/natives/native");
		await mkdir(directory, { recursive: true });
		await Bun.write(
			join(directory, "index.d.ts"),
			"export declare class PowerAssertion {}\nexport declare function newApi(): void",
		);
		await Bun.write(join(directory, "index.js"), "module.exports = { newApi() {} };");
		expect(await probeNative(root)).toEqual(["PowerAssertion"]);
		await Bun.write(join(directory, "index.js"), "module.exports = { PowerAssertion: class {}, newApi() {} };");
		expect(await probeNative(root)).toEqual([]);
		await Bun.write(join(directory, "index.js"), "throw new Error('fixture addon cannot load');");
		expect((await probeNative(root)).join(" ")).toContain("fixture addon cannot load");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("native contract checks every declared runtime export, not just PowerAssertion", () => {
	const declarations =
		"export declare class PowerAssertion {}\nexport declare function newApi(): void\nexport interface Options {}\nexport declare enum Mode { A }";
	expect(missingNativeExports(declarations, { PowerAssertion: class {}, Mode: {} })).toEqual(["newApi"]);
	expect(missingNativeExports(declarations, { PowerAssertion: class {}, newApi() {}, Mode: {} })).toEqual([]);
});

test("matching source receipt and compatible probe avoid rebuilding", async () => {
	const build = vi.fn();
	const record = vi.fn();
	await ensureNativeReady({ current: async () => true, probe: async () => [], build, record });
	expect(build).not.toHaveBeenCalled();
	expect(record).not.toHaveBeenCalled();
});

test("source changes rebuild even when old addon exports remain compatible", async () => {
	const events: string[] = [];
	await ensureNativeReady({
		current: async () => false,
		probe: async () => {
			events.push("probe");
			return [];
		},
		build: async () => {
			events.push("build");
		},
		record: async () => {
			events.push("record");
		},
	});
	expect(events).toEqual(["build", "probe", "record"]);
});

test("incompatible loaded addon rebuilds and must pass a fresh probe before recording success", async () => {
	const probe = vi.fn().mockResolvedValueOnce(["newApi"]).mockResolvedValueOnce([]);
	const build = vi.fn();
	const record = vi.fn();
	await ensureNativeReady({ current: async () => true, probe, build, record });
	expect(probe).toHaveBeenCalledTimes(2);
	expect(build).toHaveBeenCalledTimes(1);
	expect(record).toHaveBeenCalledTimes(1);
});

test("build or post-build compatibility failure never records a ready receipt", async () => {
	const record = vi.fn();
	await expect(
		ensureNativeReady({
			current: async () => false,
			probe: async () => [],
			build: async () => {
				throw new Error("Rust unavailable");
			},
			record,
		}),
	).rejects.toThrow("Rust unavailable");
	await expect(
		ensureNativeReady({
			current: async () => false,
			probe: async () => ["PowerAssertion"],
			build: async () => {},
			record,
		}),
	).rejects.toThrow("PowerAssertion");
	expect(record).not.toHaveBeenCalled();
});

test("sources changing during build cannot be certified as a current addon", async () => {
	let source = "before";
	const record = vi.fn();
	await expect(
		ensureNativeReady({
			sourceVersion: async () => source,
			current: async () => false,
			build: async () => {
				source = "after";
			},
			probe: async () => [],
			record,
		}),
	).rejects.toThrow("sources changed during preparation");
	expect(record).not.toHaveBeenCalled();
});

test("a source edit during the cached probe forces a new build", async () => {
	let source = "before";
	const build = vi.fn();
	const record = vi.fn();
	await ensureNativeReady({
		sourceVersion: async () => source,
		current: async () => true,
		probe: async () => {
			source = "after";
			return [];
		},
		build,
		record,
	});
	expect(build).toHaveBeenCalledTimes(1);
	expect(record).toHaveBeenCalledWith("after");
});
