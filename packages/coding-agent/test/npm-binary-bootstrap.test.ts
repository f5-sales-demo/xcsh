import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureReleaseBinary,
	getPackageDistributionChannel,
	getReleaseAsset,
	getReleaseDownloadUrl,
	releaseValidationEnvironment,
	runReleaseBinary,
} from "../src/npm-binary-bootstrap";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function makeTempDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-npm-bootstrap-test-"));
	tempDirectories.push(directory);
	return directory;
}

function fakeBinary(version: string): Uint8Array {
	return new TextEncoder().encode(
		`#!/bin/sh\nif [ "$1" = "--version" ]; then echo "xcsh/${version}"; exit 0; fi\nprintf '%s\\n' "$@"\n`,
	);
}

describe("npm binary bootstrap", () => {
	it("maps every supported platform and architecture to its release asset", () => {
		expect(getReleaseAsset("linux", "x64")).toBe("xcsh-linux-x64");
		expect(getReleaseAsset("linux", "arm64")).toBe("xcsh-linux-arm64");
		expect(getReleaseAsset("darwin", "x64")).toBe("xcsh-darwin-x64");
		expect(getReleaseAsset("darwin", "arm64")).toBe("xcsh-darwin-arm64");
		expect(getReleaseAsset("win32", "x64")).toBe("xcsh-windows-x64.exe");
		expect(() => getReleaseAsset("win32", "arm64")).toThrow("Unsupported xcsh platform");
	});

	it("uses an exact-version GitHub release URL", () => {
		expect(getReleaseDownloadUrl("21.5.4", "xcsh-linux-x64")).toBe(
			"https://github.com/f5-sales-demo/xcsh/releases/download/v21.5.4/xcsh-linux-x64",
		);
	});

	it("preserves Bun and npm as distinct update channels", () => {
		expect(getPackageDistributionChannel("/opt/xcsh/.bun/install/global/node_modules/@f5-sales-demo/xcsh/bin")).toBe(
			"bun",
		);
		expect(getPackageDistributionChannel("C:\\xcsh\\.bun\\install\\cache\\xcsh\\bin")).toBe("bun");
		expect(getPackageDistributionChannel("/usr/local/lib/node_modules/@f5-sales-demo/xcsh/bin")).toBe("npm");
	});

	it("strips launcher smoke modes from internal version validation", () => {
		expect(
			releaseValidationEnvironment({
				PATH: "/test/bin",
				XCSH_SMOKE_TEST_SPECS: "1",
				XCSH_SMOKE_TEST_VERTEX_AUTH: "1",
			}),
		).toEqual({ PATH: "/test/bin" });
	});

	it("downloads once, validates the version, and reuses the cached executable", async () => {
		const cacheRoot = await makeTempDirectory();
		let downloads = 0;
		const fetchImpl: typeof fetch = Object.assign(
			async () => {
				downloads++;
				return new Response(fakeBinary("21.5.4"), { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		) as typeof fetch;

		const first = await ensureReleaseBinary({
			version: "21.5.4",
			platform: "linux",
			arch: "x64",
			cacheRoot,
			fetchImpl,
		});
		const second = await ensureReleaseBinary({
			version: "21.5.4",
			platform: "linux",
			arch: "x64",
			cacheRoot,
			fetchImpl,
		});

		expect(second).toBe(first);
		expect(downloads).toBe(1);
		expect(await readFile(first, "utf8")).toContain("xcsh/21.5.4");
	});

	it("serializes concurrent downloads and never exposes a partial executable", async () => {
		const cacheRoot = await makeTempDirectory();
		let downloads = 0;
		const fetchImpl: typeof fetch = Object.assign(
			async () => {
				downloads++;
				await Bun.sleep(50);
				return new Response(fakeBinary("21.5.4"), { status: 200 });
			},
			{ preconnect: fetch.preconnect },
		) as typeof fetch;

		const options = {
			version: "21.5.4",
			platform: "linux" as const,
			arch: "x64" as const,
			cacheRoot,
			fetchImpl,
		};
		const [first, second] = await Promise.all([ensureReleaseBinary(options), ensureReleaseBinary(options)]);

		expect(first).toBe(second);
		expect(downloads).toBe(1);
	});

	it("rejects a mismatched binary and removes the partial download", async () => {
		const cacheRoot = await makeTempDirectory();
		const fetchImpl: typeof fetch = Object.assign(async () => new Response(fakeBinary("99.0.0"), { status: 200 }), {
			preconnect: fetch.preconnect,
		}) as typeof fetch;

		await expect(
			ensureReleaseBinary({
				version: "21.5.4",
				platform: "linux",
				arch: "x64",
				cacheRoot,
				fetchImpl,
			}),
		).rejects.toThrow("reported version 99.0.0");

		const entries = Array.from(new Bun.Glob("**/*").scanSync({ cwd: cacheRoot, onlyFiles: true }));
		expect(entries).toEqual([]);
	});

	it("forwards arguments, package channel, and the child exit code", async () => {
		const directory = await makeTempDirectory();
		const binaryPath = join(directory, "xcsh");
		const observedPath = join(directory, "observed");
		await writeFile(
			binaryPath,
			`#!/bin/sh\nprintf '%s\\n' "$XCSH_DISTRIBUTION_CHANNEL" "$@" > ${JSON.stringify(observedPath)}\nexit 23\n`,
		);
		await chmod(binaryPath, 0o755);

		const result = await runReleaseBinary(binaryPath, ["--model", "vertex", "hello"], "bun");

		expect(result.exitCode).toBe(23);
		expect(result.signalCode).toBeUndefined();
		expect((await readFile(observedPath, "utf8")).trim().split("\n")).toEqual(["bun", "--model", "vertex", "hello"]);
	});
});
