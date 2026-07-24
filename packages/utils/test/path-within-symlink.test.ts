import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathIsWithin, resolveEquivalentPath } from "../src/dirs";

/**
 * Regression: when the working directory is a symlink (e.g. macOS /tmp -> /private/tmp,
 * or a symlinked project dir), the sandbox boundary falsely rejected any target that
 * does not yet exist on disk. `pathIsWithin` canonicalized the boundary root (it exists)
 * but not a non-existent candidate, so the symlinked prefix diverged. See issue #2312.
 *
 * Self-contained: builds its own symlink so it reproduces on Linux CI, not just macOS.
 */
describe("pathIsWithin with a symlinked root and non-existent leaves (#2312)", () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		while (cleanups.length) cleanups.pop()?.();
	});

	function makeSymlinkedDir(): { real: string; link: string } {
		const base = fs.realpathSync(os.tmpdir());
		const real = fs.mkdtempSync(path.join(base, "sbx-real-"));
		const link = path.join(base, `sbx-link-${path.basename(real)}`);
		fs.symlinkSync(real, link);
		cleanups.push(() => {
			try {
				fs.unlinkSync(link);
			} catch {}
			try {
				fs.rmSync(real, { recursive: true, force: true });
			} catch {}
		});
		return { real, link };
	}

	it("treats a not-yet-existing file under the symlinked cwd as within the boundary", () => {
		const { link } = makeSymlinkedDir();
		expect(pathIsWithin(link, path.join(link, "new-file.md"))).toBe(true);
		expect(pathIsWithin(link, path.join(link, "sub", "deep", "missing.txt"))).toBe(true);
	});

	it("still rejects a sibling path outside the symlinked cwd (no over-broadening)", () => {
		const { link, real } = makeSymlinkedDir();
		expect(pathIsWithin(link, path.join(path.dirname(real), "other-cust", "secret.json"))).toBe(false);
	});

	it("resolveEquivalentPath canonicalizes the deepest existing ancestor of a missing path", () => {
		const { link, real } = makeSymlinkedDir();
		expect(resolveEquivalentPath(path.join(link, "missing.txt"))).toBe(
			path.join(fs.realpathSync(real), "missing.txt"),
		);
		expect(resolveEquivalentPath(path.join(link, "a", "b", "c.txt"))).toBe(
			path.join(fs.realpathSync(real), "a", "b", "c.txt"),
		);
	});
});
