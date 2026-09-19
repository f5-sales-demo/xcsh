import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getNativeLoadChannel, loadNativeChannel, tryLoadCandidates } = require("../native/installed-paths.js");

const addon = "pi_natives.darwin-arm64.node";

function resolveChannel(overrides: Record<string, unknown> = {}) {
	return getNativeLoadChannel({
		platform: "darwin",
		addonFilenames: [addon],
		rawExecPath: "/opt/homebrew/bin/xcsh",
		resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/21.33.12/bin/xcsh",
		packageVersion: "21.33.12",
		...overrides,
	});
}

describe("native addon installation channels", () => {
	it("classifies an Apple silicon Caskroom executable as installed-only", () => {
		expect(resolveChannel()).toEqual({
			mode: "installed-only",
			candidates: ["/opt/homebrew/Caskroom/xcsh/21.33.12/libexec/pi_natives.darwin-arm64.node"],
		});
	});

	it("gives resolved Caskroom identity precedence on Intel", () => {
		expect(
			resolveChannel({
				rawExecPath: "/usr/local/bin/xcsh",
				resolvedExecPath: "/usr/local/Caskroom/xcsh/21.33.12/bin/xcsh",
			}),
		).toEqual({
			mode: "installed-only",
			candidates: ["/usr/local/Caskroom/xcsh/21.33.12/libexec/pi_natives.darwin-arm64.node"],
		});
	});

	it("uses the versioned MDM payload only for exact raw and resolved identity", () => {
		expect(
			resolveChannel({
				rawExecPath: "/usr/local/bin/xcsh",
				resolvedExecPath: "/usr/local/bin/xcsh",
			}),
		).toEqual({
			mode: "installed-only",
			candidates: ["/Library/Application Support/xcsh/natives/21.33.12/pi_natives.darwin-arm64.node"],
		});
	});

	it("keeps an unrelated target behind the MDM path in the embedded-only channel", () => {
		expect(
			resolveChannel({
				rawExecPath: "/usr/local/bin/xcsh",
				resolvedExecPath: "/Users/example/bin/xcsh",
			}),
		).toEqual({ mode: "embedded-only", candidates: [] });
	});

	it("keeps unrelated executables and non-macOS platforms embedded-only", () => {
		expect(
			resolveChannel({
				rawExecPath: "/Users/example/bin/xcsh-link",
				resolvedExecPath: "/Users/example/apps/xcsh",
			}),
		).toEqual({ mode: "embedded-only", candidates: [] });
		expect(
			resolveChannel({
				platform: "linux",
				rawExecPath: "/home/example/.local/bin/xcsh",
				resolvedExecPath: "/home/example/.local/bin/xcsh",
			}),
		).toEqual({ mode: "embedded-only", candidates: [] });
	});

	it("does not expose stale payloads from another installed channel", () => {
		const caskroom = resolveChannel();
		const mdm = resolveChannel({ rawExecPath: "/usr/local/bin/xcsh", resolvedExecPath: "/usr/local/bin/xcsh" });

		expect(caskroom.candidates.join("\n")).not.toContain("/Library/Application Support/xcsh");
		expect(mdm.candidates.join("\n")).not.toContain("/Caskroom/");
	});

	it("fails closed when an installed addon is missing or invalid", () => {
		let preparedEmbedded = false;
		const errors: string[] = [];
		const loaded = loadNativeChannel(
			resolveChannel(),
			() => {
				throw new Error("invalid signature");
			},
			errors,
			() => {
				preparedEmbedded = true;
				return "/Users/example/.xcsh/natives/21.33.12/embedded.node";
			},
		);

		expect(loaded).toBeNull();
		expect(preparedEmbedded).toBeFalse();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("invalid signature");
	});

	it("extracts only the embedded candidate for non-installed locations", () => {
		const attempts: string[] = [];
		const loaded = loadNativeChannel(
			resolveChannel({ rawExecPath: "/tmp/xcsh", resolvedExecPath: "/tmp/xcsh" }),
			(candidate: string) => {
				attempts.push(candidate);
				return { source: candidate };
			},
			[],
			() => "/Users/example/.xcsh/natives/21.33.12/embedded.node",
		);

		expect(loaded).toEqual({ source: "/Users/example/.xcsh/natives/21.33.12/embedded.node" });
		expect(attempts).toEqual(["/Users/example/.xcsh/natives/21.33.12/embedded.node"]);
	});

	it("stops at the first loadable candidate", () => {
		const attempts: string[] = [];
		const errors: string[] = [];
		const loaded = tryLoadCandidates(
			["/first/addon.node", "/second/addon.node"],
			(candidate: string) => {
				attempts.push(candidate);
				return { source: candidate };
			},
			errors,
		);

		expect(loaded).toEqual({ source: "/first/addon.node" });
		expect(attempts).toEqual(["/first/addon.node"]);
		expect(errors).toEqual([]);
	});
});
