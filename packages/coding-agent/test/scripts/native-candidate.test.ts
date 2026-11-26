import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { packNativeCandidate } from "../../../../scripts/install-tests/native-candidate";

const roots: string[] = [];
const baseline = "pi_natives.linux-x64-baseline.node";
const modern = "pi_natives.linux-x64-modern.node";

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "xcsh-native-candidate-"));
	roots.push(root);
	const native = path.join(root, "packages/natives/native");
	const platform = path.join(root, "packages/natives/npm/linux-x64-gnu");
	await mkdir(native, { recursive: true });
	await mkdir(platform, { recursive: true });
	const wrapper = {
		version: "25.0.2",
		optionalDependencies: { "@f5-sales-demo/pi-natives-linux-x64-gnu": "23.10.12" },
	};
	const manifest = {
		name: "@f5-sales-demo/pi-natives-linux-x64-gnu",
		version: "25.0.2",
		os: ["linux"],
		cpu: ["x64"],
		main: baseline,
		files: [baseline, modern],
	};
	await writeFile(path.join(root, "packages/natives/package.json"), JSON.stringify(wrapper));
	await writeFile(path.join(platform, "package.json"), JSON.stringify(manifest));
	await writeFile(path.join(native, baseline), "original-baseline");
	await writeFile(path.join(native, modern), "original-modern");
	return { root, native, platform, manifest, destination: path.join(root, "candidate") };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("candidate native platform installation", () => {
	it("packs both current variants without changing unpublished release dependency pins", async () => {
		const f = await fixture();
		const wrapperBefore = await readFile(path.join(f.root, "packages/natives/package.json"));
		const platformBefore = await readFile(path.join(f.platform, "package.json"));
		const candidate = await packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" });
		expect(candidate.name).toBe(f.manifest.name);
		expect(candidate.version).toBe("25.0.2");
		const listing = Bun.spawn(["tar", "-tf", candidate.tarball], { stdout: "pipe", stderr: "pipe" });
		const names = (await new Response(listing.stdout).text()).trim().split("\n").sort();
		expect(await listing.exited).toBe(0);
		expect(names).toEqual(["package/package.json", `package/${baseline}`, `package/${modern}`].sort());
		for (const [filename, content] of [
			[baseline, "original-baseline"],
			[modern, "original-modern"],
		]) {
			const extraction = Bun.spawn(["tar", "-xOf", candidate.tarball, `package/${filename}`], {
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(await new Response(extraction.stdout).text()).toBe(content);
			expect(await extraction.exited).toBe(0);
		}
		expect(await readFile(path.join(f.root, "packages/natives/package.json"))).toEqual(wrapperBefore);
		expect(await readFile(path.join(f.platform, "package.json"))).toEqual(platformBefore);
	});

	it("refuses incomplete x64 variants before publishing a candidate tarball", async () => {
		const f = await fixture();
		await rm(path.join(f.native, modern));
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"modern",
		);
		expect((await readdir(f.destination).catch(() => [] as string[])).filter(name => name.endsWith(".tgz"))).toEqual(
			[],
		);
	});

	it("refuses a platform manifest from a different wrapper version", async () => {
		const f = await fixture();
		await writeFile(path.join(f.platform, "package.json"), JSON.stringify({ ...f.manifest, version: "23.10.12" }));
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"version",
		);
	});

	it("refuses unsupported host mappings and mismatched manifest identity", async () => {
		const f = await fixture();
		await expect(packNativeCandidate(f.root, f.destination, { platform: "aix", arch: "x64" })).rejects.toThrow(
			"Unsupported",
		);
		await writeFile(
			path.join(f.platform, "package.json"),
			JSON.stringify({ ...f.manifest, name: "@example/foreign-native" }),
		);
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"identity",
		);
	});

	it("refuses symlinked binaries and unreviewed installation hooks", async () => {
		const f = await fixture();
		await rm(path.join(f.native, modern));
		await symlink(path.join(f.native, baseline), path.join(f.native, modern));
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"regular file",
		);
		await rm(path.join(f.native, modern));
		await writeFile(path.join(f.native, modern), "original-modern");
		await writeFile(
			path.join(f.platform, "package.json"),
			JSON.stringify({ ...f.manifest, scripts: { prepack: "unreviewed-command" } }),
		);
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"hook",
		);
	});

	it("refuses files outside the declared host native contract", async () => {
		const f = await fixture();
		await writeFile(
			path.join(f.platform, "package.json"),
			JSON.stringify({ ...f.manifest, files: [baseline, "../../foreign.node"] }),
		);
		await expect(packNativeCandidate(f.root, f.destination, { platform: "linux", arch: "x64" })).rejects.toThrow(
			"files",
		);
	});

	for (const [platform, arch, packageTarget] of [
		["linux", "arm64", "linux-arm64-gnu"],
		["darwin", "arm64", "darwin-arm64"],
		["darwin", "x64", "darwin-x64"],
		["win32", "x64", "win32-x64-msvc"],
	] as const) {
		it(`packs the existing ${packageTarget} manifest contract`, async () => {
			const f = await fixture();
			const files =
				arch === "x64"
					? [`pi_natives.${platform}-${arch}-baseline.node`, `pi_natives.${platform}-${arch}-modern.node`]
					: [`pi_natives.${platform}-${arch}.node`];
			const directory = path.join(f.root, "packages/natives/npm", packageTarget);
			await mkdir(directory, { recursive: true });
			await writeFile(
				path.join(directory, "package.json"),
				JSON.stringify({
					...f.manifest,
					name: `@f5-sales-demo/pi-natives-${packageTarget}`,
					os: [platform],
					cpu: [arch],
					main: files[0],
					files,
				}),
			);
			for (const filename of files) await writeFile(path.join(f.native, filename), "original-platform-payload");
			const candidate = await packNativeCandidate(f.root, f.destination, { platform, arch });
			expect(candidate.name).toBe(`@f5-sales-demo/pi-natives-${packageTarget}`);
			expect((await readFile(candidate.tarball)).length).toBeGreaterThan(0);
			await expect(packNativeCandidate(f.root, f.destination, { platform, arch })).rejects.toThrow("already exists");
		});
	}
});
