import { describe, expect, it } from "bun:test";
import { getChangedPathsFromPorcelain, isRustAffectingPath } from "../../../../scripts/run-rs-task";

/**
 * The local Rust gate decides whether to run from a list of changed paths (#2573).
 *
 * The defect it had was not in the matching but in *which* list it consulted: `git status --porcelain`
 * reports the working tree only, so committing Rust changes emptied the list and `check:rs` skipped
 * itself — exactly when someone is about to push. A real `cargo fmt` violation reached CI that way.
 * `hasRustAffectingChanges` now also diffs against the default branch.
 *
 * That plumbing needs git, so what is pinned here is the part that can be: the path predicate both lists
 * are filtered through, and the porcelain parser feeding it. Importing this module used to execute the
 * whole task and call `process.exit`, which is why none of it had a test; it is now behind
 * `import.meta.main`.
 */
describe("isRustAffectingPath", () => {
	it("matches Rust sources wherever they sit, including a committed crate path", () => {
		for (const changedPath of [
			"crates/containment-check/src/main.rs",
			"src/lib.rs",
			"crates/brush-core-vendored/src/sys/unix/landlock.rs",
		]) {
			expect(isRustAffectingPath(changedPath)).toBe(true);
		}
	});

	it("matches the build inputs that change how Rust compiles", () => {
		for (const changedPath of [
			"Cargo.toml",
			"Cargo.lock",
			"crates/pi-natives/build.rs",
			"rust-toolchain.toml",
			"rustfmt.toml",
			".clippy.toml",
			".cargo/config.toml",
		]) {
			expect(isRustAffectingPath(changedPath)).toBe(true);
		}
	});

	it("ignores paths that cannot affect a Rust build", () => {
		for (const changedPath of [
			"packages/coding-agent/src/sandbox/containment.ts",
			"biome.json",
			"README.md",
			"docs/rustfmt.toml.md",
			"notes.rs.txt",
		]) {
			expect(isRustAffectingPath(changedPath)).toBe(false);
		}
	});

	// Windows checkouts report backslashes; the predicate normalises before matching.
	it("normalises separators", () => {
		expect(isRustAffectingPath("crates\\containment-check\\src\\main.rs")).toBe(true);
		expect(isRustAffectingPath("crates\\foo\\Cargo.toml")).toBe(true);
	});
});

describe("getChangedPathsFromPorcelain", () => {
	const porcelain = (entries: string[]): Uint8Array => new TextEncoder().encode(`${entries.join("\0")}\0`);

	it("reads a NUL-separated status list", () => {
		const paths = getChangedPathsFromPorcelain(porcelain([" M src/lib.rs", "?? notes.md"]));
		expect(paths).toEqual(["src/lib.rs", "notes.md"]);
	});

	// A rename emits the destination and then the source as a separate entry. Both must be reported, or
	// renaming a .ts file over a .rs one could hide the Rust change.
	it("reports both sides of a rename", () => {
		const paths = getChangedPathsFromPorcelain(porcelain(["R  new/lib.rs", "old/lib.rs"]));
		expect(paths).toEqual(["new/lib.rs", "old/lib.rs"]);
	});

	it("is empty for a clean tree — which is the state that used to disable the gate", () => {
		expect(getChangedPathsFromPorcelain(new Uint8Array())).toEqual([]);
	});
});
