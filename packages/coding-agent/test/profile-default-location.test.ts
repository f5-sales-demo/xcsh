import { afterEach, expect, test, vi } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { MachineProfileService } from "../src/person-profile/machine-profile";
import { emptyProfile } from "../src/person-profile/schema";
import { PersonProfileService } from "../src/person-profile/service";

const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(alias: boolean) {
	const root = await mkdtemp(join(os.tmpdir(), "profile-location-"));
	roots.push(root);
	const home = join(root, "home"),
		target = join(root, "private");
	await mkdir(home, { mode: 0o700 });
	await mkdir(target, { mode: 0o700 });
	const configured = join(home, ".xcsh");
	if (alias) await symlink(target, configured);
	else await mkdir(configured, { mode: 0o700 });
	const directory = alias ? target : configured;
	const person = JSON.stringify(emptyProfile());
	const computer = JSON.stringify({ schemaVersion: 1, revision: 0, state: "empty", facts: {} });
	await writeFile(join(directory, "user-profile.json"), person, { mode: 0o600 });
	await writeFile(join(directory, "computer-profile.json"), computer, { mode: 0o600 });
	vi.spyOn(os, "homedir").mockReturnValue(home);
	return { root, home, target, configured, directory, person, computer };
}
for (const domain of ["person", "computer"] as const) {
	test(`default ${domain} profile uses its canonical private relocation without rewriting data`, async () => {
		const run = await fixture(true);
		const service = domain === "person" ? new PersonProfileService() : new MachineProfileService();
		const filename = domain === "person" ? "user-profile.json" : "computer-profile.json";
		expect(service.path).toBe(join(run.target, filename));
		expect((await service.status()).status).toBe("ready");
		expect((await service.get()).state).toBe("empty");
		expect(await readFile(join(run.target, filename), "utf8")).toBe(domain === "person" ? run.person : run.computer);
	});
}
test("ordinary default roots retain their original location", async () => {
	const run = await fixture(false);
	const person = new PersonProfileService();
	const computer = new MachineProfileService();
	expect(person.path).toBe(join(run.configured, "user-profile.json"));
	expect(computer.path).toBe(join(run.configured, "computer-profile.json"));
	expect((await person.status()).status).toBe("ready");
	expect((await computer.status()).status).toBe("ready");
});
test("explicit caller-supplied profile symlink roots remain refused", async () => {
	const run = await fixture(true);
	const person = new PersonProfileService(join(run.configured, "user-profile.json"));
	const computer = new MachineProfileService(join(run.configured, "computer-profile.json"));
	expect((await person.status()).reason).toBe("invalid_shape");
	expect((await computer.status()).reason).toBe("invalid_shape");
});
test("a non-private relocated target remains refused without changing permissions", async () => {
	const run = await fixture(true);
	await chmod(run.target, 0o755);
	const person = new PersonProfileService();
	expect((await person.status()).status).toBe("invalid");
	const { stat } = await import("node:fs/promises");
	expect((await stat(run.target)).mode & 0o777).toBe(0o755);
});

test("missing default roots remain read-only and missing", async () => {
	const root = await mkdtemp(join(os.tmpdir(), "profile-location-missing-"));
	roots.push(root);
	vi.spyOn(os, "homedir").mockReturnValue(root);
	const service = new PersonProfileService();
	expect((await service.status()).status).toBe("missing");
	expect((await service.get()).state).toBe("empty");
	expect(await Bun.file(join(root, ".xcsh/user-profile.json")).exists()).toBe(false);
});
for (const kind of ["dangling", "cyclic", "file"] as const) {
	test(`untrusted default alias remains refused: ${kind}`, async () => {
		const run = await fixture(true);
		const { unlink } = await import("node:fs/promises");
		await unlink(run.configured);
		if (kind === "dangling") await symlink(join(run.root, "missing"), run.configured);
		else if (kind === "cyclic") await symlink(run.configured, run.configured);
		else await symlink(join(run.target, "user-profile.json"), run.configured);
		const service = new PersonProfileService();
		expect(service.path).toBe(join(run.configured, "user-profile.json"));
		expect((await service.status()).status).toBe("invalid");
		expect(await readFile(join(run.target, "user-profile.json"), "utf8")).toBe(run.person);
	});
}
test("a foreign-owned default alias is not admitted", async () => {
	const run = await fixture(true);
	const real = process.getuid?.();
	if (real === undefined) throw new Error("Owned Linux fixture required");
	const current = vi.spyOn(process, "getuid").mockReturnValue(real + 1);
	const service = new PersonProfileService();
	current.mockRestore();
	expect(service.path).toBe(join(run.configured, "user-profile.json"));
	expect((await service.status()).status).toBe("invalid");
});
test("a changed alias during canonical resolution is not admitted", async () => {
	const run = await fixture(true);
	const fs = await import("node:fs");
	const original = fs.realpathSync;
	const other = join(run.root, "other");
	await mkdir(other, { mode: 0o700 });
	let replaced = false;
	const spy = vi.spyOn(fs, "realpathSync").mockImplementation(((
		path: Parameters<typeof original>[0],
		options?: Parameters<typeof original>[1],
	) => {
		const result = original(path, options as never);
		if (!replaced && path === run.configured) {
			replaced = true;
			fs.unlinkSync(run.configured);
			fs.symlinkSync(other, run.configured);
		}
		return result;
	}) as typeof original);
	const service = new PersonProfileService();
	spy.mockRestore();
	expect(replaced).toBe(true);
	expect(service.path).toBe(join(run.configured, "user-profile.json"));
	expect((await service.status()).status).toBe("invalid");
	expect(await readFile(join(run.target, "user-profile.json"), "utf8")).toBe(run.person);
});
test("an admitted default location stays bound to its original target", async () => {
	const run = await fixture(true);
	const service = new PersonProfileService();
	const { unlink } = await import("node:fs/promises");
	const other = join(run.root, "other");
	await mkdir(other, { mode: 0o700 });
	await writeFile(join(other, "user-profile.json"), "foreign profile bytes", { mode: 0o600 });
	await unlink(run.configured);
	await symlink(other, run.configured);
	expect(service.path).toBe(join(run.target, "user-profile.json"));
	expect((await service.get()).state).toBe("empty");
	expect(await readFile(join(other, "user-profile.json"), "utf8")).toBe("foreign profile bytes");
});

test("an administrator-owned default alias admits only its private user-owned target", async () => {
	const run = await fixture(true);
	const fs = await import("node:fs");
	const original = fs.lstatSync;
	const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((
		path: Parameters<typeof original>[0],
		options?: Parameters<typeof original>[1],
	) => {
		const value = original(path, options as never);
		if (path !== run.configured) return value;
		return Object.assign(Object.create(Object.getPrototypeOf(value)), value, {
			uid: typeof value.uid === "bigint" ? 0n : 0,
		});
	}) as typeof original);
	const service = new PersonProfileService();
	spy.mockRestore();
	expect(service.path).toBe(join(run.target, "user-profile.json"));
	expect((await service.status()).status).toBe("ready");
	expect(await readFile(join(run.target, "user-profile.json"), "utf8")).toBe(run.person);
});
test("administrator ownership of the target cannot replace user ownership", async () => {
	const run = await fixture(true);
	const fs = await import("node:fs");
	const original = fs.lstatSync;
	const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((
		path: Parameters<typeof original>[0],
		options?: Parameters<typeof original>[1],
	) => {
		const value = original(path, options as never);
		if (path !== run.configured && path !== run.target) return value;
		return Object.assign(Object.create(Object.getPrototypeOf(value)), value, {
			uid: typeof value.uid === "bigint" ? 0n : 0,
		});
	}) as typeof original);
	const service = new PersonProfileService();
	spy.mockRestore();
	expect(service.path).toBe(join(run.configured, "user-profile.json"));
	expect((await service.status()).status).toBe("invalid");
});
