/**
 * Unit tests for the Office task-pane static asset server.
 *
 * The request-handling is factored into a PURE `handleAssetRequest(pathname, dir)`
 * (mirroring stats' `handleStatic`) so it is exercised against a temp asset dir
 * with no TLS socket. Covers content-types, the `/` → taskpane.html default, the
 * 404 for unknown paths, and the `sanitizeArchivePath` path-traversal guard.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAssetRequest, sanitizeArchivePath } from "../../src/browser/office-pane-server";

let dir: string;

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "office-pane-test-"));
	await mkdir(join(dir, "assets"), { recursive: true });
	await writeFile(join(dir, "taskpane.html"), "<!DOCTYPE html><title>pane</title>");
	await writeFile(join(dir, "taskpane.js"), "console.log('pane');");
	await writeFile(join(dir, "manifest.json"), JSON.stringify({ id: "test" }));
	// 1x1 PNG.
	await writeFile(
		join(dir, "assets", "icon-16.png"),
		Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex"),
	);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("handleAssetRequest", () => {
	it("serves taskpane.html for / with text/html content-type", async () => {
		const res = await handleAssetRequest("/", dir);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("text/html");
		expect(await res.text()).toContain("<title>pane</title>");
	});

	it("serves /taskpane.html", async () => {
		const res = await handleAssetRequest("/taskpane.html", dir);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("text/html");
	});

	it("serves the JS bundle with a javascript content-type", async () => {
		const res = await handleAssetRequest("/taskpane.js", dir);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("javascript");
	});

	it("serves /manifest.json with an application/json content-type", async () => {
		const res = await handleAssetRequest("/manifest.json", dir);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("application/json");
	});

	it("serves an icon under /assets/ with image/png", async () => {
		const res = await handleAssetRequest("/assets/icon-16.png", dir);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toContain("image/png");
	});

	it("returns 404 for an unknown path", async () => {
		const res = await handleAssetRequest("/nope.html", dir);
		expect(res.status).toBe(404);
	});

	it("returns 404 for a path-traversal attempt (never escapes the dir)", async () => {
		const res = await handleAssetRequest("/../../etc/passwd", dir);
		expect(res.status).toBe(404);
	});
});

describe("sanitizeArchivePath", () => {
	it("accepts normal relative paths", () => {
		expect(sanitizeArchivePath("taskpane.html")).toBe("taskpane.html");
		expect(sanitizeArchivePath("assets/icon-16.png")).toBe("assets/icon-16.png");
		expect(sanitizeArchivePath("./manifest.json")).toBe("manifest.json");
	});

	it("rejects parent-traversal and absolute paths", () => {
		expect(sanitizeArchivePath("../secret")).toBeNull();
		expect(sanitizeArchivePath("a/../../b")).toBeNull();
		expect(sanitizeArchivePath("/etc/passwd")).toBeNull();
		expect(sanitizeArchivePath("")).toBeNull();
		expect(sanitizeArchivePath(".")).toBeNull();
	});
});
