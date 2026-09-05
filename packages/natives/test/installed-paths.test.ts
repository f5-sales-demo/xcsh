import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	getInstalledNativeCandidates,
	loadInstalledBeforeFallback,
	tryLoadCandidates,
} = require("../native/installed-paths.js");

describe("installed native addon paths", () => {
	it("prefers the pkg system path and Homebrew libexec path on macOS", () => {
		const candidates = getInstalledNativeCandidates({
			platform: "darwin",
			packageVersion: "21.11.9",
			addonFilenames: ["pi_natives.darwin-arm64.node"],
			execDir: "/opt/homebrew/Cellar/xcsh/21.11.9/bin",
			resolvedExecDir: "/opt/homebrew/Cellar/xcsh/21.11.9/bin",
		});

		expect(candidates).toEqual([
			"/Library/Application Support/xcsh/natives/21.11.9/pi_natives.darwin-arm64.node",
			"/opt/homebrew/Cellar/xcsh/21.11.9/libexec/pi_natives.darwin-arm64.node",
		]);
	});

	it("resolves Homebrew libexec through the stable bin symlink", () => {
		const candidates = getInstalledNativeCandidates({
			platform: "darwin",
			packageVersion: "21.11.9",
			addonFilenames: ["pi_natives.darwin-arm64.node"],
			execDir: "/opt/homebrew/bin",
			resolvedExecDir: "/opt/homebrew/Cellar/xcsh/21.11.9/bin",
		});

		expect(candidates).toContain("/opt/homebrew/Cellar/xcsh/21.11.9/libexec/pi_natives.darwin-arm64.node");
	});

	it("does not advertise macOS installation paths on other platforms", () => {
		expect(
			getInstalledNativeCandidates({
				platform: "linux",
				packageVersion: "21.11.9",
				addonFilenames: ["pi_natives.linux-x64.node"],
				execDir: "/home/linuxbrew/.linuxbrew/Cellar/xcsh/21.11.9/bin",
			}),
		).toEqual([]);
	});

	it("stops at the first loadable installed candidate", () => {
		const attempts: string[] = [];
		const errors: string[] = [];
		const loaded = tryLoadCandidates(
			["/pkg/addon.node", "/brew/addon.node", "/embedded/addon.node"],
			(candidate: string) => {
				attempts.push(candidate);
				if (candidate === "/pkg/addon.node") return { source: candidate };
				throw new Error("unexpected fallback");
			},
			errors,
		);

		expect(loaded).toEqual({ source: "/pkg/addon.node" });
		expect(attempts).toEqual(["/pkg/addon.node"]);
		expect(errors).toEqual([]);
	});

	it("does not extract the embedded fallback when an installed addon loads", () => {
		let preparedFallback = false;
		const loaded = loadInstalledBeforeFallback(
			["/Library/Application Support/xcsh/natives/21.11.9/addon.node"],
			(candidate: string) => ({ source: candidate }),
			[],
			() => {
				preparedFallback = true;
				return ["/home/test/.xcsh/natives/21.11.9/addon.node"];
			},
		);

		expect(loaded.source).toStartWith("/Library/Application Support/xcsh/natives/");
		expect(preparedFallback).toBeFalse();
	});
});
