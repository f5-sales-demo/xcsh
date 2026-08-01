import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fencePermits } from "@f5-sales-demo/pi-natives";
import { buildContainmentFence, type FenceAccess, fenceVerdict } from "../src/sandbox/containment";

/**
 * One rule set, two implementations: `fenceVerdict` in TypeScript decides at the text layer, and
 * `ContainmentFence::permits` in Rust decides where the shell actually opens the file. They are free
 * to drift, and a drift is a silent hole — the pre-check would allow what the enforcement refuses, or
 * worse, the reverse.
 *
 * The Rust crate cannot host its own unit tests: `crates/brush-core-vendored` is `exclude`d from the
 * workspace and reached through `[patch.crates-io]`, so `cargo test -p brush-core` refuses to run.
 * This is where that implementation is actually covered, which is why the corpus is broad rather
 * than illustrative.
 */
describe("containment fence: TypeScript and Rust agree", () => {
	const fsRoot = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "xcsh-conf-root-")));
	const accountRoot = path.join(fsRoot, "Users");
	const home = path.join(accountRoot, "operator");
	const otherHome = path.join(accountRoot, "other-account");
	const workspace = path.join(home, "GIT", "custA");
	const sibling = path.join(home, "GIT", "custB");
	const leak = path.join(home, ".xcsh", "agent", "sessions");
	const shared = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "xcsh-conf-shared-")));

	// Removed after the file runs; both fixtures above leaked into the OS temp dir (#2633).
	afterAll(() => {
		for (const dir of [fsRoot, shared]) fs.rmSync(dir, { recursive: true, force: true });
	});
	for (const dir of [workspace, sibling, otherHome, leak, path.join(home, ".ssh"), path.join(home, ".bun")]) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(path.join(home, ".gitconfig"), "[user]\n");

	const fence = buildContainmentFence({ workspace, home, fsRoot, extraRoots: [shared], leakRoots: [leak] });
	const wire = {
		allow: [...fence.allow],
		allowReadOnly: [...fence.allowReadOnly],
		allowWriteOnly: [...fence.allowWriteOnly],
		deny: [...fence.deny],
		denyEnumerate: [...fence.denyEnumerate],
	};

	const corpus: string[] = [
		// inside the workspace
		path.join(workspace, "notes.md"),
		path.join(workspace, "deep", "not", "created", "yet.txt"),
		workspace,
		// the fenced home
		path.join(home, ".ssh", "id_rsa"),
		path.join(sibling, "secret.env"),
		path.join(home, "Documents", "tax.pdf"),
		home,
		// another local account and its container
		path.join(otherHome, "workspace", "notes.md"),
		otherHome,
		accountRoot,
		// carve-outs
		path.join(home, ".bun", "install", "cache", "pkg"),
		path.join(home, ".cargo", "registry", "x"), // absent on purpose
		path.join(home, ".gitconfig"),
		// nested deny under an allowed root
		path.join(leak, "other-session.jsonl"),
		// explicit grant
		path.join(shared, "handoff.md"),
		// outside the fence entirely
		"/usr/bin/env",
		"/etc/hosts",
		"/dev/null",
		path.join(fs.realpathSync(os.tmpdir()), "scratch"),
		"/opt/homebrew/bin/bun",
	];

	it("returns the same verdict for every path, in both directions", () => {
		const disagreements: string[] = [];
		for (const candidate of corpus) {
			for (const access of ["read", "write", "enumerate"] as FenceAccess[]) {
				const ts = fenceVerdict(fence, candidate, access) === "allow";
				const rust = fencePermits(wire, candidate, access === "write", access === "enumerate");
				if (ts !== rust) disagreements.push(`${access} ${candidate}: ts=${ts} rust=${rust}`);
			}
		}
		expect(disagreements).toEqual([]);
	});

	// Both must resolve the symlink, or the pre-check and the enforcement disagree about the one
	// case an attacker would reach for.
	it("agrees when the path arrives through a symlink", () => {
		// Points at the cross-session leak root. Named sibling paths are deliberately reachable now; the
		// courtesy prevents discovering them by enumerating the shared parent.
		const pivot = path.join(workspace, "pivot");
		fs.symlinkSync(leak, pivot);
		const viaLink = path.join(pivot, "secrets.tf");

		expect(fenceVerdict(fence, viaLink, "read")).toBe("deny");
		expect(fencePermits(wire, viaLink, false, false)).toBe(false);
	});

	it("agrees that only the shared parent loses enumeration", () => {
		const parent = path.dirname(workspace);
		expect(fenceVerdict(fence, parent, "enumerate")).toBe("deny");
		expect(fencePermits(wire, parent, false, true)).toBe(false);
		expect(fenceVerdict(fence, sibling, "read")).toBe("allow");
		expect(fencePermits(wire, sibling, false, false)).toBe(true);
	});

	it("agrees that the operator's home is allowed inside a denied account container", () => {
		expect(fenceVerdict(fence, accountRoot, "enumerate")).toBe("deny");
		expect(fencePermits(wire, accountRoot, false, true)).toBe(false);
		expect(fenceVerdict(fence, path.join(otherHome, "workspace"), "read")).toBe("deny");
		expect(fencePermits(wire, path.join(otherHome, "workspace"), false, false)).toBe(false);
		expect(fenceVerdict(fence, path.join(home, ".zshrc"), "write")).toBe("allow");
		expect(fencePermits(wire, path.join(home, ".zshrc"), true, false)).toBe(true);
	});

	it("agrees that an absent fence restricts nothing", () => {
		const empty = { allow: [], allowReadOnly: [], allowWriteOnly: [], deny: [], denyEnumerate: [] };
		for (const candidate of corpus) {
			expect(fencePermits(empty, candidate, true)).toBe(true);
		}
	});
});
