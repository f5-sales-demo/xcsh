import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContainmentFence, fenceVerdict } from "@f5-sales-demo/xcsh/sandbox/containment";

/**
 * The fence is deliberately *gentle*: the only thing it prevents is the assistant wandering the
 * filesystem. Operations are not restricted, so `/usr`, `/tmp`, package caches, the network and
 * process execution are never mentioned. Anything that breaks ordinary work is a bug in the fence,
 * not a stricter policy — see #2554.
 */

function realTmp(suffix: string): string {
	const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `fence-${suffix}-`));
	return fs.realpathSync(dir);
}

describe("buildContainmentFence", () => {
	it("denies the home tree and re-allows the workspace inside it", () => {
		const home = realTmp("home");
		const workspace = path.join(home, "GIT", "custA");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		expect(fence.deny).toContain(home);
		expect(fence.allow).toContain(workspace);
		// A sibling checkout under the same home is the cross-customer case this exists for.
		expect(fenceVerdict(fence, path.join(home, "GIT", "custB", "secret"), "read")).toBe("deny");
		expect(fenceVerdict(fence, path.join(workspace, "notes.md"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(workspace, "notes.md"), "write")).toBe("allow");
	});

	it("leaves everything outside home alone — nothing operational is restricted", () => {
		const home = realTmp("home2");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		for (const p of ["/usr/bin/env", "/bin/sh", "/etc/hosts", "/opt/homebrew/bin/bun", "/dev/null"]) {
			expect(fenceVerdict(fence, p, "read")).toBe("allow");
		}
		// The OS temp dir is not customer data and must stay usable for both directions.
		expect(fenceVerdict(fence, path.join(fs.realpathSync(os.tmpdir()), "scratch"), "write")).toBe("allow");
	});

	it("re-allows package caches so toolchains keep working", () => {
		const home = realTmp("home3");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		// These sit inside the denied home tree and must be carved back out, or `bun install`,
		// `cargo build` and `npm ci` fail — the exact breakage this fence must not cause.
		for (const cache of [".bun", ".cargo", ".npm"]) {
			expect(fenceVerdict(fence, path.join(home, cache, "x"), "write")).toBe("allow");
		}
	});

	it("keeps git config readable but not writable", () => {
		const home = realTmp("home4");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		expect(fenceVerdict(fence, path.join(home, ".gitconfig"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(home, ".gitconfig"), "write")).toBe("deny");
	});

	it("denies credentials even though they sit in the same home", () => {
		const home = realTmp("home5");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		for (const secret of [".ssh/id_rsa", ".aws/credentials", ".gnupg/secring.gpg", "Documents/tax.pdf"]) {
			expect(fenceVerdict(fence, path.join(home, secret), "read")).toBe("deny");
		}
	});

	it("denies the cross-session leak roots even nested under an allowed root", () => {
		const home = realTmp("home6");
		// The pathological case: the workspace IS the agent dir's parent, so the leak roots sit
		// inside something the fence allows. Deny must win regardless of nesting depth.
		const workspace = path.join(home, ".xcsh");
		const sessions = path.join(workspace, "agent", "sessions");
		fs.mkdirSync(sessions, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, leakRoots: [sessions] });

		expect(fenceVerdict(fence, path.join(workspace, "config.yml"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(sessions, "other.jsonl"), "read")).toBe("deny");
		expect(fenceVerdict(fence, path.join(sessions, "other.jsonl"), "write")).toBe("deny");
	});

	it("grants extra roots from --allow-path for both directions", () => {
		const home = realTmp("home7");
		const workspace = path.join(home, "w");
		const shared = realTmp("shared");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, extraRoots: [shared] });

		expect(fenceVerdict(fence, path.join(shared, "f"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(shared, "f"), "write")).toBe("allow");
	});

	// A seatbelt `(subpath …)` rule on a non-canonical path silently matches nothing — a rule that
	// appears to enforce and does not. Verified: `/tmp/x` grants nothing because the real path is
	// `/private/tmp/x`. So canonicalisation is a correctness requirement, not tidiness.
	it("canonicalises every root", () => {
		const home = realTmp("home8");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const link = path.join(home, "link-to-w");
		fs.symlinkSync(workspace, link);
		const fence = buildContainmentFence({ workspace: link, home });

		expect(fence.allow).toContain(workspace);
		expect(fence.allow).not.toContain(link);
		for (const root of [...fence.allow, ...fence.allowReadOnly, ...fence.deny]) {
			expect(path.isAbsolute(root)).toBe(true);
			// A root that exists must already be its own real path. One that does not yet exist (an
			// absent cache dir) has nothing to resolve, and is emitted so it can be created later.
			if (fs.existsSync(root)) expect(root).toBe(fs.realpathSync(root));
		}
	});

	it("refuses to build a fence whose workspace cannot be canonicalised", () => {
		const home = realTmp("home9");
		expect(() => buildContainmentFence({ workspace: path.join(home, "does-not-exist"), home })).toThrow(
			/canonicalise/i,
		);
	});

	// A cache dir must be grantable BEFORE it exists, or the very first `bun install` — which
	// creates ~/.bun — fails inside the fence. Absent optional roots are granted, not dropped.
	it("grants a cache dir that does not exist yet", () => {
		const home = realTmp("home10");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		expect(fs.existsSync(path.join(home, ".bun"))).toBe(false);

		const fence = buildContainmentFence({ workspace, home });
		expect(fenceVerdict(fence, path.join(home, ".bun", "install", "cache", "x"), "write")).toBe("allow");
	});

	// An absent root must never be emitted non-canonically for a path that DOES exist, because a
	// non-canonical rule silently grants nothing. Existing roots are still resolved.
	it("canonicalises the roots that exist", () => {
		const home = realTmp("home11");
		const workspace = path.join(home, "w");
		const realCache = realTmp("cache");
		fs.mkdirSync(workspace, { recursive: true });
		fs.symlinkSync(realCache, path.join(home, ".bun"));

		const fence = buildContainmentFence({ workspace, home });
		expect(fence.allow).toContain(realCache);
		expect(fenceVerdict(fence, path.join(realCache, "pkg"), "write")).toBe("allow");
	});
});
