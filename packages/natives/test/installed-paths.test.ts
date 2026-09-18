import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
	getInstalledNativeCandidates,
	loadInstalledBeforeFallback,
	tryLoadCandidates,
} = require("../native/installed-paths.js");

describe("installed native addon paths", () => {
	it("prefers the Caskroom libexec path on macOS", () => {
		const candidates = getInstalledNativeCandidates({
			platform: "darwin",
			addonFilenames: ["pi_natives.darwin-arm64.node"],
			resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/21.31.0/bin/xcsh",
			resolvedExecDir: "/opt/homebrew/Caskroom/xcsh/21.31.0/bin",
			packageVersion: "21.31.0",
		});

		expect(candidates).toEqual(["/opt/homebrew/Caskroom/xcsh/21.31.0/libexec/pi_natives.darwin-arm64.node"]);
	});

	it("resolves Homebrew libexec through the stable bin symlink", () => {
		const candidates = getInstalledNativeCandidates({
			platform: "darwin",
			addonFilenames: ["pi_natives.darwin-arm64.node"],
			resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/21.31.0/bin/xcsh",
			resolvedExecDir: "/opt/homebrew/Caskroom/xcsh/21.31.0/bin",
			packageVersion: "21.31.0",
		});

		expect(candidates).toEqual(["/opt/homebrew/Caskroom/xcsh/21.31.0/libexec/pi_natives.darwin-arm64.node"]);
	});

	it("uses the versioned system payload only for the direct MDM executable", () => {
		const candidates = getInstalledNativeCandidates({
			platform: "darwin",
			addonFilenames: ["pi_natives.darwin-arm64.node"],
			resolvedExecPath: "/usr/local/bin/xcsh",
			resolvedExecDir: "/usr/local/bin",
			packageVersion: "21.32.1",
		});

		expect(candidates).toEqual(["/Library/Application Support/xcsh/natives/21.32.1/pi_natives.darwin-arm64.node"]);
	});

	it("does not let an unrelated standalone binary see Caskroom or MDM payloads", () => {
		expect(
			getInstalledNativeCandidates({
				platform: "darwin",
				addonFilenames: ["pi_natives.darwin-arm64.node"],
				resolvedExecPath: "/Users/username/bin/xcsh",
				resolvedExecDir: "/Users/username/bin",
				packageVersion: "21.32.1",
			}),
		).toEqual([]);
	});

	it("does not advertise macOS installation paths on other platforms", () => {
		expect(
			getInstalledNativeCandidates({
				platform: "linux",
				addonFilenames: ["pi_natives.linux-x64.node"],
				resolvedExecPath: "/home/username/.linuxbrew/bin/xcsh",
				resolvedExecDir: "/home/username/.linuxbrew/bin",
				packageVersion: "21.32.1",
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
			["/opt/homebrew/Caskroom/xcsh/21.31.0/libexec/addon.node"],
			(candidate: string) => ({ source: candidate }),
			[],
			() => {
				preparedFallback = true;
				return ["/home/username/.xcsh/natives/21.11.9/addon.node"];
			},
		);

		expect(loaded.source).toStartWith("/opt/homebrew/Caskroom/xcsh/");
		expect(preparedFallback).toBeFalse();
	});
});
