import { describe, expect, it } from "bun:test";
import {
	buildComputerHint,
	type ComputerProfile,
	collectInstant,
	computerProfileIsStale,
	detectMdmVendor,
	loadComputerProfile,
	renderComputerProfileMarkdown,
	saveComputerProfile,
} from "../../src/internal-urls/computer-profile";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fakeProfile: ComputerProfile = {
	totalMemoryGB: 32,
	cpuModel: "Test CPU 3000",
	platform: "testOS",
	osVersion: "99.0",
	osRelease: "5.15.0",
	cpuLogicalCores: 8,
	shell: "/bin/test-shell",
	diskFree: "100GB",
	machineModel: "TestModel/1",
};

const fullProfile: ComputerProfile = {
	"@context": "https://schema.org",
	"@type": "IndividualProduct",
	name: "test-host",
	machineModel: "TestModel/1",
	platform: "testOS",
	osVersion: "99.0",
	osRelease: "5.15.0",
	architecture: "test64",
	cpuModel: "Test CPU 3000",
	cpuLogicalCores: 8,
	cpuPhysicalCores: 4,
	totalMemoryBytes: 34_359_738_368,
	totalMemoryGB: 32,
	gpu: "Test GPU 9000",
	diskTotal: "500GB",
	diskFree: "100GB",
	display: "3840x2160",
	hostname: "test-host",
	shell: "/bin/test-shell",
	terminal: "TestTerm 1.0",
	installedTools: ["git", "docker", "node"],
	collectedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// collectInstant
// ---------------------------------------------------------------------------

describe("collectInstant", () => {
	it("returns platform from os.platform()", () => {
		const result = collectInstant();
		expect(result.platform).toBeString();
		expect(result.platform!.length).toBeGreaterThan(0);
	});

	it("returns totalMemoryGB as a rounded integer", () => {
		const result = collectInstant();
		expect(result.totalMemoryGB).toBeNumber();
		expect(Number.isInteger(result.totalMemoryGB)).toBe(true);
		expect(result.totalMemoryGB!).toBeGreaterThan(0);
	});

	it("returns cpuModel from os.cpus()[0]", () => {
		const result = collectInstant();
		expect(result.cpuModel).toBeString();
		expect(result.cpuModel!.length).toBeGreaterThan(0);
	});

	it("returns shell from SHELL env variable", () => {
		const result = collectInstant();
		// SHELL is set on macOS/Linux; COMSPEC on Windows
		if (Bun.env.SHELL || Bun.env.COMSPEC) {
			expect(result.shell).toBeString();
		} else {
			expect(result.shell).toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// buildComputerHint
// ---------------------------------------------------------------------------

describe("buildComputerHint", () => {
	it("returns undefined when totalMemoryGB is missing", () => {
		expect(buildComputerHint({})).toBeUndefined();
	});

	it("returns undefined when totalMemoryGB is 0", () => {
		expect(buildComputerHint({ totalMemoryGB: 0 })).toBeUndefined();
	});

	it("returns a hint with required fields when profile is populated", () => {
		const hint = buildComputerHint(fakeProfile);
		expect(hint).toBeDefined();
		expect(hint!.ramGB).toBe(32);
		expect(hint!.cpu).toBe("Test CPU 3000");
		expect(hint!.os).toContain("testOS");
		expect(hint!.cores).toBe(8);
		expect(hint!.diskFree).toBe("100GB");
		expect(hint!.model).toBe("TestModel/1");
	});

	it("extracts shell basename from full path", () => {
		const hint = buildComputerHint(fakeProfile);
		expect(hint!.shell).toBe("test-shell");
	});

	it("omits optional fields when not present", () => {
		const hint = buildComputerHint({ totalMemoryGB: 16 });
		expect(hint).toBeDefined();
		expect(hint!.ramGB).toBe(16);
		expect(hint!.cpu).toBe("unknown");
		expect(hint!.cores).toBeUndefined();
		expect(hint!.shell).toBeUndefined();
		expect(hint!.diskFree).toBeUndefined();
		expect(hint!.model).toBeUndefined();
	});

	it("joins platform and osVersion for os field", () => {
		const hint = buildComputerHint(fakeProfile);
		expect(hint!.os).toBe("testOS 99.0");
	});
});

// ---------------------------------------------------------------------------
// computerProfileIsStale
// ---------------------------------------------------------------------------

describe("computerProfileIsStale", () => {
	it("returns true when collectedAt is missing", () => {
		expect(computerProfileIsStale({})).toBe(true);
	});

	it("returns true when collectedAt is older than 24 hours", () => {
		const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		expect(computerProfileIsStale({ collectedAt: old })).toBe(true);
	});

	it("returns false when collectedAt is recent", () => {
		const recent = new Date().toISOString();
		expect(computerProfileIsStale({ collectedAt: recent })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// renderComputerProfileMarkdown
// ---------------------------------------------------------------------------

describe("renderComputerProfileMarkdown", () => {
	it("shows empty message when profile is empty", () => {
		const md = renderComputerProfileMarkdown({});
		expect(md).toContain("No computer profile yet");
		expect(md).toContain("xcsh://computer?refresh=true");
	});

	it("renders hardware section with model and architecture", () => {
		const md = renderComputerProfileMarkdown({
			machineModel: "TestModel/1",
			architecture: "test64",
			platform: "testOS",
		});
		expect(md).toContain("## Hardware");
		expect(md).toContain("TestModel/1");
		expect(md).toContain("test64");
	});

	it("renders all sections for a fully populated profile", () => {
		const md = renderComputerProfileMarkdown(fullProfile);
		expect(md).toContain("## Hardware");
		expect(md).toContain("## Operating System");
		expect(md).toContain("## CPU");
		expect(md).toContain("## Memory");
		expect(md).toContain("## Storage");
		expect(md).toContain("## Environment");
		expect(md).toContain("## Dev Tools");
		expect(md).toContain("Test CPU 3000");
		expect(md).toContain("32 GB");
		expect(md).toContain("test-host");
	});

	it("renders dev tools as comma-separated list", () => {
		const md = renderComputerProfileMarkdown(fullProfile);
		expect(md).toContain("git, docker, node");
	});
});

// ---------------------------------------------------------------------------
// loadComputerProfile
// ---------------------------------------------------------------------------

describe("loadComputerProfile", () => {
	it("returns an object (empty or populated) without throwing", async () => {
		const profile = await loadComputerProfile();
		expect(typeof profile).toBe("object");
		expect(profile).not.toBeNull();
	});

	it("returns a value assignable to ComputerProfile", async () => {
		const profile: ComputerProfile = await loadComputerProfile();
		// If the file exists it has fields; if not it's {}. Both are valid.
		if (profile.platform) {
			expect(profile.platform).toBeString();
		}
	});
});

// ---------------------------------------------------------------------------
// ManagementStatus and SecurityPosture
// ---------------------------------------------------------------------------

describe("ManagementStatus and SecurityPosture types", () => {
	it("buildComputerHint includes managed flag when management present", () => {
		const profile: ComputerProfile = {
			totalMemoryGB: 16,
			cpuModel: "Test CPU",
			platform: "darwin",
			management: { isManaged: true, mdmVendor: "TestMDM" },
			security: { isAdmin: false },
		};
		const hint = buildComputerHint(profile);
		expect(hint).toBeDefined();
		expect(hint!.managed).toBe(true);
		expect(hint!.admin).toBe(false);
	});

	it("buildComputerHint omits managed when management absent", () => {
		const profile: ComputerProfile = {
			totalMemoryGB: 32,
			cpuModel: "Test CPU",
			platform: "testOS",
		};
		const hint = buildComputerHint(profile);
		expect(hint).toBeDefined();
		expect(hint!.managed).toBeUndefined();
		expect(hint!.admin).toBeUndefined();
	});

	it("renderComputerProfileMarkdown includes Management section", () => {
		const profile: ComputerProfile = {
			platform: "darwin",
			cpuModel: "Test CPU",
			totalMemoryGB: 32,
			management: {
				isManaged: true,
				mdmVendor: "TestMDM",
				mdmVersion: "1.0.0",
				depEnrolled: true,
				isSupervised: true,
				userApproved: true,
				organizationName: "TestOrg",
			},
		};
		const md = renderComputerProfileMarkdown(profile);
		expect(md).toContain("## Management");
		expect(md).toContain("TestMDM");
		expect(md).toContain("TestOrg");
		expect(md).toContain("DEP Enrolled");
		expect(md).toContain("Supervised");
	});

	it("renderComputerProfileMarkdown includes Security section", () => {
		const profile: ComputerProfile = {
			platform: "darwin",
			cpuModel: "Test CPU",
			totalMemoryGB: 16,
			security: {
				sipEnabled: true,
				fileVaultEnabled: true,
				gatekeeperEnabled: true,
				firewallEnabled: true,
				isAdmin: false,
			},
		};
		const md = renderComputerProfileMarkdown(profile);
		expect(md).toContain("## Security");
		expect(md).toContain("SIP");
		expect(md).toContain("FileVault");
		expect(md).toContain("Gatekeeper");
		expect(md).toContain("Admin");
	});

	it("renderComputerProfileMarkdown includes Endpoint Security section", () => {
		const profile: ComputerProfile = {
			platform: "darwin",
			cpuModel: "Test CPU",
			totalMemoryGB: 8,
			endpointAgents: ["Test Agent Alpha", "Test Agent Beta"],
		};
		const md = renderComputerProfileMarkdown(profile);
		expect(md).toContain("## Endpoint Security");
		expect(md).toContain("Test Agent Alpha");
		expect(md).toContain("Test Agent Beta");
	});

	it("renderComputerProfileMarkdown omits Management section when not managed", () => {
		const profile: ComputerProfile = {
			platform: "darwin",
			cpuModel: "Test CPU",
			totalMemoryGB: 16,
		};
		const md = renderComputerProfileMarkdown(profile);
		expect(md).not.toContain("## Management");
		expect(md).not.toContain("## Security");
		expect(md).not.toContain("## Endpoint Security");
	});

	it("buildComputerHint admin true when isAdmin true", () => {
		const profile: ComputerProfile = {
			totalMemoryGB: 16,
			cpuModel: "Test CPU",
			platform: "darwin",
			security: { isAdmin: true },
		};
		const hint = buildComputerHint(profile);
		expect(hint).toBeDefined();
		expect(hint!.admin).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// detectMdmVendor
// ---------------------------------------------------------------------------

describe("detectMdmVendor", () => {
	it("detects Jamf from URL containing jamf", () => {
		expect(detectMdmVendor("https://jamf.example.com:8443/mdm/ServerURL")).toBe("Jamf");
	});
	it("detects Intune from URL containing intune", () => {
		expect(detectMdmVendor("https://manage.intune.microsoft.com")).toBe("Intune");
	});
	it("detects Intune from URL containing microsoft", () => {
		expect(detectMdmVendor("https://mdm.microsoft.com/enroll")).toBe("Intune");
	});
	it("detects Mosyle from URL containing mosyle", () => {
		expect(detectMdmVendor("https://mosyle.example.com/mdm")).toBe("Mosyle");
	});
	it("detects Kandji from URL containing kandji", () => {
		expect(detectMdmVendor("https://kandji.io/mdm/enroll")).toBe("Kandji");
	});
	it("detects Workspace ONE from airwatch URL", () => {
		expect(detectMdmVendor("https://ds123.awmdm.com/airwatch")).toBe("Workspace ONE");
	});
	it("detects SimpleMDM from URL", () => {
		expect(detectMdmVendor("https://a.simplemdm.com/mdm")).toBe("SimpleMDM");
	});
	it("returns undefined for unknown URL", () => {
		expect(detectMdmVendor("https://custom-mdm.internal.corp/enroll")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// buildComputerHint edge cases
// ---------------------------------------------------------------------------

describe("buildComputerHint edge cases", () => {
	it("uses osRelease when osVersion is missing", () => {
		const hint = buildComputerHint({ totalMemoryGB: 8, platform: "linux", osRelease: "5.15.0" });
		expect(hint!.os).toBe("linux 5.15.0");
	});

	it("prefers osVersion over osRelease", () => {
		const hint = buildComputerHint({ totalMemoryGB: 8, platform: "darwin", osVersion: "26.3", osRelease: "25.3.0" });
		expect(hint!.os).toBe("macOS 26.3");
	});

	it("returns just platform when both version fields missing", () => {
		const hint = buildComputerHint({ totalMemoryGB: 8, platform: "darwin" });
		expect(hint!.os).toBe("macOS");
	});

	it("returns empty os when platform is missing", () => {
		const hint = buildComputerHint({ totalMemoryGB: 8 });
		expect(hint!.os).toBe("");
	});

	it("shell is undefined when shell path is missing", () => {
		const hint = buildComputerHint({ totalMemoryGB: 8 });
		expect(hint!.shell).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// renderComputerProfileMarkdown edge cases
// ---------------------------------------------------------------------------

describe("renderComputerProfileMarkdown edge cases", () => {
	it("renders Security section with all flags false", () => {
		const md = renderComputerProfileMarkdown({
			platform: "darwin",
			totalMemoryGB: 8,
			security: {
				sipEnabled: false,
				fileVaultEnabled: false,
				gatekeeperEnabled: false,
				firewallEnabled: false,
				isAdmin: false,
			},
		});
		expect(md).toContain("SIP:** Disabled");
		expect(md).toContain("FileVault:** Off");
		expect(md).toContain("Gatekeeper:** Disabled");
		expect(md).toContain("Firewall:** Disabled");
		expect(md).toContain("Admin:** No");
	});

	it("renders Management section with isManaged=false", () => {
		const md = renderComputerProfileMarkdown({
			platform: "darwin",
			totalMemoryGB: 8,
			management: { isManaged: false },
		});
		expect(md).toContain("## Management");
		expect(md).toContain("Managed:** No");
	});

	it("omits MDM fields when isManaged but no vendor", () => {
		const md = renderComputerProfileMarkdown({
			platform: "darwin",
			totalMemoryGB: 8,
			management: { isManaged: true },
		});
		expect(md).toContain("Managed:** Yes");
		expect(md).not.toContain("MDM:");
	});

	it("renders collectedAt footer when present", () => {
		const md = renderComputerProfileMarkdown({
			platform: "darwin",
			totalMemoryGB: 8,
			collectedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(md).toContain("Collected: 2026-01-01");
	});

	it("omits collectedAt footer when missing", () => {
		const md = renderComputerProfileMarkdown({ platform: "darwin", totalMemoryGB: 8 });
		expect(md).not.toContain("Collected:");
	});

	it("handles profile with only memory (minimal non-empty)", () => {
		const md = renderComputerProfileMarkdown({ totalMemoryGB: 16 });
		expect(md).toContain("## Memory");
		expect(md).toContain("16 GB");
		expect(md).not.toContain("No computer profile yet");
	});
});

// ---------------------------------------------------------------------------
// saveComputerProfile
// ---------------------------------------------------------------------------

describe("saveComputerProfile", () => {
	it("sets collectedAt on the profile", async () => {
		const profile: ComputerProfile = { platform: "test" };
		await saveComputerProfile(profile);
		expect(profile.collectedAt).toBeString();
		expect(new Date(profile.collectedAt!).getTime()).toBeGreaterThan(Date.now() - 5000);
	});

	it("round-trips through load", async () => {
		await saveComputerProfile({ platform: "round-trip-test", totalMemoryGB: 99 });
		const loaded = await loadComputerProfile();
		expect(loaded.platform).toBe("round-trip-test");
		expect(loaded.totalMemoryGB).toBe(99);
	});
});

// ---------------------------------------------------------------------------
// seedComputerProfile integration
// ---------------------------------------------------------------------------

describe("seedComputerProfile integration", () => {
	it("returns a profile with at least platform and totalMemoryGB", async () => {
		const { seedComputerProfile } = await import("../../src/internal-urls/computer-profile");
		const profile = await seedComputerProfile();
		expect(profile.platform).toBeString();
		expect(profile.totalMemoryGB).toBeGreaterThan(0);
		expect(profile.collectedAt).toBeString();
	});

	it("persists result that loadComputerProfile can read", async () => {
		const loaded = await loadComputerProfile();
		expect(loaded.platform).toBeString();
		expect(loaded.collectedAt).toBeString();
	});
});
