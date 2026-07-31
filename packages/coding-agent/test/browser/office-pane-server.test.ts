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
import {
	handleAssetRequest,
	isCompletePane,
	manifestAssetPaths,
	missingPaneFiles,
	paneSourceForLayout,
	paneUnavailableMessage,
	resolvePaneDir,
	sanitizeArchivePath,
	startOfficePaneServer,
} from "../../src/browser/office-pane-server";

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

/**
 * Refusing honestly when there is no pane to serve.
 *
 * The published npm form of xcsh carries the `office` command and neither of the pane's two supply
 * routes: `office-pane.generated.txt` is a 0-byte placeholder, and the tarball has no `packages/`
 * directory, so the dev path `packages/office-pane/dist` cannot resolve. `IS_BUN_COMPILED` is false
 * there, so the dev branch is taken — and that branch used to return a path it never checked.
 *
 * Measured against a real install of 19.103.3: `office manifest` threw an uncaught ENOENT naming an
 * internal path, and `office serve` bound :8444 and answered 404 to every request, including
 * /taskpane.html, so Excel showed "Not Found" while the command looked like it had worked. Serving
 * nothing quietly is the failure worth preventing; a stack trace is merely rude.
 */
describe("refusing when no pane bundle is available", () => {
	it("accepts a directory that really holds a built pane", async () => {
		expect(await resolvePaneDir(dir, "dev")).toBe(dir);
	});

	// The build writes taskpane.html, THEN taskpane.js, manifest.json, icons and fonts (build.ts:180
	// onwards). A single marker therefore accepts an interrupted build: the page is there, the manifest
	// is not, and `office manifest` / `office sideload` fail with the same ENOENT this change exists to
	// remove. The check has to cover what the commands actually consume.
	it("refuses a half-built dist that has the page but not the manifest", async () => {
		const half = mkdtempSync(join(tmpdir(), "office-pane-half-"));
		try {
			await writeFile(join(half, "taskpane.html"), "<!DOCTYPE html>");
			await writeFile(join(half, "taskpane.js"), "console.log(1);");
			await expect(resolvePaneDir(half, "dev")).rejects.toThrow(/manifest\.json/);
		} finally {
			rmSync(half, { recursive: true, force: true });
		}
	});

	it("refuses a dist whose page has no bundle beside it", async () => {
		const noBundle = mkdtempSync(join(tmpdir(), "office-pane-nojs-"));
		try {
			await writeFile(join(noBundle, "taskpane.html"), "<!DOCTYPE html>");
			await writeFile(join(noBundle, "manifest.json"), "{}");
			await expect(resolvePaneDir(noBundle, "dev")).rejects.toThrow(/taskpane\.js/);
		} finally {
			rmSync(noBundle, { recursive: true, force: true });
		}
	});

	/**
	 * The icons are not cosmetic, which is what an earlier version of this guard assumed.
	 *
	 * `office sideload` shells out to office-addin-debugging, whose zip step fails outright on a
	 * missing `assets/color.png` — the comment in runSideload records exactly that. And the build
	 * copies `assets/` AFTER manifest.json, so an interruption between the two leaves every other
	 * required file in place. Worse, runSideload removes the existing WEF manifest links first, so the
	 * failure lands after the working registration has already been deleted.
	 *
	 * The required assets are read out of the manifest rather than listed here, so adding an icon to
	 * the manifest cannot leave this check behind.
	 */
	it("refuses a dist whose manifest references icons that were never copied", async () => {
		const noIcons = mkdtempSync(join(tmpdir(), "office-pane-noicons-"));
		try {
			await writeFile(join(noIcons, "taskpane.html"), "<!DOCTYPE html>");
			await writeFile(join(noIcons, "taskpane.js"), "console.log(1);");
			await writeFile(
				join(noIcons, "manifest.json"),
				JSON.stringify({ icons: ["assets/color.png", "assets/outline.png"] }),
			);
			await expect(resolvePaneDir(noIcons, "dev")).rejects.toThrow(/assets\/color\.png/);
		} finally {
			rmSync(noIcons, { recursive: true, force: true });
		}
	});

	it("accepts a dist whose manifest references only assets that are present", async () => {
		const complete = mkdtempSync(join(tmpdir(), "office-pane-complete-"));
		try {
			await mkdir(join(complete, "assets"), { recursive: true });
			await writeFile(join(complete, "taskpane.html"), "<!DOCTYPE html>");
			await writeFile(join(complete, "taskpane.js"), "console.log(1);");
			await writeFile(join(complete, "assets", "color.png"), "png");
			await writeFile(join(complete, "manifest.json"), JSON.stringify({ icons: ["assets/color.png"] }));
			expect(await resolvePaneDir(complete, "dev")).toBe(complete);
		} finally {
			rmSync(complete, { recursive: true, force: true });
		}
	});

	/**
	 * The predicate the compiled cache reuses. Its old form was `taskpane.html` alone, so an extraction
	 * interrupted after the page but before its bundle produced a hash-addressed directory that every
	 * later run accepted — serving a pane whose JS 404s until somebody deleted a temp directory they had
	 * no reason to suspect. A compiled run cannot be exercised from here, but this is what it consults.
	 */
	it("does not call a half-extracted bundle complete", async () => {
		const partial = mkdtempSync(join(tmpdir(), "office-pane-partial-"));
		try {
			await writeFile(join(partial, "taskpane.html"), "<!DOCTYPE html>");
			expect(await isCompletePane(partial)).toBe(false);
			expect(await missingPaneFiles(partial)).toContain("taskpane.js");
		} finally {
			rmSync(partial, { recursive: true, force: true });
		}
	});

	it("calls the real built pane complete", async () => {
		// `dir` is the fully-populated fixture this file builds in beforeAll.
		expect(await isCompletePane(dir)).toBe(true);
		expect(await missingPaneFiles(dir)).toEqual([]);
	});

	it("reads both manifest URL forms as the same dist-relative asset", () => {
		const paths = manifestAssetPaths(
			JSON.stringify({ a: "assets/color.png", b: "https://127-0-0-1.local-ip.sh:8444/assets/icon-16.png" }),
		);
		expect(paths).toEqual(["assets/color.png", "assets/icon-16.png"]);
	});

	it("refuses a directory with no taskpane.html, naming it", async () => {
		const empty = mkdtempSync(join(tmpdir(), "office-pane-empty-"));
		try {
			await expect(resolvePaneDir(empty, "dev")).rejects.toThrow(
				new RegExp(empty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	// The two audiences need different remedies, so the message may not be generic. Getting this
	// backwards is worse than saying nothing: telling a developer to install a binary hides that they
	// simply have not built yet, and telling an npm user to run a build names a directory they do not
	// have.
	it("tells a packaged install the pane ships in the compiled binary", () => {
		const said = paneUnavailableMessage("/somewhere/office-pane/dist", "packaged");
		expect(said).toMatch(/brew install f5-sales-demo\/tap\/xcsh/);
		expect(said).not.toMatch(/bun run build/);
	});

	it("tells a dev checkout to build the pane, not to install a binary", () => {
		const said = paneUnavailableMessage("/repo/packages/office-pane/dist", "dev");
		expect(said).toMatch(/bun run build/);
		expect(said).toMatch(/packages\/office-pane/);
		expect(said).not.toMatch(/brew install/);
	});

	it("says which supply route was missing rather than only that something was", () => {
		expect(paneUnavailableMessage("/x/dist", "compiled")).toMatch(/embedded|baked|binary/i);
	});

	// The pairing, not the ternary: an inverted discriminator would hand each audience the other's
	// remedy, which is the one way this can be worse than the ENOENT it replaced.
	it("pairs a present office-pane package with the build advice, and its absence with the binary", () => {
		expect(paneUnavailableMessage("/d", paneSourceForLayout(true))).toMatch(/bun run build/);
		expect(paneUnavailableMessage("/d", paneSourceForLayout(true))).not.toMatch(/brew/);
		expect(paneUnavailableMessage("/d", paneSourceForLayout(false))).toMatch(/brew install/);
		expect(paneUnavailableMessage("/d", paneSourceForLayout(false))).not.toMatch(/bun run build/);
	});

	/**
	 * The acceptance criterion that matters operationally: a pane server that cannot serve must not
	 * hold the port. Binding first and 404ing is what made this invisible — Office connects, renders
	 * "Not Found", and nothing in the log disagrees.
	 *
	 * A free high port is used, never the real 8444, so this cannot disturb a pane server someone is
	 * actually running. It never reaches TLS either: the refusal happens before `resolveBridgeTls`,
	 * which is what keeps this test hermetic and offline.
	 */
	it("does not bind a port when there is nothing to serve", async () => {
		const port = 41_899;
		await expect(startOfficePaneServer(port, "/definitely/not/a/pane/dir")).rejects.toThrow();
		// If the failed start had bound the port, this would throw EADDRINUSE.
		const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("ok") });
		expect(probe.port).toBe(port);
		probe.stop(true);
	});
});
