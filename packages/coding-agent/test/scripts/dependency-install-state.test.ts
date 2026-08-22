import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type BunLockFile,
	dependencyInstallNeedsLockRefresh,
	formatDependencyInstallMismatches,
	inspectDependencyInstall,
} from "../../../../scripts/check-installed-dependencies";

const lock: BunLockFile = {
	workspaces: {
		"packages/ai": {
			dependencies: {
				"@anthropic-ai/sdk": "^0.115",
			},
		},
		"packages/coding-agent": {
			dependencies: {
				"@agentclientprotocol/sdk": "^1.3",
			},
		},
	},
	packages: {
		"@anthropic-ai/sdk": ["@anthropic-ai/sdk@0.115.0"],
		"@agentclientprotocol/sdk": ["@agentclientprotocol/sdk@1.3.0"],
	},
};

describe("installed dependency state", () => {
	it("reports a stale isolated-linker workspace symlink instead of accepting the lockfile version", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-dependency-install-"));
		try {
			await writeInstalledVersion(root, "packages/ai", "@anthropic-ai/sdk", "0.78.0");
			await writeInstalledVersion(root, "packages/coding-agent", "@agentclientprotocol/sdk", "0.16.1");

			const mismatches = await inspectDependencyInstall(root, lock);

			expect(mismatches).toEqual([
				{
					workspace: "packages/ai",
					name: "@anthropic-ai/sdk",
					requested: "^0.115",
					lockedVersions: ["0.115.0"],
					installedVersion: "0.78.0",
				},
				{
					workspace: "packages/coding-agent",
					name: "@agentclientprotocol/sdk",
					requested: "^1.3",
					lockedVersions: ["1.3.0"],
					installedVersion: "0.16.1",
				},
			]);
			expect(formatDependencyInstallMismatches(mismatches)).toContain(
				"@anthropic-ai/sdk installed=0.78.0, locked=0.115.0",
			);
			expect(formatDependencyInstallMismatches(mismatches)).toContain(
				"@agentclientprotocol/sdk installed=0.16.1, locked=1.3.0",
			);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("accepts the exact version selected by bun.lock", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-dependency-install-"));
		try {
			await writeInstalledVersion(root, "packages/ai", "@anthropic-ai/sdk", "0.115.0");
			await writeInstalledVersion(root, "packages/coding-agent", "@agentclientprotocol/sdk", "1.3.0");

			expect(await inspectDependencyInstall(root, lock)).toEqual([]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("requires a lock refresh when a release bump has no satisfying package entry", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-dependency-install-"));
		const staleReleaseLock: BunLockFile = {
			workspaces: {
				"packages/natives": {
					optionalDependencies: {
						"@f5-sales-demo/pi-natives-darwin-arm64": "20.2.7",
						"@f5-sales-demo/pi-natives-linux-x64-gnu": "20.2.7",
					},
				},
			},
			packages: {
				"@f5-sales-demo/pi-natives-darwin-arm64": ["@f5-sales-demo/pi-natives-darwin-arm64@20.2.6"],
			},
		};
		try {
			await writeInstalledVersion(root, "packages/natives", "@f5-sales-demo/pi-natives-darwin-arm64", "20.2.6");

			const mismatches = await inspectDependencyInstall(root, staleReleaseLock);

			expect(mismatches).toEqual([
				{
					workspace: "packages/natives",
					name: "@f5-sales-demo/pi-natives-darwin-arm64",
					requested: "20.2.7",
					lockedVersions: [],
					installedVersion: "20.2.6",
				},
				{
					workspace: "packages/natives",
					name: "@f5-sales-demo/pi-natives-linux-x64-gnu",
					requested: "20.2.7",
					lockedVersions: [],
					installedVersion: undefined,
				},
			]);
			expect(dependencyInstallNeedsLockRefresh(mismatches)).toBe(true);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("accepts only matching in-repo prepublication optional package versions", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-dependency-install-"));
		const prepublicationLock: BunLockFile = {
			workspaces: {
				"packages/natives": {
					optionalDependencies: {
						"@f5-sales-demo/pi-natives-darwin-arm64": "20.3.0",
						"@f5-sales-demo/pi-natives-darwin-x64": "20.3.0",
						"@f5-sales-demo/pi-natives-linux-arm64-gnu": "20.3.0",
						"@f5-sales-demo/pi-natives-linux-x64-gnu": "20.3.0",
					},
				},
			},
			packages: {},
		};
		try {
			await writePackageVersion(root, "darwin-arm64", "@f5-sales-demo/pi-natives-darwin-arm64", "20.3.0");
			await writePackagePayload(root, "darwin-arm64");
			await writePackageVersion(root, "darwin-x64", "@f5-sales-demo/pi-natives-darwin-x64", "20.3.0");
			await writePackageVersion(root, "linux-arm64-gnu", "@f5-sales-demo/pi-natives-linux-arm64-gnu", "20.3.0");
			await writePackagePayload(root, "linux-arm64-gnu");
			await writePackageVersion(root, "linux-x64-gnu", "@f5-sales-demo/pi-natives-linux-x64-gnu", "20.2.7");
			await writeInstalledVersion(root, "packages/natives", "@f5-sales-demo/pi-natives-darwin-arm64", "20.3.0");
			await writeInstalledVersion(root, "packages/natives", "@f5-sales-demo/pi-natives-darwin-x64", "20.2.7");

			expect(await inspectDependencyInstall(root, prepublicationLock)).toEqual([
				{
					workspace: "packages/natives",
					name: "@f5-sales-demo/pi-natives-darwin-x64",
					requested: "20.3.0",
					lockedVersions: [],
					installedVersion: "20.2.7",
				},
				{
					workspace: "packages/natives",
					name: "@f5-sales-demo/pi-natives-linux-x64-gnu",
					requested: "20.3.0",
					lockedVersions: [],
					installedVersion: undefined,
				},
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a manifest-only prepublication optional package", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-dependency-install-"));
		const prepublicationLock: BunLockFile = {
			workspaces: {
				"packages/natives": {
					optionalDependencies: {
						"@f5-sales-demo/pi-natives-linux-x64-gnu": "20.3.0",
					},
				},
			},
			packages: {},
		};
		try {
			await writePackageVersion(root, "linux-x64-gnu", "@f5-sales-demo/pi-natives-linux-x64-gnu", "20.3.0");

			expect(await inspectDependencyInstall(root, prepublicationLock)).toEqual([
				{
					workspace: "packages/natives",
					name: "@f5-sales-demo/pi-natives-linux-x64-gnu",
					requested: "20.3.0",
					lockedVersions: [],
					installedVersion: undefined,
				},
			]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	it("preserves package-specific workspace test concurrency guards", async () => {
		const repoRoot = path.join(import.meta.dir, "../../../..");
		const manifest = (await Bun.file(path.join(repoRoot, "package.json")).json()) as {
			scripts?: Record<string, string>;
		};

		expect(manifest.scripts?.["test:ts"]).toBe(
			"bun run ensure:dependencies && bun run --workspaces --if-present test -- --only-failures",
		);
	});
});

async function writeInstalledVersion(root: string, workspace: string, name: string, version: string): Promise<void> {
	await Bun.write(
		path.join(root, workspace, "node_modules", ...name.split("/"), "package.json"),
		JSON.stringify({ version }),
	);
}

async function writePackageVersion(root: string, directory: string, name: string, version: string): Promise<void> {
	await Bun.write(
		path.join(root, "packages/natives/npm", directory, "package.json"),
		JSON.stringify({ name, version, main: "native.node" }),
	);
}

async function writePackagePayload(root: string, directory: string): Promise<void> {
	await Bun.write(path.join(root, "packages/natives/npm", directory, "native.node"), "test native payload");
}
