import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { installArchive, safeArchivePath } from "../src/host/archive";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(
	entries: { name: string; body?: string; type?: "symlink"; linkname?: string }[] = [
		{ name: "sf/bin/sf", body: "#!/bin/sh\necho sf 2.151.7\n" },
	],
) {
	const archive = pack();
	const parts: Uint8Array[] = [];
	const output = (async () => {
		for await (const part of archive) parts.push(part);
	})();
	for (const entry of entries)
		archive.entry(
			{ name: entry.name, mode: 0o755, type: entry.type ?? "file", linkname: entry.linkname },
			entry.body ?? "",
		);
	archive.finalize();
	await output;
	const bytes = gzipSync(Buffer.concat(parts));
	const root = await mkdtemp(join(tmpdir(), "xcsh-archive-test-"));
	roots.push(root);
	return {
		bytes,
		root,
		plan: {
			version: "2.151.7",
			url: "https://example.com/archive.tar.gz",
			sha256: createHash("sha256").update(bytes).digest("hex"),
			destination: join(root, "software", "2.151.7"),
			link: join(root, "bin", "sf"),
			baseDir: "sf",
			executable: "bin/sf",
			versionArgs: ["--version"],
		},
	};
}
describe("shared archive installation", () => {
	it("rejects traversal, absolute and Windows paths", () => {
		for (const path of ["../escape", "/escape", "sf/../../escape", "C:/escape", "sf\\escape"])
			expect(() => safeArchivePath(path)).toThrow("Unsafe");
	});
	it("verifies and promotes a staged executable and leaves no staging", async () => {
		const { bytes, plan, root } = await fixture();
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
		const oldPath = process.env.PATH;
		try {
			await installArchive(plan);
			expect(await readlink(plan.link)).toBe(join(plan.destination, "sf", "bin", "sf"));
			expect(await readdir(join(root, "software"))).toEqual(["2.151.7"]);
			const child = Bun.spawn([plan.link, "--version"], { stdout: "pipe" });
			expect(await new Response(child.stdout).text()).toContain("2.151.7");
			expect(await child.exited).toBe(0);
		} finally {
			fetcher.mockRestore();
			process.env.PATH = oldPath;
		}
	});
	it("rejects checksum mismatch and cleans staging", async () => {
		const { bytes, plan, root } = await fixture();
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
		try {
			await expect(installArchive({ ...plan, sha256: "0".repeat(64) })).rejects.toThrow("checksum");
			expect(await readdir(join(root, "software"))).toEqual([]);
		} finally {
			fetcher.mockRestore();
		}
	});
	it("rejects escaping archive entries and links", async () => {
		for (const entries of [
			[{ name: "sf/../../escape", body: "bad" }],
			[{ name: "sf/link", type: "symlink" as const, linkname: "../../escape" }],
			[{ name: "other/file", body: "bad" }],
		]) {
			const { bytes, plan, root } = await fixture(entries);
			const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
			try {
				await expect(installArchive(plan)).rejects.toThrow("Unsafe");
				expect(await readdir(join(root, "software"))).toEqual([]);
			} finally {
				fetcher.mockRestore();
			}
		}
	});
	it("does not replace an unrelated link path and rolls back its promotion", async () => {
		const { bytes, plan, root } = await fixture();
		await writeFile(join(root, "occupied"), "keep");
		const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
		try {
			await expect(installArchive({ ...plan, link: join(root, "occupied") })).rejects.toThrow();
			expect(await Bun.file(join(root, "occupied")).text()).toBe("keep");
			expect(await readdir(join(root, "software"))).toEqual([]);
		} finally {
			fetcher.mockRestore();
		}
	});
	it("cancels before downloading or touching disk", async () => {
		const { plan, root } = await fixture();
		const fetcher = spyOn(globalThis, "fetch");
		try {
			await expect(installArchive(plan, AbortSignal.abort())).rejects.toThrow();
			expect(fetcher).not.toHaveBeenCalled();
			expect(await readdir(root)).toEqual([]);
		} finally {
			fetcher.mockRestore();
		}
	});
	it("cancels in-flight download and removes staging", async () => {
		const { plan, root } = await fixture();
		const controller = new AbortController();
		const replacement = Object.assign(
			async (_url: string | Request | URL, options?: RequestInit): Promise<Response> =>
				new Promise<Response>((_resolve, reject) => {
					options!.signal!.addEventListener("abort", () => reject(new Error("aborted")));
					controller.abort();
				}),
			{ preconnect: fetch.preconnect },
		);
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(replacement);
		try {
			await expect(installArchive(plan, controller.signal)).rejects.toThrow("cancelled");
			expect(await readdir(join(root, "software"))).toEqual([]);
		} finally {
			fetcher.mockRestore();
		}
	});
	it("times out a stalled download and cleans task-owned staging", async () => {
		const { plan, root } = await fixture();
		const replacement = Object.assign(
			async (_url: string | Request | URL, options?: RequestInit): Promise<Response> =>
				new Promise<Response>((_resolve, reject) => {
					options!.signal!.addEventListener("abort", () => reject(new Error("timed out")));
				}),
			{ preconnect: fetch.preconnect },
		);
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(replacement);
		try {
			await expect(installArchive(plan, undefined, 25)).rejects.toThrow("timed out");
			expect(await readdir(join(root, "software"))).toEqual([]);
		} finally {
			fetcher.mockRestore();
		}
	});
});
