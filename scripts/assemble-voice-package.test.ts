import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import reference from "./voice-runtime-reference.json";

const source = "0123456789abcdef0123456789abcdef01234567";
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "voice-assembly-"));
	roots.push(root);
	const helper = join(root, "helper");
	await writeFile(helper, "#!/bin/sh\nprintf '%s\\n' '" + source + "'\n");
	await chmod(helper, 0o755);
	const runtime = join(root, "runtime");
	await mkdir(join(runtime, "lib"), { recursive: true });
	const bytes = Buffer.from("synthetic runtime");
	await writeFile(join(runtime, "lib/test.so"), bytes);
	const entry = { path: "lib/test.so", sha256: createHash("sha256").update(bytes).digest("hex") };
	await writeFile(
		join(runtime, "runtime.json"),
		JSON.stringify({ target: "x86_64-unknown-linux-gnu", sourceCommit: reference.reference, libraries: [entry] }),
	);
	return { root, helper, runtime, entry, output: join(root, "package") };
}
async function assemble(f: Awaited<ReturnType<typeof fixture>>) {
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(import.meta.dir, "assemble-voice-package.ts"),
			"--helper",
			f.helper,
			"--runtime",
			f.runtime,
			"--source",
			source,
			"--output",
			f.output,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exit] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exit, text: stdout + stderr };
}
test("assembly preserves any existing directory without a manifest", async () => {
	const f = await fixture();
	await mkdir(f.output);
	await writeFile(join(f.output, "unrelated"), "preserve");
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("Package output already exists");
	expect(await readFile(join(f.output, "unrelated"), "utf8")).toBe("preserve");
});
test("assembly refuses a dangling destination symlink", async () => {
	const f = await fixture();
	await symlink(join(f.root, "absent"), f.output);
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("Package output already exists");
});
test("assembly rejects a helper from another source revision", async () => {
	const f = await fixture();
	await writeFile(f.helper, "#!/bin/sh\nprintf wrong-build\n");
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("Helper build does not match");
	expect(await Bun.file(join(f.output, "xcsh-voice-package.json")).exists()).toBe(false);
});
test("assembly rejects changed runtime bytes before creating output", async () => {
	const f = await fixture();
	await writeFile(join(f.runtime, f.entry.path), "changed");
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("Runtime changed after qualification");
	expect(await Bun.file(join(f.output, "xcsh-voice-package.json")).exists()).toBe(false);
});
test("assembly rejects duplicate inventory paths", async () => {
	const f = await fixture();
	await writeFile(
		join(f.runtime, "runtime.json"),
		JSON.stringify({
			target: "x86_64-unknown-linux-gnu",
			sourceCommit: reference.reference,
			libraries: [f.entry, f.entry],
		}),
	);
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("Invalid or duplicate runtime path");
});
test("assembly requires redistribution notices before publishing a manifest", async () => {
	const f = await fixture();
	const result = await assemble(f);
	expect(result.exit).not.toBe(0);
	expect(result.text).toContain("NOTICE.md");
	expect(await Bun.file(join(f.output, "xcsh-voice-package.json")).exists()).toBe(false);
});

test("assembly accepts the pinned macOS plugins directory before requiring notices", async () => {
	const f = await fixture();
	const path = "plugins/libgstapp.dylib";
	await mkdir(join(f.runtime, "plugins"));
	await writeFile(join(f.runtime, path), "synthetic macOS plugin");
	const entry = { path, sha256: createHash("sha256").update("synthetic macOS plugin").digest("hex") };
	await writeFile(join(f.runtime, "runtime.json"), JSON.stringify({
		target: "aarch64-apple-darwin", sourceCommit: reference.reference, libraries: [entry],
	}));
	const result = await assemble(f);
	expect(result.text).not.toContain("Invalid or duplicate runtime path");
	expect(result.text).toContain("NOTICE.md");
	expect(await Bun.file(join(f.output, "xcsh-voice-package.json")).exists()).toBe(false);
});
