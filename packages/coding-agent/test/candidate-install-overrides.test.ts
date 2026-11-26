import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const driver = readFileSync(join(rootDir, "scripts/install-tests/run-ci.sh"), "utf8");
const start = driver.indexOf("  # Write overrides");
const end = driver.indexOf("\n  bun add ", start);
if (start < 0 || end < start) throw new Error("Candidate override invocation is missing");
const invocation = driver.slice(start, end);
const names = [
	"@f5-sales-demo/pi-utils",
	"@f5-sales-demo/pi-natives",
	"@f5-sales-demo/pi-ai",
	"@f5-sales-demo/pi-agent-core",
	"@f5-sales-demo/pi-tui",
	"@f5-sales-demo/xcsh-stats",
	"@f5-sales-demo/pi-resource-management",
	"@f5-sales-demo/xcsh-f5-core",
	"@f5-sales-demo/xcsh",
];
const variables = [
	"utils_tgz",
	"natives_tgz",
	"ai_tgz",
	"agent_tgz",
	"tui_tgz",
	"stats_tgz",
	"resource_mgmt_tgz",
	"f5_core_tgz",
	"coding_agent_tgz",
];

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "xcsh-candidate-overrides-"));
	const bin = join(root, "bin");
	mkdirSync(bin);
	symlinkSync(process.execPath, join(bin, "node"));
	symlinkSync(process.execPath, join(bin, "bun"));
	const archives = names.map((_, index) => join(root, `archive ${index}'s.tgz`));
	const initial = JSON.stringify({ name: "disposable-candidate", private: true });
	const packagePath = join(root, "package.json");
	writeFileSync(packagePath, initial);
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		ROOT_DIR: rootDir,
		...Object.fromEntries(variables.map((name, index) => [name, archives[index]])),
	};
	return { root, archives, initial, packagePath, env };
}

test("candidate overrides retain exact archive paths when node resolves to Bun", () => {
	const f = fixture();
	try {
		const result = spawnSync("bash", ["-c", invocation], {
			cwd: f.root,
			env: f.env,
			encoding: "utf8",
			timeout: 10_000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		const pkg = JSON.parse(readFileSync(f.packagePath, "utf8"));
		expect(pkg.name).toBe("disposable-candidate");
		expect(pkg.overrides).toEqual(Object.fromEntries(names.map((name, index) => [name, f.archives[index]])));
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("incomplete candidate inventory refuses before rewriting package.json", () => {
	const f = fixture();
	try {
		const env = { ...f.env, coding_agent_tgz: "" };
		// Valid plain paths isolate missing inventory from the quoting regression.
		for (const [index, name] of variables.entries()) {
			if (name !== "coding_agent_tgz") env[name as keyof typeof env] = join(f.root, `archive-${index}.tgz`);
		}
		const result = spawnSync("bash", ["-c", invocation], { cwd: f.root, env, encoding: "utf8", timeout: 10_000 });
		expect(result.error).toBeUndefined();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Candidate tarball inventory mismatch");
		expect(readFileSync(f.packagePath, "utf8")).toBe(f.initial);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("candidate helper retains the verified platform native override", () => {
	const f = fixture();
	try {
		const native = { name: "@f5-sales-demo/pi-natives-linux-x64", tarball: join(f.root, "native candidate.tgz") };
		const result = spawnSync(
			process.execPath,
			[join(rootDir, "scripts/install-tests/candidate-overrides.ts"), ...f.archives],
			{
				cwd: f.root,
				env: { ...f.env, XCSH_NATIVE_CANDIDATE_JSON: JSON.stringify(native) },
				encoding: "utf8",
				timeout: 10_000,
			},
		);
		expect(result.status).toBe(0);
		const pkg = JSON.parse(readFileSync(f.packagePath, "utf8"));
		expect(pkg.overrides).toEqual({
			...Object.fromEntries(names.map((name, index) => [name, f.archives[index]])),
			[native.name]: native.tarball,
		});
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("candidate helper rejects a foreign native mapping without writing", () => {
	const f = fixture();
	try {
		const result = spawnSync(
			process.execPath,
			[join(rootDir, "scripts/install-tests/candidate-overrides.ts"), ...f.archives],
			{
				cwd: f.root,
				env: {
					...f.env,
					XCSH_NATIVE_CANDIDATE_JSON: JSON.stringify({ name: "foreign-package", tarball: "foreign.tgz" }),
				},
				encoding: "utf8",
				timeout: 10_000,
			},
		);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Candidate native tarball inventory mismatch");
		expect(readFileSync(f.packagePath, "utf8")).toBe(f.initial);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

for (const count of [8, 10]) {
	test(`candidate helper rejects ${count} archives without writing`, () => {
		const f = fixture();
		try {
			const args = count === 8 ? f.archives.slice(0, -1) : [...f.archives, "extra.tgz"];
			const result = spawnSync(
				process.execPath,
				[join(rootDir, "scripts/install-tests/candidate-overrides.ts"), ...args],
				{ cwd: f.root, env: f.env, encoding: "utf8", timeout: 10_000 },
			);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("Candidate tarball inventory mismatch");
			expect(readFileSync(f.packagePath, "utf8")).toBe(f.initial);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	});
}
