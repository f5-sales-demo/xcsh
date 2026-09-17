import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))));

async function run(home: string, ...args: string[]) {
	const child = Bun.spawn([process.execPath, new URL("../src/cli.ts", import.meta.url).pathname, "profile", ...args], {
		env: { ...process.env, HOME: home, XCSH_PROFILE_DISCOVERY: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: await child.exited,
		stdout: await new Response(child.stdout).text(),
		stderr: await new Response(child.stderr).text(),
	};
}

test("profile status is value-free and reset removes only the selected exact target", async () => {
	const home = await mkdtemp(join(tmpdir(), "profile-cli-"));
	dirs.push(home);
	const dir = join(home, ".xcsh");
	const person = join(dir, "user-profile.json");
	const unrelated = join(dir, "unrelated.json");
	await mkdir(dir, { mode: 0o700 });
	await writeFile(person, JSON.stringify({ givenName: "Synthetic" }), { mode: 0o600 });
	await writeFile(unrelated, "{}", { mode: 0o600 });
	await chmod(person, 0o644);

	const status = await run(home, "status", "--json");
	expect(status.exitCode).toBe(0);
	expect(status.stdout).not.toContain("Synthetic");
	expect(JSON.parse(status.stdout)).toMatchObject({
		person: { status: "invalid", reason: "insecure_permissions" },
		computer: { status: "missing" },
	});

	const reset = await run(home, "reset", "person", "--yes");
	expect(reset.exitCode).toBe(0);
	const remaining = await readdir(dir);
	expect(remaining).toContain("unrelated.json");
	expect(remaining.some(name => name.startsWith("user-profile.json"))).toBe(false);
	expect((await run(home, "reset", "person", "--yes")).exitCode).toBe(0);
});
test("profile reset all removes both exact targets without retaining artifacts", async () => {
	const home = await mkdtemp(join(tmpdir(), "profile-cli-"));
	dirs.push(home);
	const dir = join(home, ".xcsh");
	const person = join(dir, "user-profile.json");
	const computer = join(dir, "computer-profile.json");
	const unrelated = join(dir, "unrelated.json");
	await mkdir(dir, { mode: 0o700 });
	await Promise.all([
		writeFile(person, "{}", { mode: 0o600 }),
		writeFile(computer, "{}", { mode: 0o600 }),
		writeFile(unrelated, "{}", { mode: 0o600 }),
	]);

	expect((await run(home, "reset", "all", "--yes")).exitCode).toBe(0);
	const remaining = await readdir(dir);
	expect(remaining).toContain("unrelated.json");
	expect(remaining.some(name => name.startsWith("user-profile.json"))).toBe(false);
	expect(remaining.some(name => name.startsWith("computer-profile.json"))).toBe(false);
});

test("non-interactive reset requires --yes", async () => {
	const home = await mkdtemp(join(tmpdir(), "profile-cli-"));
	dirs.push(home);
	const result = await run(home, "reset", "all");
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toContain("requires --yes");
});
