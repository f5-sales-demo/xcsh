import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, getPluginsDir } from "@f5-sales-demo/pi-utils";
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

		// `.aws/credentials` was on this list until #2581. It is now granted, deliberately: it is the
		// credential store of a CLI xcsh drives, and a path-based fence cannot let `aws` read it without
		// letting `cat` read it. What stays here is what no shipped tool needs — SSH and GPG private
		// keys, and the operator's documents.
		for (const secret of [".ssh/id_rsa", ".gnupg/secring.gpg", "Documents/tax.pdf"]) {
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

	// #2581: the home deny left every CLI xcsh ships a plugin for unable to read its own configuration.
	// Measured on v19.100.0: `gh` exited 1, `glab` 2, `az` 1 with a Python traceback, `aws` 255 blaming a
	// missing profile, `gcloud` 1, and `sf` exited **0** while crashing — a failure no script can detect.
	it("grants each shipped CLI its own config and state directory", () => {
		const home = realTmp("clihome");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		// Read AND write: these CLIs persist refreshed tokens, logs and profiles as part of ordinary
		// use. `gh auth login`, `az login`, `aws sso login` and `sf org login` all write here.
		for (const config of [
			".config/gh/hosts.yml", // the token gh authenticates with
			".sf/sf-2026-07-28.log",
			".sfdx/alias.json",
			".azure/azureProfile.json",
			".aws/credentials",
			".config/gcloud/access_tokens.db",
			".docker/contexts/meta/x",
			".kube/cache/discovery/x",
			".terraform.d/credentials.tfrc.json",
		]) {
			expect(fenceVerdict(fence, path.join(home, config), "read")).toBe("allow");
			expect(fenceVerdict(fence, path.join(home, config), "write")).toBe("allow");
		}

		// Readable, but see the command-bearing test below: these are deliberately not writable when the
		// backend can express that.
		for (const readOnly of [".aws/config", ".kube/config", "Library/Application Support/glab-cli/aliases.yml"]) {
			expect(fenceVerdict(fence, path.join(home, readOnly), "read")).toBe("allow");
		}
	});

	// The grant above must not become a way to run code later. Writing `~/.aws/config` installs a
	// `credential_process` that the operator's next — unfenced — `aws` call executes, with access to
	// everything the fence protects. That is an escape, not a leak, so every command-bearing path stays
	// read-only: the CLI still reads it, nothing stops working, only rewriting is refused.
	it("never grants write to configuration that names a command or holds an executable", () => {
		const home = realTmp("execconf");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, narrowsWithinGrant: true });

		for (const bearing of [
			".aws/config", // credential_process = <command>
			".kube/config", // users[].user.exec.command
			".docker/config.json", // credsStore / credHelpers
			".docker/cli-plugins/docker-evil", // plugin executable
			".azure/cliextensions/evil/__init__.py", // az extension, executed as Python
			".terraform.d/plugins/evil", // provider binary
			".config/gcloud/virtenv/bin/activate", // sourced by the gcloud launcher
			".config/gh/config.yml", // gh alias set x '!sh -c …'
			".config/glab-cli/aliases.yml", // glab keeps aliases in their own file
			"Library/Application Support/glab-cli/aliases.yml",
			".aws/cli/alias", // an aws alias starting with `!` runs through a shell
		]) {
			expect(fenceVerdict(fence, path.join(home, bearing), "write")).toBe("deny");
			// Read must survive, or the CLI cannot authenticate and #2581 is back.
			expect(fenceVerdict(fence, path.join(home, bearing), "read")).toBe("allow");
		}

		// The state each CLI genuinely writes stays writable, or `az` exits 1 and `sf` hangs — measured.
		for (const state of [".azure/commands/x.log", ".sf/sf-2026-07-28.log", ".aws/sso/cache/x.json"]) {
			expect(fenceVerdict(fence, path.join(home, state), "write")).toBe("allow");
		}
	});

	// A read-only descendant must land in the same namespace as the grant it narrows. `canonical`
	// returns undefined for a path that does not exist yet, and falling back to the literal string is
	// unsafe: with ~/.aws symlinked (chezmoi, stow and yadm all do this) the grant resolves to the link
	// target while the read-only rule keeps the link path, so the kernel matches only the grant and the
	// `credential_process` protection evaporates. Verified allow/allow before the fix.
	it("protects command-bearing config even when its directory is a symlink", () => {
		const home = realTmp("symconf");
		const workspace = path.join(home, "w");
		const vault = realTmp("vault");
		fs.mkdirSync(workspace, { recursive: true });
		// ~/.aws -> <vault>, and no config file exists inside it yet.
		fs.symlinkSync(vault, path.join(home, ".aws"));
		expect(fs.existsSync(path.join(vault, "config"))).toBe(false);

		const fence = buildContainmentFence({ workspace, home, narrowsWithinGrant: true });

		// Assert the emitted ROOT, not the verdict. `fenceVerdict` normalises symlinks via
		// `pathIsWithin`, so it answered "deny" even while the profile handed to sandbox-exec carried the
		// unresolved spelling and the write went through. Verified: with the literal rule,
		// `printf 'credential_process = …' > <vault>/config` succeeded under the real seatbelt profile.
		// Only the emitted string tells the truth here, because that is what the backend compiles.
		expect(fence.allowReadOnly).toContain(path.join(vault, "config"));
		expect(fence.allowReadOnly).not.toContain(path.join(home, ".aws", "config"));
		expect(fence.allow).toContain(vault);

		// …while the rest of the tree stays writable, or `aws sso login` breaks.
		expect(fenceVerdict(fence, path.join(vault, "sso", "cache", "x.json"), "write")).toBe("allow");
	});

	// AWS CLI reads ~/.aws/cli/alias, where an alias starting with `!` runs through a shell and can
	// shadow a normal top-level command. Missed on the first pass because ~/.aws was granted wholesale.
	it("refuses writes to the aws alias file, which executes through a shell", () => {
		const home = realTmp("aliashome");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, narrowsWithinGrant: true });

		expect(fenceVerdict(fence, path.join(home, ".aws", "cli", "alias"), "write")).toBe("deny");
		expect(fenceVerdict(fence, path.join(home, ".aws", "cli", "alias"), "read")).toBe("allow");
		// The cache beside it is what `aws sso login` and assume-role write, so it stays writable.
		expect(fenceVerdict(fence, path.join(home, ".aws", "cli", "cache", "x.json"), "write")).toBe("allow");
	});

	// Landlock cannot narrow a right inside a grant: its rules are allow-only and recursive, so holding
	// a file read-only inside a writable directory turns the parent into a split dir that loses write on
	// its own inode. Verified with `containment-check plan` — adding ~/.azure/cliextensions as read-only
	// made ~/.azure itself `r-`, which stops `az` writing azureProfile.json at all. So on that backend the
	// narrowing is skipped and the gap is reported, rather than breaking the CLIs #2581 is about.
	it("skips the command-bearing narrowing on a backend that cannot express it", () => {
		const home = realTmp("nonarrow");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, narrowsWithinGrant: false });

		// Writable, because the alternative is a directory the CLI cannot write to at all.
		for (const bearing of [".aws/config", ".kube/config", ".azure/config"]) {
			expect(fenceVerdict(fence, path.join(home, bearing), "write")).toBe("allow");
		}
		// ~/.gitconfig is NOT part of this: it is read-only via its own root, not a narrowing inside a
		// grant, so it must survive on every backend.
		expect(fenceVerdict(fence, path.join(home, ".gitconfig"), "write")).toBe("deny");
		expect(fenceVerdict(fence, path.join(home, ".gitconfig"), "read")).toBe("allow");
		// And the boundary itself is unchanged.
		expect(fenceVerdict(fence, path.join(home, ".ssh", "id_rsa"), "read")).toBe("deny");
	});

	// Defaulting to the portable policy matters: a caller that does not know its backend must not get
	// rules that break every CLI on Linux.
	it("defaults to the portable policy when the caller does not say", () => {
		const home = realTmp("defaultnarrow");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		expect(fenceVerdict(fence, path.join(home, ".aws", "config"), "write")).toBe("allow");
	});

	// Same defect as the CACHE_DIRS carve-out, missed for Go: `go` is in the tool list xcsh probes for,
	// and its module cache lives at ~/go/pkg/mod, so `go build` failed inside the fence.
	it("grants the Go module cache so `go build` works", () => {
		const home = realTmp("gohome");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		expect(fenceVerdict(fence, path.join(home, "go/pkg/mod/cache/download/x"), "write")).toBe("allow");
		// Not the whole of ~/go — that holds checked-out source and built binaries, and granting it
		// would put `go install` output inside the fence.
		expect(fenceVerdict(fence, path.join(home, "go/src/private/x"), "read")).toBe("deny");
	});

	// The grants above must not have widened anything else. This is the property that makes the fence
	// worth having at all, so it is asserted beside the change that could break it.
	it("still isolates customer workspaces and private keys after the CLI grants", () => {
		const home = realTmp("stillhome");
		const workspace = path.join(home, "GIT", "custA");
		const sessions = path.join(home, ".xcsh", "agent", "sessions");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(sessions, { recursive: true });
		const fence = buildContainmentFence({ workspace, home, leakRoots: [sessions] });

		for (const denied of [
			"GIT/custB/secrets.tf", // the sibling checkout this fence exists for
			".ssh/id_ed25519",
			".gnupg/secring.gpg",
			"Documents/contract.pdf",
			".xcsh/agent/sessions/other.jsonl", // another session's transcript
		]) {
			expect(fenceVerdict(fence, path.join(home, denied), "read")).toBe("deny");
			expect(fenceVerdict(fence, path.join(home, denied), "write")).toBe("deny");
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
			// No Landlock ABI can narrow a right inside a grant, so the command-bearing CLI settings are
			// writable there and the model is told so. Seatbelt reports no such field.
			commandConfigWritable: true,
		});
	});

	it("does not claim command-bearing config is writable under seatbelt", () => {
		expect(containmentStatus(true, "darwin")).not.toHaveProperty("commandConfigWritable");
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

	/**
	 * The failure mode that actually happened, which the throwing case does not cover.
	 *
	 * A native module built before this export existed simply does not have the symbol. The first version
	 * of this code reached it through a static named import, which fails at *link* time — the tarball
	 * install smoke test died with `SyntaxError: Export named 'containmentBackend' not found` before any
	 * runtime guard could run. Reaching it as a namespace member turns that into `undefined`, which is a
	 * case code can handle, and this is the shape that has to keep working.
	 */
	it("treats a native module with no such export as simply having no backend", () => {
		const olderNative = {} as { containmentBackend?: () => { backend: string } };
		const status = containmentStatus(true, "linux", () => olderNative.containmentBackend?.());
		expect(status).toEqual({ enabled: true, backend: "scanner-only", osEnforced: false });
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

/**
 * The parent deny was one level deep, and that is not where tenants necessarily sit.
 *
 * `buildContainmentFence` denied home and the workspace's *immediate* parent. With a layout of
 * `<container>/<tenant>/repo` the immediate parent is the tenant, so every OTHER tenant matched no rule
 * and the fence allowed it — read and write. That went unnoticed because the command-text scan is
 * deny-by-default and refused those paths on the way in, so the composite looked correct while the fence
 * alone was not. Removing that scan for OS-confined shells (#2582) is what exposed it.
 *
 * Found by adversarial review of #2582, reproduced here before fixing: `<container>/globex/repo/secrets.tf`
 * was `read=allow write=allow`.
 */
describe("buildContainmentFence — isolation does not depend on how deep the workspace sits", () => {
	it("denies a cousin tenant, not just an immediate sibling", () => {
		const home = realTmp("cousinhome");
		const container = realTmp("tenants");
		const workspace = path.join(container, "acme", "repo");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(path.join(container, "globex", "repo"), { recursive: true });
		const fence = buildContainmentFence({ workspace, home });

		// The case that exists for this fence, one level deeper than the original rule reached.
		for (const access of ["read", "write"] as const) {
			expect(fenceVerdict(fence, path.join(container, "globex", "repo", "secrets.tf"), access)).toBe("deny");
			expect(fenceVerdict(fence, path.join(container, "acme", "other-repo", "x"), access)).toBe("deny");
			expect(fenceVerdict(fence, path.join(container, "loose-file.txt"), access)).toBe("deny");
		}
		// …and the workspace itself still works, or the fence is useless.
		expect(fenceVerdict(fence, path.join(workspace, "notes.md"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(workspace, "notes.md"), "write")).toBe("allow");
	});

	it("still refuses to deny a root too broad to deny", () => {
		const home = realTmp("broadhome");
		// Directly under the OS temp dir: walking up must stop rather than deny $TMPDIR or /.
		const workspace = path.join(fs.realpathSync(os.tmpdir()), `fence-broad-${process.pid}`);
		fs.mkdirSync(workspace, { recursive: true });
		try {
			const fence = buildContainmentFence({ workspace, home });
			for (const root of fence.deny) {
				expect(root).not.toBe("/");
				expect(root).not.toBe(fs.realpathSync(os.tmpdir()));
			}
			// Operational paths stay reachable however far up the walk went.
			for (const p of ["/usr/bin/env", "/etc/hosts", "/bin/sh"]) {
				expect(fenceVerdict(fence, p, "read")).toBe("allow");
			}
		} finally {
			fs.rmSync(workspace, { recursive: true, force: true });
		}
	});
});

// Review of the ancestor walk: with the workspace under /tmp, canonicalisation gives /private/tmp/…,
// and `tooBroadToDeny` named `/private` and `os.tmpdir()` but not the resolved `/tmp` — so the walk
// denied /private/tmp and took every other temp path with it, against the guarantee in xcsh://about.
describe("buildContainmentFence — the ancestor walk never denies a temp root", () => {
	it("leaves /tmp usable when the workspace itself lives under it", () => {
		const home = realTmp("tmphome");
		const container = `/tmp/fence-tmp-probe-${process.pid}`;
		const workspace = path.join(container, "repo");
		fs.mkdirSync(workspace, { recursive: true });
		try {
			// Resolved, never hardcoded: `/tmp` really is `/private/tmp` on macOS and really is `/tmp` on
			// Linux, and the fence works in resolved paths. Writing the macOS spelling in made this pass
			// locally and fail on the Linux runner, where it asserted against a path that exists nowhere.
			const realTmpRoot = fs.realpathSync("/tmp");
			const realContainer = fs.realpathSync(container);

			const fence = buildContainmentFence({ workspace, home });
			for (const root of fence.deny) {
				expect(root).not.toBe("/tmp");
				expect(root).not.toBe(realTmpRoot);
			}
			expect(fenceVerdict(fence, path.join(realTmpRoot, "other-session.txt"), "read")).toBe("allow");
			// The workspace's own container is still denied, which is the point of the walk.
			expect(fenceVerdict(fence, path.join(realContainer, "sibling", "x"), "read")).toBe("deny");
			expect(fenceVerdict(fence, path.join(fs.realpathSync(workspace), "mine.txt"), "write")).toBe("allow");
		} finally {
			fs.rmSync(container, { recursive: true, force: true });
		}
	});
});

/**
 * Data roots that are neither the workspace nor operational (#2624).
 *
 * The home deny and the ancestor walk together cover the realistic case — customer checkouts under
 * `~`. They cover nothing under an unrelated root: measured with the workspace at
 * `~/MEDDPICC/EQUIFAX`, the fence allowed `/Users/<otheruser>/…`, `/Volumes/Backup/…`, `/data/globex`
 * and `/srv/tenantZ`, read and write. The command-text scan was refusing those on the way in, so the
 * composite looked right while the fence alone did not — and that scan is what #2624 stops using as a
 * boundary, so this has to hold on its own now.
 *
 * The rule is one readdir of the filesystem root: an entry whose name is not operational holds data
 * rather than tools, and is denied. Nothing operational is touched, which is the property that
 * separates this from a deny-by-default profile.
 */
describe("buildContainmentFence — data roots outside the workspace", () => {
	/** A synthetic filesystem root, so an assertion never depends on what this machine mounts. */
	function syntheticRoot(suffix: string, entries: readonly string[]): string {
		const root = realTmp(suffix);
		for (const entry of entries) fs.mkdirSync(path.join(root, entry), { recursive: true });
		return root;
	}

	it("denies unrelated data roots while leaving every operational root alone", () => {
		const fsRoot = syntheticRoot("fsdata", ["usr", "bin", "etc", "opt", "var", "Users", "data", "srv", "Volumes"]);
		const home = path.join(fsRoot, "Users", "me");
		const workspace = path.join(home, "MEDDPICC", "EQUIFAX");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(path.join(fsRoot, "Users", "otheruser"), { recursive: true });
		fs.mkdirSync(path.join(fsRoot, "data", "globex"), { recursive: true });
		fs.mkdirSync(path.join(fsRoot, "Volumes", "Backup"), { recursive: true });

		const fence = buildContainmentFence({ workspace, home, fsRoot });

		// The four cases measured as reachable before this existed.
		for (const leak of [
			path.join("Users", "otheruser", "customerX"),
			path.join("data", "globex", "secrets.tf"),
			path.join("srv", "tenantZ", "notes.md"),
			path.join("Volumes", "Backup", "customerY"),
		]) {
			const candidate = path.join(fsRoot, leak);
			expect(fenceVerdict(fence, candidate, "read")).toBe("deny");
			expect(fenceVerdict(fence, candidate, "write")).toBe("deny");
		}

		// …and nothing a tool needs. This fence restricts no operation; that is what makes it gentle.
		for (const operational of ["usr/bin/env", "bin/sh", "etc/hosts", "opt/homebrew/bin/bun", "var/log/x"]) {
			expect(fenceVerdict(fence, path.join(fsRoot, operational), "read")).toBe("allow");
		}
		// The workspace still wins inside its denied ancestors.
		expect(fenceVerdict(fence, path.join(workspace, "notes.md"), "write")).toBe("allow");
	});

	// Enumeration only sees what exists when the fence is built, so a known data root that does not
	// exist yet has to be denied by name — otherwise `mkdir /data` mid-session would open it. Seatbelt
	// matches a `(subpath …)` prefix whether or not the path is there, so the rule costs nothing.
	it("denies a known data root that does not exist yet", () => {
		const fsRoot = syntheticRoot("fsabsent", ["usr", "Users"]);
		const home = path.join(fsRoot, "Users", "me");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });
		expect(fs.existsSync(path.join(fsRoot, "srv"))).toBe(false);

		const fence = buildContainmentFence({ workspace, home, fsRoot });

		expect(fence.deny).toContain(path.join(fsRoot, "srv"));
		expect(fenceVerdict(fence, path.join(fsRoot, "srv", "tenantZ", "x"), "read")).toBe("deny");
	});

	// A deny beats an allow at EQUAL depth, so denying a root that is itself the workspace would not
	// merely be redundant — it would kill the session's own tree. Reachable wherever a container puts
	// the checkout at the top level: /app, /src, /workspaces.
	it("never denies a top-level root that is itself the workspace", () => {
		const fsRoot = syntheticRoot("fsws", ["usr", "app"]);
		const workspace = path.join(fsRoot, "app");
		const fence = buildContainmentFence({ workspace, home: path.join(fsRoot, "Users", "me"), fsRoot });

		expect(fence.deny).not.toContain(workspace);
		expect(fenceVerdict(fence, path.join(workspace, "src", "main.ts"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(workspace, "src", "main.ts"), "write")).toBe("allow");
	});

	// Same equal-depth hazard for a root the operator granted deliberately. `--allow-path /shared` must
	// win over a blanket "unknown root" deny, or the flag would silently do nothing.
	it("never denies a top-level root the operator granted", () => {
		const fsRoot = syntheticRoot("fsgrant", ["usr", "shared", "readonly", "data"]);
		const home = path.join(fsRoot, "Users", "me");
		const workspace = path.join(home, "w");
		fs.mkdirSync(workspace, { recursive: true });

		const fence = buildContainmentFence({
			workspace,
			home,
			fsRoot,
			extraRoots: [path.join(fsRoot, "shared")],
			readOnlyRoots: [path.join(fsRoot, "readonly")],
		});

		expect(fenceVerdict(fence, path.join(fsRoot, "shared", "x"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(fsRoot, "shared", "x"), "write")).toBe("allow");
		expect(fenceVerdict(fence, path.join(fsRoot, "readonly", "x"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(fsRoot, "readonly", "x"), "write")).toBe("deny");
		// An ungranted data root beside them is still denied, or the carve-out proved nothing.
		expect(fenceVerdict(fence, path.join(fsRoot, "data", "x"), "read")).toBe("deny");
	});

	// The synthetic root proves the rule; this proves it is wired to the real filesystem, which is the
	// part that actually ships. Asserted on the emitted roots, because that is what the backend compiles.
	it("denies the real home container on this machine and no operational root", () => {
		const fence = buildContainmentFence({ workspace: fs.realpathSync(process.cwd()) });

		// Other users live here, and nothing operational does.
		expect(fence.deny).toContain(process.platform === "darwin" ? "/Users" : "/home");
		for (const operational of ["/usr", "/bin", "/sbin", "/etc", "/dev", "/opt", "/var", "/private", "/tmp"]) {
			expect(fence.deny).not.toContain(operational);
			expect(fence.deny).not.toContain(fs.realpathSync(operational));
		}
		expect(fenceVerdict(fence, "/usr/bin/env", "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(fs.realpathSync("/tmp"), "scratch.txt"), "write")).toBe("allow");
	});

	// The agent's own plugins and user skills sit under `~/.xcsh`, inside the home deny. The file tools
	// allow-listed them and the fence did not, so `bash` could not read a plugin the `read` tool could —
	// the asymmetry #2624 removes. Emitted whether or not they exist yet: the skills dir is created on
	// first use, and a rule that appears only after the directory does is a rule nobody can rely on.
	it("grants the agent's own plugins and user skills, which sit under denied home", () => {
		const fence = buildContainmentFence({ workspace: fs.realpathSync(process.cwd()) });

		for (const own of [getPluginsDir(), path.join(getAgentDir(), "skills")]) {
			expect(fenceVerdict(fence, path.join(own, "probe", "manifest.json"), "read")).toBe("allow");
			// Read-only: these are inputs, and a write there changes what a later session loads.
			expect(fenceVerdict(fence, path.join(own, "probe", "manifest.json"), "write")).toBe("deny");
		}
	});

	// A leak root inside the granted plugins tree must still win, and it must win while ABSENT — the
	// case that used to fall through, because `canonical` drops a path that does not exist yet and the
	// home deny was quietly covering for it. Passed explicitly rather than read from the environment:
	// the ambient dirs depend on whether an earlier test relocated the agent dir, which is not a
	// property this test is about.
	it("denies a cross-session leak root nested inside a grant, even before it exists", () => {
		const home = realTmp("leaknest");
		const workspace = path.join(home, "w");
		const plugins = path.join(home, ".xcsh", "plugins");
		const leak = path.join(plugins, "shared-state");
		fs.mkdirSync(workspace, { recursive: true });
		fs.mkdirSync(plugins, { recursive: true });
		expect(fs.existsSync(leak)).toBe(false);

		const fence = buildContainmentFence({ workspace, home, leakRoots: [leak] });

		expect(fence.deny).toContain(leak);
		expect(fenceVerdict(fence, path.join(leak, "other-session.json"), "read")).toBe("deny");
	});
});
