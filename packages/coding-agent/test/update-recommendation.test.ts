import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { replaceStandaloneExecutable, runUpdateCommand, type UpdateCommandDependencies } from "../src/cli/update-cli";
import {
	createInstallReceipt,
	formatUpdateRecommendation,
	getStartupUpdateNotice,
	type InstallChannelDependencies,
	resolveInstallChannel,
} from "../src/cli/update-recommendation";

const require = createRequire(import.meta.url);
const { getNativeLoadChannel } = require("../../natives/native/installed-paths.js");

const VERSION = "22.0.0";

function dependencies(overrides: Partial<InstallChannelDependencies> = {}): InstallChannelDependencies {
	const execPath = overrides.execPath ?? "/home/example/.local/bin/xcsh";
	return {
		platform: "linux",
		arch: "x64",
		execPath,
		version: VERSION,
		homeDir: "/home/example",
		env: {},
		realpath: async value => value,
		readFile: async () => {
			throw Object.assign(new Error("missing"), { code: "ENOENT" });
		},
		run: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
		...overrides,
	};
}

function receipt(channel: "standalone" | "windows-installer", executablePath: string, platform: string, arch: string) {
	return JSON.stringify({ schemaVersion: 2, channel, version: VERSION, executablePath, platform, arch });
}

describe("installation-channel recommendation", () => {
	it.each([
		["Apple silicon", "/opt/homebrew/Caskroom/xcsh/22.0.0/bin/xcsh"],
		["Intel", "/usr/local/Caskroom/xcsh/22.0.0/bin/xcsh"],
	] as const)("recognizes the exact %s Homebrew cask layout", async (_name, executable) => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				arch: "arm64",
				execPath: "/usr/local/bin/xcsh",
				realpath: async () => executable,
			}),
		);
		expect(recommendation).toEqual({
			channel: "homebrew-cask",
			action: "external-command",
			command: "brew upgrade --cask f5-sales-demo/tap/xcsh",
			evidence: `running executable resolves to ${executable}`,
		});
	});

	it("requires exact executable identity and the com.f5.xcsh receipt for MDM", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				execPath: "/usr/local/bin/xcsh",
				run: async (command, args) => {
					if (command !== "pkgutil") return { exitCode: 1, stdout: "", stderr: "" };
					if (args[0] === "--pkg-info") return { exitCode: 0, stdout: "package-id: com.f5.xcsh\n", stderr: "" };
					return { exitCode: 0, stdout: "usr/local/bin/xcsh\n", stderr: "" };
				},
			}),
		);
		expect(recommendation.channel).toBe("macos-mdm");
		expect(recommendation.action).toBe("managed");
		expect(formatUpdateRecommendation(recommendation)).toContain(
			"Managed by your organization; request an MDM deployment.",
		);
	});

	it("does not classify a symlink at the MDM path as MDM", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				execPath: "/usr/local/bin/xcsh",
				realpath: async () => "/Applications/xcsh",
				run: async () => ({ exitCode: 0, stdout: "package-id: com.f5.xcsh\n", stderr: "" }),
			}),
		);
		expect(recommendation.channel).toBe("unknown");
		expect(recommendation.action).toBe("blocked");
	});

	it("rejects an MDM receipt that does not own the exact executable path", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				execPath: "/usr/local/bin/xcsh",
				run: async (_command, args) => ({
					exitCode: 0,
					stdout: args[0] === "--pkg-info" ? "package-id: com.f5.xcsh\n" : "Library/other-file\n",
					stderr: "",
				}),
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
	});

	it("requires dpkg-query to prove package xcsh owns the running executable", async () => {
		const executable = "/usr/bin/xcsh";
		const recommendation = await resolveInstallChannel(
			dependencies({
				execPath: executable,
				run: async (command, args) => ({
					exitCode: command === "dpkg-query" && args.at(-1) === executable ? 0 : 1,
					stdout: "xcsh: /usr/bin/xcsh\n",
					stderr: "",
				}),
			}),
		);
		expect(recommendation).toMatchObject({
			channel: "debian-apt",
			action: "external-command",
			command: "sudo apt-get update && sudo apt-get install --only-upgrade xcsh",
		});
	});

	it("fails closed when the apt ownership tool is unavailable", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				execPath: "/usr/bin/xcsh",
				run: async () => ({ exitCode: 127, stdout: "", stderr: "missing" }),
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
	});

	it.each(["npm", "bun"] as const)("accepts a valid %s launcher marker only in the release cache", async channel => {
		const executable = `/home/example/.cache/xcsh/releases/v${VERSION}/linux-x64/xcsh-linux-x64`;
		const recommendation = await resolveInstallChannel(
			dependencies({ execPath: executable, env: { XCSH_DISTRIBUTION_CHANNEL: channel } }),
		);
		expect(recommendation).toMatchObject({
			channel,
			action: "external-command",
			command:
				channel === "npm" ? "npm update --global @f5-sales-demo/xcsh" : "bun update --global @f5-sales-demo/xcsh",
		});
	});

	it("rejects a spoofed package launcher marker outside the compiled-release cache", async () => {
		const recommendation = await resolveInstallChannel(dependencies({ env: { XCSH_DISTRIBUTION_CHANNEL: "npm" } }));
		expect(recommendation.channel).toBe("unknown");
		expect(recommendation.evidence).toContain("invalid npm launcher marker");
	});

	it("allows self-update only for a valid adjacent standalone receipt", async () => {
		const executable = "/home/example/.local/bin/xcsh";
		const recommendation = await resolveInstallChannel(
			dependencies({
				execPath: executable,
				readFile: async path => {
					expect(path).toBe("/home/example/.local/bin/xcsh-install.json");
					return receipt("standalone", executable, "linux", "x64");
				},
			}),
		);
		expect(recommendation).toMatchObject({
			channel: "standalone",
			action: "self-update",
			command: "xcsh self-update",
		});
	});

	it("rejects schema-v1 receipts without compatibility parsing", async () => {
		const executable = "/home/example/.local/bin/xcsh";
		const recommendation = await resolveInstallChannel(
			dependencies({
				execPath: executable,
				readFile: async () =>
					JSON.stringify({
						schemaVersion: 1,
						channel: "standalone",
						version: VERSION,
						executablePath: executable,
						platform: "linux",
						arch: "x64",
					}),
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
		expect(recommendation.evidence).toContain("invalid or stale install receipt");
	});

	it("accepts the canonical target in a macOS /tmp alias receipt", async () => {
		const canonical = "/private/tmp/xcsh-uat/bin/xcsh";
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				arch: "arm64",
				execPath: "/tmp/xcsh-uat/bin/xcsh",
				realpath: async () => canonical,
				readFile: async path => {
					expect(path).toBe("/private/tmp/xcsh-uat/bin/xcsh-install.json");
					return receipt("standalone", canonical, "darwin", "arm64");
				},
			}),
		);
		expect(recommendation).toMatchObject({ channel: "standalone", action: "self-update" });
	});

	it("rejects a noncanonical macOS /tmp alias in a schema-v2 receipt", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				arch: "arm64",
				execPath: "/tmp/xcsh-uat/bin/xcsh",
				realpath: async () => "/private/tmp/xcsh-uat/bin/xcsh",
				readFile: async () => receipt("standalone", "/tmp/xcsh-uat/bin/xcsh", "darwin", "arm64"),
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
	});

	it("normalizes absolute Windows paths in schema-v2 receipts", () => {
		expect(
			createInstallReceipt(
				"windows-installer",
				VERSION,
				"C:\\Users\\example\\AppData\\Local\\xcsh\\staging\\..\\xcsh.exe",
				"win32",
				"x64",
			),
		).toMatchObject({
			schemaVersion: 2,
			executablePath: "C:\\Users\\example\\AppData\\Local\\xcsh\\xcsh.exe",
		});
	});

	it("recognizes a valid Windows installer receipt beside the LocalAppData executable", async () => {
		const executable = "C:\\Users\\example\\AppData\\Local\\xcsh\\xcsh.exe";
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "win32",
				arch: "x64",
				execPath: executable,
				homeDir: "C:\\Users\\example",
				env: { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" },
				readFile: async () => receipt("windows-installer", executable, "win32", "x64"),
			}),
		);
		expect(recommendation.channel).toBe("windows-installer");
		expect(recommendation.command).toContain(
			"irm https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/scripts/install.ps1 | iex",
		);
	});

	it.each([
		["malformed receipt", "{"],
		["stale receipt", receipt("standalone", "/home/example/.local/bin/xcsh", "linux", "arm64")],
	] as const)("fails closed for a %s", async (_name, contents) => {
		const recommendation = await resolveInstallChannel(dependencies({ readFile: async () => contents }));
		expect(recommendation.channel).toBe("unknown");
		expect(recommendation.action).toBe("blocked");
	});

	it("fails closed when proven signals conflict", async () => {
		const executable = `/home/example/.cache/xcsh/releases/v${VERSION}/linux-x64/xcsh-linux-x64`;
		const recommendation = await resolveInstallChannel(
			dependencies({
				execPath: executable,
				env: { XCSH_DISTRIBUTION_CHANNEL: "bun" },
				readFile: async () => receipt("standalone", executable, "linux", "x64"),
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
		expect(recommendation.evidence).toContain("conflicting installation evidence");
	});

	it("fails closed when valid channel evidence is accompanied by an invalid marker", async () => {
		const executable = "/opt/homebrew/Caskroom/xcsh/22.0.0/bin/xcsh";
		const recommendation = await resolveInstallChannel(
			dependencies({
				platform: "darwin",
				execPath: executable,
				env: { XCSH_DISTRIBUTION_CHANNEL: "npm" },
			}),
		);
		expect(recommendation).toMatchObject({ channel: "unknown", action: "blocked" });
		expect(recommendation.evidence).toContain("conflicting installation evidence");
	});

	it("fails closed when the running executable realpath is broken", async () => {
		const recommendation = await resolveInstallChannel(
			dependencies({
				realpath: async () => {
					throw Object.assign(new Error("broken"), { code: "ENOENT" });
				},
			}),
		);
		expect(recommendation).toEqual({
			channel: "unknown",
			action: "blocked",
			evidence: "running executable could not be resolved",
		});
	});

	it("stays aligned with native-addon Caskroom and MDM identity classification", async () => {
		for (const fixture of [
			{
				rawExecPath: "/opt/homebrew/bin/xcsh",
				resolvedExecPath: "/opt/homebrew/Caskroom/xcsh/22.0.0/bin/xcsh",
				expected: "homebrew-cask",
			},
			{
				rawExecPath: "/usr/local/bin/xcsh",
				resolvedExecPath: "/usr/local/bin/xcsh",
				expected: "macos-mdm",
			},
		] as const) {
			const native = getNativeLoadChannel({
				platform: "darwin",
				addonFilenames: ["pi_natives.darwin-arm64.node"],
				rawExecPath: fixture.rawExecPath,
				resolvedExecPath: fixture.resolvedExecPath,
				packageVersion: VERSION,
			});
			const recommendation = await resolveInstallChannel(
				dependencies({
					platform: "darwin",
					execPath: fixture.rawExecPath,
					realpath: async () => fixture.resolvedExecPath,
					run: async (_command, args) => ({
						exitCode: 0,
						stdout: args[0] === "--pkg-info" ? "package-id: com.f5.xcsh\n" : "usr/local/bin/xcsh\n",
						stderr: "",
					}),
				}),
			);
			expect(native.mode).toBe("installed-only");
			expect(recommendation.channel).toBe(fixture.expected);
		}
	});
});

function commandDependencies(
	recommendation: Awaited<ReturnType<typeof resolveInstallChannel>>,
	overrides: Partial<UpdateCommandDependencies> = {},
): { deps: UpdateCommandDependencies; stdout: string[]; stderr: string[]; mutations: string[] } {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const mutations: string[] = [];
	return {
		stdout,
		stderr,
		mutations,
		deps: {
			currentVersion: VERSION,
			getLatestRelease: async () => ({ tag: `v${VERSION}`, version: VERSION }),
			resolveRecommendation: async () => recommendation,
			updateStandalone: async version => {
				mutations.push(version);
			},
			stdout: value => stdout.push(value),
			stderr: value => stderr.push(value),
			...overrides,
		},
	};
}

describe("update command channel policy", () => {
	it.each([
		{
			channel: "homebrew-cask",
			action: "external-command",
			command: "brew upgrade --cask f5-sales-demo/tap/xcsh",
			evidence: "cask",
		},
		{ channel: "macos-mdm", action: "managed", evidence: "receipt" },
		{
			channel: "debian-apt",
			action: "external-command",
			command: "sudo apt-get update && sudo apt-get install --only-upgrade xcsh",
			evidence: "dpkg",
		},
		{
			channel: "npm",
			action: "external-command",
			command: "npm update --global @f5-sales-demo/xcsh",
			evidence: "launcher",
		},
		{
			channel: "bun",
			action: "external-command",
			command: "bun update --global @f5-sales-demo/xcsh",
			evidence: "launcher",
		},
		{
			channel: "windows-installer",
			action: "external-command",
			command: "installer",
			evidence: "receipt",
		},
	] as const)("never invokes the $channel owner", async recommendation => {
		const harness = commandDependencies(recommendation);
		const exitCode = await runUpdateCommand({ check: false, force: true }, harness.deps);
		expect(exitCode).toBe(0);
		expect(harness.mutations).toEqual([]);
		expect(harness.stdout.join("\n")).toContain("No update was performed");
	});

	it("keeps --check --force read-only and displays the standalone recommendation", async () => {
		const harness = commandDependencies({
			channel: "standalone",
			action: "self-update",
			command: "xcsh self-update",
			evidence: "receipt",
		});
		const exitCode = await runUpdateCommand({ check: true, force: true }, harness.deps);
		expect(exitCode).toBe(0);
		expect(harness.mutations).toEqual([]);
		expect(harness.stdout.join("\n")).toContain("Detected channel: standalone");
		expect(harness.stdout.join("\n")).toContain("can update itself");
	});

	it("allows only a proven standalone installation to replace itself", async () => {
		const harness = commandDependencies({
			channel: "standalone",
			action: "self-update",
			command: "xcsh self-update",
			evidence: "receipt",
		});
		const exitCode = await runUpdateCommand({ check: false, force: true }, harness.deps);
		expect(exitCode).toBe(0);
		expect(harness.mutations).toEqual([VERSION]);
	});

	it("returns one and performs no mutation for unknown provenance", async () => {
		const harness = commandDependencies({ channel: "unknown", action: "blocked", evidence: "conflict" });
		const exitCode = await runUpdateCommand({ check: false, force: true }, harness.deps);
		expect(exitCode).toBe(1);
		expect(harness.mutations).toEqual([]);
		expect(harness.stderr.join("\n")).toContain("Update blocked");
	});
});

describe("startup update notice", () => {
	it("renders the channel-specific instruction from injected version and provenance dependencies", async () => {
		const notice = await getStartupUpdateNotice(VERSION, {
			getLatestVersion: async () => "22.0.1",
			resolveRecommendation: async () => ({
				channel: "homebrew-cask",
				action: "external-command",
				command: "brew upgrade --cask f5-sales-demo/tap/xcsh",
				evidence: "cask",
			}),
		});
		expect(notice).toBe("Update available: v22.0.1 — run: brew upgrade --cask f5-sales-demo/tap/xcsh");
		expect(notice).not.toContain("curl");
	});
});

describe("standalone replacement rollback", () => {
	it.each([
		"download",
		"staged-binary-verification",
		"receipt-write",
		"binary-backup",
		"receipt-backup",
		"binary-install",
		"receipt-install",
		"final-binary-verification",
		"final-receipt-validation",
	] as const)("restores the executable and receipt after %s failure", async failure => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-standalone-rollback-"));
		const targetPath = path.join(tempDir, "xcsh");
		const receiptPath = path.join(tempDir, "xcsh-install.json");
		const originalReceipt = `${JSON.stringify(createInstallReceipt("standalone", "21.9.9", targetPath, "linux", "x64"))}\n`;
		fs.writeFileSync(targetPath, "original", { mode: 0o755 });
		fs.writeFileSync(receiptPath, originalReceipt);
		let renameCalls = 0;
		let validateCalls = 0;
		let readCalls = 0;
		try {
			await expect(
				replaceStandaloneExecutable(VERSION, {
					targetPath,
					platform: "linux",
					arch: "x64",
					fetchImpl: async () =>
						failure === "download" ? new Response(null, { status: 500 }) : new Response("replacement"),
					writeFile: async (file, contents) => {
						if (failure === "receipt-write") throw new Error("receipt write failed");
						await fs.promises.writeFile(file, contents, { flag: "wx" });
					},
					readFile: async file => {
						readCalls += 1;
						if (failure === "final-receipt-validation" && readCalls === 2) return "corrupt";
						return fs.promises.readFile(file, "utf8");
					},
					rename: async (source, destination) => {
						renameCalls += 1;
						const failureCall = {
							"binary-backup": 1,
							"receipt-backup": 2,
							"binary-install": 3,
							"receipt-install": 4,
						}[failure as string];
						if (failureCall === renameCalls) throw new Error(`${failure} failed`);
						await fs.promises.rename(source, destination);
					},
					validate: async () => {
						validateCalls += 1;
						if (failure === "staged-binary-verification" && validateCalls === 1)
							throw new Error("staged verification failed");
						if (failure === "final-binary-verification" && validateCalls === 2)
							throw new Error("final verification failed");
					},
				}),
			).rejects.toThrow();
			expect(fs.readFileSync(targetPath, "utf8")).toBe("original");
			expect(fs.readFileSync(receiptPath, "utf8")).toBe(originalReceipt);
			expect(fs.readdirSync(tempDir).filter(name => name.includes(".new-") || name.includes(".bak-"))).toEqual([]);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("advances the receipt and remains valid across repeated forced updates", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-standalone-success-"));
		const targetPath = path.join(tempDir, "xcsh");
		const receiptPath = path.join(tempDir, "xcsh-install.json");
		fs.writeFileSync(targetPath, "original", { mode: 0o755 });
		fs.writeFileSync(
			receiptPath,
			`${JSON.stringify(createInstallReceipt("standalone", "21.9.9", targetPath, "linux", "x64"))}\n`,
		);
		try {
			const update = () =>
				replaceStandaloneExecutable(VERSION, {
					targetPath,
					platform: "linux",
					arch: "x64",
					fetchImpl: async () => new Response("replacement"),
					validate: async () => {},
				});
			await update();
			expect(fs.readFileSync(targetPath, "utf8")).toBe("replacement");
			expect(JSON.parse(fs.readFileSync(receiptPath, "utf8"))).toEqual(
				createInstallReceipt("standalone", VERSION, targetPath, "linux", "x64"),
			);
			expect(
				await resolveInstallChannel(
					dependencies({
						execPath: targetPath,
						version: VERSION,
						readFile: file => fs.promises.readFile(file, "utf8"),
					}),
				),
			).toMatchObject({ channel: "standalone", action: "self-update" });
			await update();
			expect(JSON.parse(fs.readFileSync(receiptPath, "utf8"))).toEqual(
				createInstallReceipt("standalone", VERSION, targetPath, "linux", "x64"),
			);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

describe("installer receipt contract", () => {
	it("writes canonical schema-v2 receipts after standalone binaries without adjacent native payloads", () => {
		const shell = fs.readFileSync(new URL("../../../scripts/install.sh", import.meta.url), "utf8");
		const powershell = fs.readFileSync(new URL("../../../scripts/install.ps1", import.meta.url), "utf8");
		expect(shell).toContain('"schemaVersion":2,"channel":"standalone"');
		expect(shell).toContain('CANONICAL_INSTALL_DIR=$(cd -P "$INSTALL_DIR" && pwd -P)');
		expect(shell).not.toContain("NATIVE_URL=");
		expect(shell.indexOf('mv -f "$INSTALL_STAGE_DIR/xcsh" "$INSTALL_DIR/xcsh"')).toBeLessThan(
			shell.indexOf('mv -f "$INSTALL_STAGE_DIR/xcsh-install.json" "$INSTALL_DIR/xcsh-install.json"'),
		);
		expect(powershell).toContain('[System.IO.Path]::GetFullPath((Join-Path $InstallDir "xcsh.exe"))');
		expect(powershell).toContain("schemaVersion = 2");
		expect(powershell).toContain('channel = "windows-installer"');
		expect(powershell).not.toContain("$NativeAddonNames");
		expect(powershell.indexOf("Move-Item -Force $StagedBinary $OutPath")).toBeLessThan(
			powershell.indexOf("Move-Item -Force $StagedReceipt $ReceiptPath"),
		);
	});

	it("qualifies published standalone installers on Linux, macOS, and Windows", () => {
		const workflow = fs.readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
		expect(workflow).toContain("verify-standalone-install:");
		expect(workflow).toContain("needs: [create-release, publish-npm]");
		expect(workflow).toContain("os: [ubuntu-22.04, macos-14, windows-latest]");
		expect(workflow).toContain('"$binary" self-update --force');
		expect(workflow).toContain('"$binary" self-update --check --force');
	});
});
