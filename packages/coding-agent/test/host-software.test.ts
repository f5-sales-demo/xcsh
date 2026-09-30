import { describe, expect, it } from "bun:test";
import { parseEnrollment } from "../src/host/management";
import { parseArchiveManifest, resolveSoftware } from "../src/host/software";
import { IntegrationRegistry } from "../src/integrations/registry";
import { describeSetupPlan, executeInstallAuthorizedSetup, executeReviewedSetup } from "../src/integrations/setup";

const recipe = {
	id: "salesforce",
	executable: "sf",
	versionArgs: ["--version"],
	brew: { package: "sf" },
	winget: "Salesforce.SalesforceCLI",
	archive: {
		manifestUrl:
			"https://developer.salesforce.com/media/salesforce-cli/sf/channels/stable/sf-linux-{arch}-buildmanifest",
		baseDir: "sf",
		executable: "bin/sf",
	},
};
function environment(os = "darwin", management = "unknown", existing = false) {
	return {
		host: async () => ({
			os,
			architecture: "x64",
			management,
			packageManagers: {
				brew: "/opt/homebrew/bin/brew",
				winget: "C:/winget.exe",
				apt: "/usr/bin/apt-get",
				sudo: "/usr/bin/sudo",
			},
			effectiveUid: 1000,
			sudo: "available",
			distribution: "ubuntu",
		}),
		find: () => (existing ? "/opt/homebrew/bin/sf" : undefined),
		identity: async (path: string) => path,
		run: async () => ({ code: 0, stdout: "sf 2.151.7", stderr: "" }),
		home: "/home/example",
		dataHome: "/home/example/.local/share",
		exists: async () => false,
	};
}
describe("shared host software policy", () => {
	it("keeps failed and malformed enrollment unknown", () => {
		expect(parseEnrollment(1, "MDM enrollment: No").status).toBe("unknown");
		expect(parseEnrollment(0, "unexpected").status).toBe("unknown");
		expect(parseEnrollment(0, "MDM enrollment: Yes (User Approved)").status).toBe("managed");
		expect(parseEnrollment(0, "MDM enrollment: No").status).toBe("unmanaged");
	});
	for (const management of ["managed", "unmanaged", "unknown"]) {
		it(`reuses working sf on ${management} Mac without install`, async () => {
			const resolution = await resolveSoftware(recipe, undefined, environment("darwin", management, true) as never);
			expect(resolution.steps).toEqual([]);
			expect(resolution.executable).toBe("/opt/homebrew/bin/sf");
		});
		it(`uses only brew without elevation on ${management} Mac`, async () => {
			const resolution = await resolveSoftware(recipe, undefined, environment("darwin", management) as never);
			expect(resolution.steps[0].argv).toEqual(["/opt/homebrew/bin/brew", "install", "sf"]);
			expect(resolution.elevation).toBe("none");
		});
	}
	it("does not fall back when Homebrew is missing", async () => {
		const env = environment();
		env.host = async () => ({ ...(await environment().host()), packageManagers: {} }) as never;
		await expect(resolveSoftware(recipe, undefined, env as never)).rejects.toThrow("Homebrew");
	});
	it("does not overwrite a broken executable", async () => {
		const env = environment("darwin", "managed", true);
		env.run = async () => ({ code: 1, stdout: "", stderr: "private" });
		await expect(resolveSoftware(recipe, undefined, env as never)).rejects.toThrow("working version");
	});
	it("selects exact official winget ID", async () => {
		expect((await resolveSoftware(recipe, undefined, environment("win32") as never)).steps[0].argv).toContain(
			"Salesforce.SalesforceCLI",
		);
	});
	it("rejects unsupported hosts", async () => {
		await expect(resolveSoftware(recipe, undefined, environment("freebsd") as never)).rejects.toThrow("Unsupported");
	});
	it("validates a versioned official manifest and architecture", () => {
		const manifest = {
			version: "2.151.7",
			baseDir: "sf",
			gz: "https://developer.salesforce.com/media/salesforce-cli/sf/versions/2.151.7/3910271/sf-v2.151.7-3910271-linux-arm64.tar.gz",
			sha256gz: "a".repeat(64),
		};
		expect(parseArchiveManifest(manifest, "arm64", recipe.archive).version).toBe("2.151.7");
		expect(() => parseArchiveManifest(manifest, "x64", recipe.archive)).toThrow("manifest");
		expect(() => parseArchiveManifest({ ...manifest, sha256gz: "bad" }, "arm64", recipe.archive)).toThrow("manifest");
		expect(() =>
			parseArchiveManifest({ ...manifest, gz: "https://example.com/file" }, "arm64", recipe.archive),
		).toThrow("manifest");
	});
});
describe("prepared setup review", () => {
	it("freezes async preparation immediately before review and rejects stale reviews", async () => {
		const registry = new IntegrationRegistry();
		let runs = 0;
		let revision = 0;
		const base = {
			pluginDependencies: [],
			requiredEnvironment: [],
			profileFields: [],
			steps: [],
			verification: [{ argv: ["sf", "--version"], timeoutMs: 1000 }],
		};
		const handle = registry.register("test", {
			id: "salesforce",
			name: "Salesforce",
			kind: "local",
			setup: base,
			prepareSetup: async () => ({ ...base, notes: [String(++revision)] }),
			probe: async () => ({ state: "ready" }),
		});
		const first = await handle.prepareSetup!();
		expect(Object.isFrozen(first)).toBe(true);
		expect(describeSetupPlan(handle)).toContain("1");
		await handle.prepareSetup!();
		await expect(
			executeReviewedSetup(handle, first, async () => {
				runs++;
				return 0;
			}),
		).rejects.toThrow("reviewed");
		expect(runs).toBe(0);
	});
	it("cancelled setup executes nothing", async () => {
		const registry = new IntegrationRegistry();
		let runs = 0;
		const handle = registry.register("test", {
			id: "test",
			name: "Test",
			kind: "local",
			setup: {
				pluginDependencies: [],
				requiredEnvironment: [],
				profileFields: [],
				steps: [{ kind: "install", argv: ["false"], timeoutMs: 1000 }],
				verification: [],
			},
			probe: async () => ({ state: "ready" }),
		});
		const signal = AbortSignal.abort();
		await expect(
			executeReviewedSetup(
				handle,
				handle.setupPlan!,
				async () => {
					runs++;
					return 0;
				},
				signal,
			),
		).rejects.toThrow("cancelled");
		expect(runs).toBe(0);
	});
});

describe("Linux routes and review prerequisites", () => {
	const aptRecipe = { id: "github", executable: "gh", versionArgs: ["--version"], apt: ["gh"] };
	for (const uid of [0, 1000])
		it(`uses ${uid === 0 ? "root" : "reviewed sudo"} for available apt packages`, async () => {
			const env = environment("linux");
			const host = await env.host();
			env.host = async () => ({ ...host, effectiveUid: uid });
			env.run = async () => ({ code: 0, stdout: "gh:\n  Candidate: 2.1.0\n", stderr: "" });
			const result = await resolveSoftware(aptRecipe, undefined, env as never);
			expect(result.steps[0].argv).toEqual([
				...(uid === 0 ? [] : ["/usr/bin/sudo"]),
				"/usr/bin/apt-get",
				"install",
				"--yes",
				"gh",
			]);
			expect(result.elevation).toBe(uid === 0 ? "none" : "sudo");
		});
	it("rejects unavailable packages and unknown sudo capability", async () => {
		const env = environment("linux");
		env.run = async () => ({ code: 0, stdout: "Candidate: (none)", stderr: "" });
		await expect(resolveSoftware(aptRecipe, undefined, env as never)).rejects.toThrow("unavailable");
		env.run = async () => ({ code: 0, stdout: "Candidate: 2.1.0", stderr: "" });
		const info = await env.host();
		env.host = async () => ({ ...info, sudo: "unknown" }) as never;
		await expect(resolveSoftware(aptRecipe, undefined, env as never)).rejects.toThrow("sudo");
	});
	it("requires fresh review after executable identity changes", async () => {
		const env = environment("darwin", "managed", true);
		let identity = "old";
		env.identity = async path => path + identity;
		const result = await resolveSoftware(recipe, undefined, env as never);
		identity = "new";
		await expect(result.validate()).rejects.toThrow("review setup again");
	});
	it("rejects a conflicting non-executable discovery path", async () => {
		const env = environment();
		env.exists = async () => true;
		await expect(resolveSoftware(recipe, undefined, env as never)).rejects.toThrow("Conflicting");
	});
	for (const architecture of ["x64", "arm64"])
		it(`freezes official Linux ${architecture} archive and per-user destination`, async () => {
			const env = environment("linux");
			const info = await env.host();
			env.host = async () => ({ ...info, architecture });
			const manifest = {
				version: "2.151.7",
				baseDir: "sf",
				gz: `https://developer.salesforce.com/media/salesforce-cli/sf/versions/2.151.7/3910271/sf-v2.151.7-3910271-linux-${architecture}.tar.gz`,
				sha256gz: "a".repeat(64),
			};
			const original = globalThis.fetch;
			globalThis.fetch = Object.assign(async () => new Response(JSON.stringify(manifest)), {
				preconnect: original.preconnect,
			});
			try {
				const result = await resolveSoftware(recipe, undefined, env as never);
				expect(result.steps[0].archive).toMatchObject({
					version: "2.151.7",
					sha256: "a".repeat(64),
					destination: "/home/example/.local/share/xcsh/software/salesforce/2.151.7",
					link: "/home/example/.local/bin/sf",
				});
				expect(result.elevation).toBe("none");
				await result.validate();
			} finally {
				globalThis.fetch = original;
			}
		});
});

it("install-authorized setup displays the prepared frozen plan before execution", async () => {
	const registry = new IntegrationRegistry();
	const events: string[] = [];
	const base = {
		pluginDependencies: [],
		requiredEnvironment: [],
		profileFields: [],
		steps: [{ kind: "install" as const, argv: ["false"], timeoutMs: 1000 }],
		verification: [],
	};
	const handle = registry.register("test", {
		id: "test",
		name: "Test",
		kind: "local",
		setup: base,
		prepareSetup: async () => {
			events.push("prepare");
			return { ...base, notes: ["Installer: Homebrew; required elevation: none"] };
		},
		probe: async () => ({ state: "setup_required" as const }),
	});
	await executeInstallAuthorizedSetup({
		plugin: "test",
		lifecycle: { setupRequired: true, setupAuthorization: "install" },
		trigger: "direct-install",
		handles: [handle],
		review: async (_handle, plan) => {
			events.push("review");
			expect(Object.isFrozen(plan)).toBe(true);
			expect(describeSetupPlan(handle)).toContain("Homebrew");
		},
		run: async () => {
			events.push("execute");
			return 0;
		},
	});
	expect(events).toEqual(["prepare", "review", "execute"]);
});

it("working Mac executable reuse does not inspect irrelevant sudo ownership", async () => {
	const env = environment("darwin", "managed", true);
	env.identity = async path => {
		if (path.includes("sudo")) throw new Error("denied");
		return path;
	};
	const result = await resolveSoftware(recipe, undefined, env as never);
	await result.validate();
	expect(result.steps).toEqual([]);
});

it("unavailable official winget package fails during preparation", async () => {
	const env = environment("win32");
	env.run = async () => ({ code: 1, stdout: "", stderr: "" });
	await expect(resolveSoftware(recipe, undefined, env as never)).rejects.toThrow("winget package");
});
