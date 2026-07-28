import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildContainmentFence, containmentStatus, fenceVerdict } from "@f5-sales-demo/xcsh/sandbox/containment";

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
		// `cargo build` and `npm ci` fail — the exact breakage this fence must not cause. Narrowed to
		// the artifact subdirectories, because granting the parents exposed credentials.
		for (const cache of [".bun/install/cache", ".cargo/registry", ".npm/_cacache", ".m2/repository"]) {
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
		fs.mkdirSync(path.join(home, ".bun", "install"), { recursive: true });
		fs.symlinkSync(realCache, path.join(home, ".bun", "install", "cache"));

		const fence = buildContainmentFence({ workspace, home });
		expect(fence.allow).toContain(realCache);
		expect(fenceVerdict(fence, path.join(realCache, "pkg"), "write")).toBe("allow");
	});
});

/**
 * Findings from adversarial review of this fence, each verified allowed before the fix.
 *
 * They share a shape worth naming: the fence is permissive by default, so every gap is a path that
 * matched no rule rather than a rule that was wrong. Denying home was never the whole boundary.
 */
describe("buildContainmentFence — review findings", () => {
	it("denies the workspace's siblings even when the workspace is outside home", () => {
		// Verified allow/allow before the fix: with /work/customer-a as the workspace, /work/customer-b
		// matched nothing and was readable AND writable. A fleet keeping customer folders outside the
		// home tree got no containment at all.
		const base = realTmp("work");
		const a = path.join(base, "customer-a");
		const b = path.join(base, "customer-b");
		fs.mkdirSync(a);
		fs.mkdirSync(b);
		const fence = buildContainmentFence({ workspace: a, home: path.join(base, "unrelated-home") });

		expect(fenceVerdict(fence, path.join(b, "secret"), "read")).toBe("deny");
		expect(fenceVerdict(fence, path.join(b, "planted"), "write")).toBe("deny");
		expect(fenceVerdict(fence, path.join(a, "own.md"), "write")).toBe("allow");
	});

	it("never denies a parent too broad to deny", () => {
		// Denying the parent must not reach the filesystem root, a system directory, or the OS temp
		// dir — each would refuse work the fence is supposed to leave alone.
		const tmp = fs.realpathSync(os.tmpdir());
		const shallow = buildContainmentFence({ workspace: tmp, home: path.join(tmp, "no-such-home") });
		expect(fenceVerdict(shallow, path.join(tmp, "scratch"), "write")).toBe("allow");

		const system = buildContainmentFence({ workspace: "/usr/local", home: path.join(tmp, "no-such-home") });
		expect(fenceVerdict(system, "/usr/bin/env", "read")).toBe("allow");
		expect(fenceVerdict(system, "/etc/hosts", "read")).toBe("allow");
	});

	it("keeps toolchain credentials outside the cache carve-outs", () => {
		// Verified writable before the fix: granting ~/.cargo, ~/.m2, ~/.gradle and ~/.npm whole put
		// credentials.toml, settings.xml, init.gradle and _authToken inside the fence — credential
		// theft and persistent build-config tampering, not merely a read.
		const home = realTmp("credhome");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		for (const secret of [
			".cargo/credentials.toml",
			".cargo/config.toml",
			".m2/settings.xml",
			".gradle/init.gradle",
			".npm/_authToken",
		]) {
			expect(fenceVerdict(fence, path.join(home, secret), "write")).toBe("deny");
		}
		// The parts a build actually writes stay granted, or the carve-out was pointless.
		for (const artifact of [
			".cargo/registry/index/x",
			".m2/repository/org/x.jar",
			".npm/_cacache/index-v5/x",
			".bun/install/cache/pkg",
			".gradle/caches/modules-2/x",
		]) {
			expect(fenceVerdict(fence, path.join(home, artifact), "write")).toBe("allow");
		}
	});

	it("keeps a read-only grant read-only and a write-only grant write-only", () => {
		// Verified allow/allow before the fix: bash.ts merged sandbox.allowRead and sandbox.allowWrite
		// into one read+write list, so a folder shared for reading became writable — undoing the
		// read/write split built for #2516.
		const home = realTmp("splithome");
		const workspace = path.join(home, "w");
		const shared = realTmp("shared-ro");
		const drop = realTmp("drop-wo");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, readOnlyRoots: [shared], writeOnlyRoots: [drop] });

		expect(fenceVerdict(fence, path.join(shared, "ctx.md"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(shared, "ctx.md"), "write")).toBe("deny");
		expect(fenceVerdict(fence, path.join(drop, "out.log"), "write")).toBe("allow");
		expect(fenceVerdict(fence, path.join(drop, "out.log"), "read")).toBe("deny");
	});
});

/**
 * What gets reported has to be what is actually enforcing.
 *
 * The backend cannot be inferred from `process.platform`: Landlock can be compiled out of the kernel,
 * left out of its boot-time LSM list, or too old to allow cross-directory rename. Each of those looks
 * identical from TypeScript, and each changes what the boundary is worth — so the answer comes from a
 * probe, and these tests pin what happens for every answer it can give.
 */
describe("containmentStatus", () => {
	const landlock = () => ({ backend: "landlock" });
	const scannerOnly = () => ({ backend: "scanner-only" });
	const unavailable = () => undefined;

	it("reports seatbelt on macOS without consulting the probe at all", () => {
		let probed = false;
		const status = containmentStatus(true, "darwin", () => {
			probed = true;
			return scannerOnly();
		});
		expect(status).toEqual({ enabled: true, backend: "seatbelt", osEnforced: true });
		expect(probed).toBe(false);
	});

	it("reports landlock as OS-enforced when the kernel provides it", () => {
		expect(containmentStatus(true, "linux", landlock)).toEqual({
			enabled: true,
			backend: "landlock",
			osEnforced: true,
		});
	});

	// The case that must not over-claim: a Linux box where Landlock is absent or too old.
	it("reports scanner-only on Linux when the kernel does not provide Landlock", () => {
		expect(containmentStatus(true, "linux", scannerOnly)).toEqual({
			enabled: true,
			backend: "scanner-only",
			osEnforced: false,
		});
	});

	it("falls back to scanner-only when the probe cannot answer", () => {
		// A native module from an older release has no such export. Understating the boundary is the
		// safe direction to be wrong in; claiming enforcement that is not there is not.
		expect(containmentStatus(true, "linux", unavailable)).toEqual({
			enabled: true,
			backend: "scanner-only",
			osEnforced: false,
		});
	});

	it("survives a probe that throws rather than taking down xcsh://about", () => {
		const status = containmentStatus(true, "linux", () => {
			throw new TypeError("containmentBackend is not a function");
		});
		expect(status.osEnforced).toBe(false);
		expect(status.backend).toBe("scanner-only");
	});

	it("says disabled before asking anything, when isolation is off", () => {
		let probed = false;
		const status = containmentStatus(false, "linux", () => {
			probed = true;
			return landlock();
		});
		expect(status).toEqual({ enabled: false, backend: "disabled", osEnforced: false });
		expect(probed).toBe(false);
	});

	it("reports scanner-only on Windows", () => {
		expect(containmentStatus(true, "win32", scannerOnly).osEnforced).toBe(false);
	});
});
