import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import type { FileExecutionChange } from "../../src/tools/execution-metadata";
import { captureFileExecution, recordFileMutation, recordFileRename } from "../../src/tools/file-mutations";

const directories: string[] = [];
afterEach(async () => {
	for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-file-facts-"));
	directories.push(dir);
	return dir;
}
const done = () => ({ content: [{ type: "text" as const, text: "Done" }], details: { display: "unchanged" } });

test("captures net file contents, preserving BOM and line endings across multiple writes", async () => {
	const path = join(await fixture(), "file.txt");
	await writeFile(path, "\ufeffbefore\r\n");
	const result = await captureFileExecution(async () => {
		await recordFileMutation(path, () => writeFile(path, "intermediate\n"));
		await recordFileMutation(path, () => writeFile(path, "\ufeffafter\r\n"));
		return done();
	});
	expect(result.details).toEqual({
		display: "unchanged",
		execution: {
			kind: "fileChange",
			status: "completed",
			changes: [
				{ path, type: "update", unifiedDiff: "@@ -1 +1 @@\n-\ufeffbefore\r\n+\ufeffafter\r\n", movePath: null },
			],
		},
	});
});

test("records actual creation, deletion and rename without inventing unchanged writes", async () => {
	const dir = await fixture();
	const added = join(dir, "added");
	const deleted = join(dir, "deleted");
	const moved = join(dir, "moved");
	const destination = join(dir, "destination");
	await writeFile(deleted, "deleted");
	await writeFile(moved, "moved\n");
	const result = await captureFileExecution(async () => {
		await recordFileMutation(added, () => writeFile(added, "added"));
		await recordFileMutation(deleted, () => unlink(deleted));
		await recordFileRename(moved, destination, () => rename(moved, destination));
		await recordFileMutation(destination, () => writeFile(destination, "moved\n"));
		return done();
	});
	expect(result.details?.execution.changes).toEqual([
		{ path: added, type: "add", content: "added" },
		{ path: deleted, type: "delete", content: "deleted" },
		{ path: moved, type: "update", unifiedDiff: "", movePath: destination },
	]);
});

test("failed mutations retain actual partial effects and preserve the original error as cause", async () => {
	const path = join(await fixture(), "partial");
	const failure = new Error("fixture write failed");
	let caught: unknown;
	try {
		await captureFileExecution(async () => {
			await recordFileMutation(path, async () => {
				await writeFile(path, "partial");
				throw failure;
			});
			return done();
		});
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(AgentToolError);
	expect((caught as Error).cause).toBe(failure);
	expect((caught as AgentToolError).result.details).toEqual({
		execution: { kind: "fileChange", status: "failed", changes: [{ path, type: "add", content: "partial" }] },
	});
});

test("concurrent capture scopes do not exchange execution facts", async () => {
	const dir = await fixture();
	const barrier = Promise.withResolvers<void>();
	const run = (name: string) =>
		captureFileExecution(async () => {
			const path = join(dir, name);
			await recordFileMutation(path, async () => {
				if (name === "first") await barrier.promise;
				else barrier.resolve();
				await writeFile(path, name);
			});
			return done();
		});
	const results = await Promise.all([run("first"), run("second")]);
	for (const [index, name] of ["first", "second"].entries()) {
		expect(results[index].details?.execution.changes).toEqual([
			{ path: join(dir, name), type: "add", content: name },
		]);
		expect(await readFile(join(dir, name), "utf8")).toBe(name);
	}
});

test("metadata capture does not read a FIFO before allowing the requested operation", async () => {
	if (process.platform === "win32") return;
	const path = join(await fixture(), "pipe");
	const setup = Bun.spawnSync(["mkfifo", path]);
	expect(setup.exitCode).toBe(0);
	let entered = false;
	const running = captureFileExecution(async () => {
		await recordFileMutation(path, async () => {
			entered = true;
			await unlink(path);
			await writeFile(path, "replacement");
		});
		return done();
	});
	await Bun.sleep(25);
	const enteredWithoutRead = entered;
	// Release the old implementation's FIFO read so the failing test cleans up normally.
	if (!entered) await writeFile(path, "release");
	await running;
	expect(enteredWithoutRead).toBe(true);
});

test.each(["return", "recreate-middle", "recreate-source", "overwrite-target"] as const)(
	"rename sequences retain net contents: %s",
	async scenario => {
		const dir = await fixture();
		const a = join(dir, "a");
		const b = join(dir, "b");
		const c = join(dir, "c");
		await writeFile(a, "original\n");
		if (scenario === "overwrite-target") await writeFile(c, "other\n");
		const result = await captureFileExecution(async () => {
			await recordFileRename(a, b, () => rename(a, b));
			if (scenario === "return") await recordFileRename(b, a, () => rename(b, a));
			if (scenario === "recreate-middle") {
				await recordFileRename(b, c, () => rename(b, c));
				await recordFileMutation(b, () => writeFile(b, "new\n"));
			}
			if (scenario === "recreate-source") await recordFileMutation(a, () => writeFile(a, "new\n"));
			if (scenario === "overwrite-target") await recordFileRename(c, b, () => rename(c, b));
			return done();
		});
		const expected: FileExecutionChange[] =
			scenario === "return"
				? []
				: scenario === "recreate-middle"
					? [
							{ path: a, type: "update", unifiedDiff: "", movePath: c },
							{ path: b, type: "add", content: "new\n" },
						]
					: scenario === "recreate-source"
						? [
								{ path: a, type: "update", unifiedDiff: "@@ -1 +1 @@\n-original\n+new\n", movePath: null },
								{ path: b, type: "add", content: "original\n" },
							]
						: [
								{ path: a, type: "delete", content: "original\n" },
								{ path: c, type: "update", unifiedDiff: "", movePath: b },
							];
		expect(result.details?.execution.changes).toEqual(expected);
	},
);
