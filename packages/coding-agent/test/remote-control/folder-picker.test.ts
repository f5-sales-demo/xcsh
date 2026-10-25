import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { RemoteRouter } from "../../src/remote-control/router";
import createSchema from "./fixtures/FsCreateDirectoryResponse.json";
import metadataSchema from "./fixtures/FsGetMetadataResponse.json";
import directorySchema from "./fixtures/FsReadDirectoryResponse.json";

async function setup() {
	const root = await mkdtemp(join(tmpdir(), "xcsh-folder-picker-"));
	const router = new RemoteRouter(root, "22.4.2");
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
	});
	let id = 1;
	return {
		root,
		router,
		call: (method: string, params: Record<string, unknown>) =>
			router.handle("phone", { id: ++id, method, params }) as Promise<any>,
	};
}
function matches(schema: object, value: unknown) {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int64", "uint64"]) ajv.addFormat(name, { type: "number", validate: Number.isSafeInteger });
	const validate = ajv.compile(schema);
	expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}

test("phone folder picker loads metadata and direct child entries without an active session", async () => {
	const { root, router, call } = await setup();
	try {
		await mkdir(join(root, "project"));
		await writeFile(join(root, "note.txt"), "synthetic");
		await symlink(join(root, "project"), join(root, "project-link"));
		await symlink(join(root, "note.txt"), join(root, "file-link"));
		await symlink(join(root, "missing"), join(root, "broken-link"));
		const response = await call("fs/getMetadata", { path: root });
		matches(metadataSchema, response.result);
		expect(response.result).toMatchObject({ isDirectory: true, isFile: false, isSymlink: false });
		expect(response.result.createdAtMs).toBeGreaterThanOrEqual(0);
		expect(response.result.modifiedAtMs).toBeGreaterThan(0);
		const link = await call("fs/getMetadata", { path: join(root, "project-link") });
		matches(metadataSchema, link.result);
		expect(link.result).toMatchObject({ isDirectory: true, isFile: false, isSymlink: true });
		const file = await call("fs/getMetadata", { path: join(root, "note.txt") });
		matches(metadataSchema, file.result);
		expect(file.result).toMatchObject({ isDirectory: false, isFile: true, isSymlink: false });
		const listing = await call("fs/readDirectory", { path: root });
		matches(directorySchema, listing.result);
		expect(listing.result.entries).toEqual(
			expect.arrayContaining([
				{ fileName: "project", isDirectory: true, isFile: false },
				{ fileName: "note.txt", isDirectory: false, isFile: true },
				{ fileName: "project-link", isDirectory: true, isFile: false },
				{ fileName: "file-link", isDirectory: false, isFile: true },
				{ fileName: "broken-link", isDirectory: false, isFile: false },
			]),
		);
		expect(listing.result.entries).toHaveLength(5);
		expect(await call("fs/getMetadata", { path: join(root, "missing") })).toMatchObject({ error: { code: -32603 } });
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("phone Add new folder creates a directory using pinned recursive defaults", async () => {
	const { root, router, call } = await setup();
	try {
		const path = join(root, "parent", "new-project");
		for (const recursive of [undefined, null, true]) {
			const created = await call("fs/createDirectory", { path, ...(recursive === undefined ? {} : { recursive }) });
			expect(created).toHaveProperty("result");
			matches(createSchema, created.result);
			expect(created.result).toEqual({});
		}
		expect((await stat(path)).isDirectory()).toBe(true);
		expect((await call("fs/readDirectory", { path: join(root, "parent") })).result.entries).toEqual([
			{ fileName: "new-project", isDirectory: true, isFile: false },
		]);
		expect(await call("fs/createDirectory", { path: join(root, "absent", "child"), recursive: false })).toMatchObject(
			{ error: { code: -32603 } },
		);
		const single = await call("fs/createDirectory", { path: join(root, "single"), recursive: false });
		expect(single.result).toEqual({});
		expect(await call("fs/createDirectory", { path: join(root, "single"), recursive: false })).toMatchObject({
			error: { code: -32603 },
		});
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("folder picker rejects invalid paths and flags and reports IO errors without widening skill reads", async () => {
	const { root, router, call } = await setup();
	try {
		for (const method of ["fs/getMetadata", "fs/readDirectory", "fs/createDirectory"]) {
			for (const path of [undefined, 12, "relative", "/tmp/../tmp", "/tmp/\u0000folder"]) {
				expect(await call(method, { path })).toMatchObject({ error: { code: -32602 } });
			}
		}
		expect(await call("fs/createDirectory", { path: join(root, "invalid"), recursive: "true" })).toMatchObject({
			error: { code: -32602 },
		});
		await writeFile(join(root, "file"), "synthetic");
		expect(await call("fs/readDirectory", { path: join(root, "file") })).toMatchObject({ error: { code: -32603 } });
		expect(await call("fs/readDirectory", { path: join(root, "missing") })).toMatchObject({
			error: { code: -32603 },
		});
		expect(await call("fs/readFile", { path: join(root, "file") })).toMatchObject({ error: { code: -32602 } });
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
