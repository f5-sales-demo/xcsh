import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewProfileLockRecovery } from "../src/person-profile/lock-recovery";
import { MachineProfileService } from "../src/person-profile/machine-profile";
import { PersonProfileService } from "../src/person-profile/service";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function run(home: string, ...args: string[]) {
	const child = Bun.spawn([process.execPath, new URL("../src/cli.ts", import.meta.url).pathname, "profile", ...args], {
		env: { ...process.env, HOME: home, XCSH_PROFILE_DISCOVERY: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
}
async function fixture(domain: "person" | "computer" = "person") {
	const home = await mkdtemp(join(tmpdir(), "profile-lock-cli-"));
	roots.push(home);
	const root = join(home, ".xcsh");
	await mkdir(root, { mode: 0o700 });
	const path = join(root, domain === "person" ? "user-profile.json" : "computer-profile.json");
	const service =
		domain === "person" ? new PersonProfileService(path, 25) : new MachineProfileService(path, undefined, 25);
	await writeFile(path, JSON.stringify(await service.get()), { mode: 0o600 });
	await writeFile(join(root, "settings.json"), '{"syntheticSetting":"preserved"}', { mode: 0o600 });
	const startup = await run(home, "status", "--json");
	expect(startup.code).toBe(0);
	const module = new URL(
		domain === "person" ? "../src/person-profile/service.ts" : "../src/person-profile/machine-profile.ts",
		import.meta.url,
	).href;
	const script =
		'const module = await import(process.env.PROFILE_TEST_MODULE); const service = process.env.PROFILE_TEST_DOMAIN === "person" ? new module.PersonProfileService(process.env.PROFILE_TEST_PATH, 25) : new module.MachineProfileService(process.env.PROFILE_TEST_PATH, undefined, 25); await service.acquireResetLease(); process.exit(0);';
	const child = Bun.spawn([process.execPath, "-e", script], {
		env: { ...process.env, PROFILE_TEST_MODULE: module, PROFILE_TEST_PATH: path, PROFILE_TEST_DOMAIN: domain },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect({ code: await child.exited, stderr: await new Response(child.stderr).text() }).toEqual({
		code: 0,
		stderr: "",
	});
	const review = await reviewProfileLockRecovery(path, domain);
	const reviewFile = join(home, "review.json");
	await writeFile(reviewFile, JSON.stringify(review), { mode: 0o600 });
	return {
		home,
		root,
		path,
		domain,
		review,
		reviewFile,
		owner: await readFile(join(`${path}.lock`, "owner.json"), "utf8"),
		profile: await readFile(path, "utf8"),
		settings: await readFile(join(root, "settings.json"), "utf8"),
	};
}
for (const domain of ["person", "computer"] as const) {
	test.skipIf(process.platform !== "linux")(
		`Supported ${domain} CLI reviews, retains and inspects original recovery without replay`,
		async () => {
			const f = await fixture(domain);
			const reviewed = await run(f.home, "lock-review", domain, "--json");
			expect(reviewed.code).toBe(0);
			const review = JSON.parse(reviewed.stdout);
			expect(review).toMatchObject({
				path: f.path,
				domain,
				closure: { kind: "pid-absent" },
				binding: JSON.parse(f.owner).recoveryBinding,
			});
			await writeFile(f.reviewFile, reviewed.stdout);
			const recovered = await run(
				f.home,
				"lock-recover",
				domain,
				"--review-file",
				f.reviewFile,
				"--approve-sha256",
				review.sha256,
				"--json",
			);
			expect(recovered.code).toBe(0);
			const result = JSON.parse(recovered.stdout);
			expect(result.status).toBe("retained");
			expect(await readFile(join(result.retainedDirectoryPath, "owner.json"), "utf8")).toBe(f.owner);
			const inspected = await run(f.home, "lock-status", domain, "--review-sha256", review.sha256, "--json");
			expect(inspected.code).toBe(0);
			expect(JSON.parse(inspected.stdout)).toMatchObject({
				status: "captured",
				activeLock: "absent",
				intentUsed: true,
				completionConfirmed: false,
			});
			const names = (await readdir(f.root)).sort();
			expect(
				(
					await run(
						f.home,
						"lock-recover",
						domain,
						"--review-file",
						f.reviewFile,
						"--approve-sha256",
						review.sha256,
						"--json",
					)
				).code,
			).not.toBe(0);
			expect((await readdir(f.root)).sort()).toEqual(names);
			expect(await readFile(f.path, "utf8")).toBe(f.profile);
			expect(await readFile(join(f.root, "settings.json"), "utf8")).toBe(f.settings);
		},
	);
}
test.skipIf(process.platform !== "linux")("CLI wrong approval digest refuses before creating any intent", async () => {
	const f = await fixture();
	const names = (await readdir(f.root)).sort();
	const result = await run(
		f.home,
		"lock-recover",
		"person",
		"--review-file",
		f.reviewFile,
		"--approve-sha256",
		"0".repeat(64),
		"--json",
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("review_authorization_mismatch");
	expect((await readdir(f.root)).sort()).toEqual(names);
});
test.skipIf(process.platform !== "linux")("CLI insecure reviewed file cannot authorize recovery", async () => {
	const f = await fixture();
	await chmod(f.reviewFile, 0o644);
	const result = await run(
		f.home,
		"lock-recover",
		"person",
		"--review-file",
		f.reviewFile,
		"--approve-sha256",
		f.review.sha256,
		"--json",
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("invalid_private_review_file");
	expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(f.owner);
});
test.skipIf(process.platform !== "linux")(
	"CLI expired approval refuses without changing original storage",
	async () => {
		const f = await fixture();
		const review = { ...f.review, observedAt: "2000-01-01T00:00:00.000Z" };
		const body = Object.fromEntries(Object.entries(review).filter(([key]) => key !== "sha256"));
		review.sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
		await writeFile(f.reviewFile, JSON.stringify(review));
		const result = await run(
			f.home,
			"lock-recover",
			"person",
			"--review-file",
			f.reviewFile,
			"--approve-sha256",
			review.sha256,
			"--json",
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("review_expired_or_future");
		expect(await readFile(f.path, "utf8")).toBe(f.profile);
	},
);
test.skipIf(process.platform !== "linux")(
	"CLI recovery requires one exact target and refuses --yes shortcuts",
	async () => {
		const f = await fixture();
		const all = await run(f.home, "lock-review", "all", "--json");
		expect(all.code).not.toBe(0);
		expect(all.stderr).toContain("requires a single person or computer target");
		const shortcut = await run(f.home, "lock-recover", "person", "--yes");
		expect(shortcut.code).not.toBe(0);
		expect(shortcut.stderr).toContain("does not accept --yes");
		expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(f.owner);
	},
);

for (const failure of ["symlink", "hardlink", "malformed"] as const) {
	test.skipIf(process.platform !== "linux")(
		`CLI ${failure} review input refuses without leaking private content`,
		async () => {
			const f = await fixture();
			if (failure === "symlink") {
				const original = join(f.home, "original-review.json");
				await rename(f.reviewFile, original);
				await symlink(original, f.reviewFile);
			}
			if (failure === "hardlink") await link(f.reviewFile, join(f.home, "second-review.json"));
			if (failure === "malformed") await writeFile(f.reviewFile, '{"privateMarker":"synthetic-review-marker"');
			const names = (await readdir(f.root)).sort();
			const result = await run(
				f.home,
				"lock-recover",
				"person",
				"--review-file",
				f.reviewFile,
				"--approve-sha256",
				f.review.sha256,
				"--json",
			);
			expect(result.code).not.toBe(0);
			expect(result.stderr).toContain("invalid_private_review_file");
			expect(result.stderr).not.toContain("synthetic-review-marker");
			expect((await readdir(f.root)).sort()).toEqual(names);
			expect(await readFile(f.path, "utf8")).toBe(f.profile);
		},
	);
}
test.skipIf(process.platform !== "linux")("CLI review cannot authorize another profile domain", async () => {
	const f = await fixture();
	const result = await run(
		f.home,
		"lock-recover",
		"computer",
		"--review-file",
		f.reviewFile,
		"--approve-sha256",
		f.review.sha256,
		"--json",
	);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("review_authorization_mismatch");
	expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(f.owner);
});
test.skipIf(process.platform !== "linux")("Existing status and reset reject lock action flags", async () => {
	const f = await fixture();
	for (const args of [
		["status", "--approve-sha256", f.review.sha256],
		["reset", "person", "--yes", "--review-sha256", f.review.sha256],
	]) {
		const result = await run(f.home, ...args);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("does not accept lock recovery flags");
	}
	expect(await readFile(f.path, "utf8")).toBe(f.profile);
});
test.skipIf(process.platform !== "linux")(
	"CLI explicitly refuses unqualified previous-boot capture before retaining intent",
	async () => {
		const f = await fixture();
		const review = { ...f.review, closure: { ...f.review.closure, kind: "previous-boot" as const } };
		const body = Object.fromEntries(Object.entries(review).filter(([key]) => key !== "sha256"));
		review.sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");
		await writeFile(f.reviewFile, JSON.stringify(review));
		const names = (await readdir(f.root)).sort();
		const result = await run(
			f.home,
			"lock-recover",
			"person",
			"--review-file",
			f.reviewFile,
			"--approve-sha256",
			review.sha256,
			"--json",
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("previous_boot_capture_mapping_unqualified");
		expect((await readdir(f.root)).sort()).toEqual(names);
		expect(await readFile(join(`${f.path}.lock`, "owner.json"), "utf8")).toBe(f.owner);
	},
);
