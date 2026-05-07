import * as os from "node:os";
import * as path from "node:path";
import { $which, isEnoent, logger } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComputerProfile {
	// Schema.org alignment
	"@context"?: "https://schema.org";
	"@type"?: "IndividualProduct";

	// Hardware identity
	name?: string;
	machineModel?: string;

	// Operating system
	platform?: string;
	osVersion?: string;
	osRelease?: string;
	architecture?: string;

	// CPU
	cpuModel?: string;
	cpuLogicalCores?: number;
	cpuPhysicalCores?: number;

	// Memory
	totalMemoryBytes?: number;
	totalMemoryGB?: number;

	// GPU
	gpu?: string;

	// Storage
	diskTotal?: string;
	diskFree?: string;

	// Display
	display?: string;

	// Environment
	hostname?: string;
	shell?: string;
	terminal?: string;

	// Dev tools found in PATH
	installedTools?: string[];

	// Management
	management?: ManagementStatus;

	// Security posture
	security?: SecurityPosture;

	// Endpoint security agents (active only)
	endpointAgents?: string[];

	// Meta
	collectedAt?: string;
}

export interface ComputerHint {
	ramGB: number;
	cpu: string;
	os: string;
	cores?: number;
	shell?: string;
	diskFree?: string;
	model?: string;
	managed?: boolean;
	admin?: boolean;
}

export interface ManagementStatus {
	isManaged: boolean;
	mdmVendor?: string;
	mdmVersion?: string;
	depEnrolled?: boolean;
	isSupervised?: boolean;
	userApproved?: boolean;
	organizationName?: string;
}

export interface SecurityPosture {
	sipEnabled?: boolean;
	fileVaultEnabled?: boolean;
	gatekeeperEnabled?: boolean;
	firewallEnabled?: boolean;
	isAdmin?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPUTER_PROFILE_PATH = path.join(os.homedir(), ".xcsh", "computer-profile.json");
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTerminalName(): string | undefined {
	const termProgram = Bun.env.TERM_PROGRAM;
	const termProgramVersion = Bun.env.TERM_PROGRAM_VERSION;
	if (termProgram) {
		return termProgramVersion ? `${termProgram} ${termProgramVersion}` : termProgram;
	}

	if (Bun.env.WT_SESSION) return "Windows Terminal";

	const term = Bun.env.TERM ?? Bun.env.COLORTERM ?? Bun.env.TERMINAL_EMULATOR;
	return term?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadComputerProfile(): Promise<ComputerProfile> {
	try {
		return (await Bun.file(COMPUTER_PROFILE_PATH).json()) as ComputerProfile;
	} catch (err: unknown) {
		if (isEnoent(err)) return {};
		logger.warn("Failed to load computer profile", { error: err });
		return {};
	}
}

export async function saveComputerProfile(profile: ComputerProfile): Promise<void> {
	profile.collectedAt = new Date().toISOString();
	await Bun.write(COMPUTER_PROFILE_PATH, JSON.stringify(profile, null, 2));
}

// ---------------------------------------------------------------------------
// collectInstant — fast, os module only, no subprocesses
// ---------------------------------------------------------------------------

export function collectInstant(): Partial<ComputerProfile> {
	const cpus = os.cpus();
	return {
		platform: os.platform(),
		osRelease: os.release(),
		architecture: os.arch(),
		cpuModel: cpus[0]?.model,
		cpuLogicalCores: cpus.length || undefined,
		totalMemoryBytes: os.totalmem(),
		totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3),
		hostname: os.hostname(),
		shell: Bun.env.SHELL ?? Bun.env.COMSPEC,
		terminal: getTerminalName(),
	};
}

// ---------------------------------------------------------------------------
// collectDeferred — slow, subprocess-based
// ---------------------------------------------------------------------------

async function collectDarwin(): Promise<Partial<ComputerProfile>> {
	const result: Partial<ComputerProfile> = {};

	const [modelRes, coresRes, versionRes] = await Promise.all([
		$`sysctl -n hw.model`.quiet().nothrow(),
		$`sysctl -n hw.physicalcpu`.quiet().nothrow(),
		$`sw_vers -productVersion`.quiet().nothrow(),
	]);

	if (modelRes.exitCode === 0) {
		result.machineModel = modelRes.stdout.toString().trim();
	}
	if (coresRes.exitCode === 0) {
		const parsed = parseInt(coresRes.stdout.toString().trim(), 10);
		if (!Number.isNaN(parsed)) result.cpuPhysicalCores = parsed;
	}
	if (versionRes.exitCode === 0) {
		result.osVersion = versionRes.stdout.toString().trim();
	}

	return result;
}

async function collectLinux(): Promise<Partial<ComputerProfile>> {
	const result: Partial<ComputerProfile> = {};

	try {
		const productName = await Bun.file("/sys/class/dmi/id/product_name").text();
		result.machineModel = productName.trim();
	} catch {
		// not available (containers, VMs, etc.)
	}

	try {
		const cpuinfo = await Bun.file("/proc/cpuinfo").text();
		const physicalIds = new Set<string>();
		for (const line of cpuinfo.split("\n")) {
			const match = line.match(/^physical id\s*:\s*(\d+)/);
			if (match) physicalIds.add(match[1]);
		}
		const coreLines = cpuinfo.split("\n").filter(l => l.startsWith("cpu cores"));
		if (coreLines.length > 0 && physicalIds.size > 0) {
			const coresPerSocket = parseInt(coreLines[0].split(":")[1].trim(), 10);
			if (!Number.isNaN(coresPerSocket)) {
				result.cpuPhysicalCores = coresPerSocket * physicalIds.size;
			}
		}
	} catch {
		// fallback: logical cores set by collectInstant
	}

	try {
		const releaseFile = await Bun.file("/etc/os-release").text();
		const versionMatch = releaseFile.match(/^VERSION_ID="?([^"\n]+)"?/m);
		if (versionMatch) result.osVersion = versionMatch[1];
	} catch {
		// not available
	}

	return result;
}

async function collectWindows(): Promise<Partial<ComputerProfile>> {
	const result: Partial<ComputerProfile> = {};

	try {
		const modelRes = await $`wmic computersystem get model /format:list`.quiet().nothrow();
		if (modelRes.exitCode === 0) {
			const match = modelRes.stdout.toString().match(/Model=(.+)/);
			if (match) result.machineModel = match[1].trim();
		}
	} catch {
		// wmic may not be available
	}

	try {
		const coresRes = await $`wmic cpu get NumberOfCores /format:list`.quiet().nothrow();
		if (coresRes.exitCode === 0) {
			const match = coresRes.stdout.toString().match(/NumberOfCores=(\d+)/);
			if (match) result.cpuPhysicalCores = parseInt(match[1], 10);
		}
	} catch {
		// wmic may not be available
	}

	return result;
}

async function collectDiskInfo(): Promise<Partial<ComputerProfile>> {
	if (process.platform === "win32") return {};

	try {
		const dfRes = await $`df -P /`.quiet().nothrow();
		if (dfRes.exitCode !== 0) return {};

		const lines = dfRes.stdout.toString().trim().split("\n");
		if (lines.length < 2) return {};

		const cols = lines[1].split(/\s+/);
		// Columns: Filesystem, 1024-blocks, Used, Available, Capacity, Mounted
		if (cols.length < 5) return {};

		const totalKB = parseInt(cols[1], 10);
		const availKB = parseInt(cols[3], 10);
		if (Number.isNaN(totalKB) || Number.isNaN(availKB)) return {};

		return {
			diskTotal: `${Math.round(totalKB / 1048576)}GB`,
			diskFree: `${Math.round(availKB / 1048576)}GB`,
		};
	} catch {
		return {};
	}
}

const TOOL_CANDIDATES = [
	"git",
	"docker",
	"kubectl",
	"terraform",
	"python3",
	"node",
	"go",
	"rustc",
	"java",
	"az",
	"gcloud",
	"aws",
	"sf",
	"gh",
	"glab",
] as const;

async function collectInstalledTools(): Promise<string[]> {
	const found: string[] = [];
	for (const tool of TOOL_CANDIDATES) {
		try {
			if ($which(tool)) found.push(tool);
		} catch {
			// skip
		}
	}
	return found;
}

/** Detect MDM vendor from profiles status output or binary presence. */
export function detectMdmVendor(profilesOutput: string): string | undefined {
	const lower = profilesOutput.toLowerCase();
	if (lower.includes("jamf")) return "Jamf";
	if (lower.includes("intune") || lower.includes("microsoft")) return "Intune";
	if (lower.includes("mosyle")) return "Mosyle";
	if (lower.includes("kandji")) return "Kandji";
	if (lower.includes("workspace one") || lower.includes("airwatch")) return "Workspace ONE";
	if (lower.includes("addigy")) return "Addigy";
	if (lower.includes("simplemdm")) return "SimpleMDM";
	if (lower.includes("hexnode")) return "Hexnode";
	return undefined;
}

async function collectManagement(): Promise<Partial<ComputerProfile>> {
	if (process.platform !== "darwin") {
		// Linux: check for Puppet, Chef, Salt, Ansible
		const agents = ["puppet", "chef-client", "salt-minion", "ansible"];
		for (const agent of agents) {
			if ($which(agent)) {
				return {
					management: { isManaged: true, mdmVendor: agent },
				};
			}
		}
		return { management: { isManaged: false } };
	}

	const mgmt: ManagementStatus = { isManaged: false };

	try {
		// profiles status -type enrollment (works without sudo)
		const profilesRes = await $`profiles status -type enrollment`.quiet().nothrow();
		if (profilesRes.exitCode === 0) {
			const output = profilesRes.stdout.toString();
			const mdmMatch = output.match(/MDM enrollment:\s*(Yes|No)/i);
			if (mdmMatch && mdmMatch[1].toLowerCase() === "yes") {
				mgmt.isManaged = true;
				mgmt.userApproved = output.includes("User Approved");
			}
			const depMatch = output.match(/Enrolled via DEP:\s*(Yes|No)/i);
			if (depMatch) mgmt.depEnrolled = depMatch[1].toLowerCase() === "yes";

			// Detect vendor from the profiles output line containing server URL (don't store URL itself)
			const serverLine = output.match(/MDM server:\s*(.+)/i);
			if (serverLine) {
				mgmt.mdmVendor = detectMdmVendor(serverLine[1]);
			}
		}
	} catch {
		/* non-fatal */
	}

	// Fallback vendor detection from binary presence
	if (!mgmt.mdmVendor) {
		if ($which("jamf") || $which("/usr/local/bin/jamf")) mgmt.mdmVendor = "Jamf";
	}

	// Jamf version if Jamf detected
	if (mgmt.mdmVendor === "Jamf") {
		try {
			const jamfRes = await $`jamf version`.quiet().nothrow();
			if (jamfRes.exitCode === 0) {
				const verMatch = jamfRes.stdout.toString().match(/version=([\d.]+)/);
				if (verMatch) mgmt.mdmVersion = verMatch[1];
			}
		} catch {
			/* non-fatal */
		}
	}

	// mdmclient DumpManagementStatus for supervised + org name
	if (mgmt.isManaged) {
		try {
			const mdmRes = await $`/usr/libexec/mdmclient DumpManagementStatus`.quiet().nothrow();
			if (mdmRes.exitCode === 0) {
				const mdmOutput = mdmRes.stdout.toString();
				if (mdmOutput.includes("DeviceIsSupervised = 1")) mgmt.isSupervised = true;
				const orgMatch = mdmOutput.match(/OrganizationName\s*=\s*"?([^"\n;]+)"?/);
				if (orgMatch) mgmt.organizationName = orgMatch[1].trim();
			}
		} catch {
			/* non-fatal */
		}
	}

	return { management: mgmt };
}

async function collectSecurity(): Promise<Partial<ComputerProfile>> {
	const sec: SecurityPosture = {};

	// Cross-platform: admin check
	if (process.platform === "win32") {
		try {
			const res = await $`net localgroup Administrators`.quiet().nothrow();
			const user = Bun.env.USERNAME ?? "";
			sec.isAdmin = res.exitCode === 0 && res.stdout.toString().includes(user);
		} catch {
			/* non-fatal */
		}
	} else {
		try {
			const res = await $`id -Gn`.quiet().nothrow();
			if (res.exitCode === 0) {
				const groups = res.stdout.toString().trim().split(/\s+/);
				sec.isAdmin = groups.includes("admin") || groups.includes("wheel") || groups.includes("root");
			}
		} catch {
			/* non-fatal */
		}
	}

	if (process.platform !== "darwin") return { security: sec };

	// macOS-specific security probes (parallel)
	const [sipRes, fvRes, gkRes, fwRes] = await Promise.all([
		$`csrutil status`.quiet().nothrow(),
		$`fdesetup status`.quiet().nothrow(),
		$`spctl --status`.quiet().nothrow(),
		$`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`.quiet().nothrow(),
	]);

	if (sipRes.exitCode === 0) {
		sec.sipEnabled = sipRes.stdout.toString().includes("enabled");
	}
	if (fvRes.exitCode === 0) {
		sec.fileVaultEnabled = fvRes.stdout.toString().toLowerCase().includes("on");
	}
	if (gkRes.exitCode === 0) {
		sec.gatekeeperEnabled = gkRes.stdout.toString().includes("assessments enabled");
	}
	if (fwRes.exitCode === 0) {
		sec.firewallEnabled = fwRes.stdout.toString().toLowerCase().includes("enabled");
	}

	return { security: sec };
}

async function collectEndpointAgents(): Promise<string[]> {
	if (process.platform !== "darwin") {
		// Linux: check for common agent binaries
		const linuxAgents: Array<[string, string]> = [
			["falconctl", "CrowdStrike Falcon"],
			["mdatp", "Microsoft Defender"],
			["carbonblack", "Carbon Black"],
		];
		const found: string[] = [];
		for (const [bin, name] of linuxAgents) {
			if ($which(bin)) found.push(name);
		}
		return found;
	}

	// macOS: parse systemextensionsctl list
	try {
		const res = await $`systemextensionsctl list`.quiet().nothrow();
		if (res.exitCode !== 0) return [];

		const output = res.stdout.toString();
		const agents = new Set<string>();

		for (const line of output.split("\n")) {
			// Only consider activated enabled extensions
			if (!line.includes("[activated enabled]")) continue;

			// Extract the human-readable name before the [state] bracket
			const nameMatch = line.match(/\)\s+(.+?)\s+\[activated enabled\]/);
			if (nameMatch) {
				agents.add(nameMatch[1].trim());
			}
		}

		return Array.from(agents);
	} catch {
		return [];
	}
}

async function collectDeferred(): Promise<Partial<ComputerProfile>> {
	const [platformData, diskData, managementData, securityData, agents, tools] = await Promise.all([
		process.platform === "darwin"
			? collectDarwin()
			: process.platform === "linux"
				? collectLinux()
				: process.platform === "win32"
					? collectWindows()
					: Promise.resolve({}),
		collectDiskInfo(),
		collectManagement().catch(() => ({}) as Partial<ComputerProfile>),
		collectSecurity().catch(() => ({}) as Partial<ComputerProfile>),
		collectEndpointAgents().catch(() => [] as string[]),
		collectInstalledTools(),
	]);

	return {
		...platformData,
		...diskData,
		...managementData,
		...securityData,
		...(agents.length > 0 ? { endpointAgents: agents } : {}),
		...(tools.length > 0 ? { installedTools: tools } : {}),
	};
}

// ---------------------------------------------------------------------------
// seedComputerProfile — full collection + save
// ---------------------------------------------------------------------------

export async function seedComputerProfile(): Promise<ComputerProfile> {
	const existing = await loadComputerProfile();
	const instant = collectInstant();
	const deferred = await collectDeferred();

	const merged: ComputerProfile = {
		"@context": "https://schema.org",
		"@type": "IndividualProduct",
		...existing,
		...instant,
		...deferred,
	};

	await saveComputerProfile(merged);
	return merged;
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

export function computerProfileIsStale(profile: ComputerProfile): boolean {
	if (!profile.collectedAt) return true;
	const age = Date.now() - new Date(profile.collectedAt).getTime();
	return age > STALE_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// buildComputerHint — compact hint for system prompt
// ---------------------------------------------------------------------------

export function buildComputerHint(profile: ComputerProfile): ComputerHint | undefined {
	if (!profile.totalMemoryGB) return undefined;
	return {
		ramGB: profile.totalMemoryGB,
		cpu: profile.cpuModel ?? "unknown",
		os: [profile.platform, profile.osVersion ?? profile.osRelease].filter(Boolean).join(" "),
		cores: profile.cpuLogicalCores,
		shell: profile.shell ? path.basename(profile.shell) : undefined,
		diskFree: profile.diskFree,
		model: profile.machineModel,
		managed: profile.management?.isManaged,
		admin: profile.security?.isAdmin,
	};
}

// ---------------------------------------------------------------------------
// renderComputerProfileMarkdown — full markdown for xcsh://computer
// ---------------------------------------------------------------------------

export function renderComputerProfileMarkdown(profile: ComputerProfile): string {
	const sections: string[] = [];

	sections.push("# Computer Profile\n");

	const isEmpty = !profile.platform && !profile.cpuModel && !profile.totalMemoryGB && !profile.hostname;
	if (isEmpty) {
		sections.push("No computer profile yet. Use `xcsh://computer?refresh=true` to collect.\n");
		return sections.join("\n");
	}

	// Hardware
	const hwLines: string[] = [];
	if (profile.machineModel) hwLines.push(`- **Model:** ${profile.machineModel}`);
	if (profile.architecture) hwLines.push(`- **Architecture:** ${profile.architecture}`);
	if (hwLines.length > 0) {
		sections.push("## Hardware\n");
		sections.push(hwLines.join("\n"));
	}

	// Operating System
	const osLines: string[] = [];
	if (profile.platform) osLines.push(`- **Platform:** ${profile.platform}`);
	if (profile.osVersion) osLines.push(`- **Version:** ${profile.osVersion}`);
	if (profile.osRelease) osLines.push(`- **Kernel:** ${profile.osRelease}`);
	if (osLines.length > 0) {
		sections.push("\n## Operating System\n");
		sections.push(osLines.join("\n"));
	}

	// CPU
	const cpuLines: string[] = [];
	if (profile.cpuModel) cpuLines.push(`- **Model:** ${profile.cpuModel}`);
	if (profile.cpuLogicalCores) cpuLines.push(`- **Logical Cores:** ${profile.cpuLogicalCores}`);
	if (profile.cpuPhysicalCores) cpuLines.push(`- **Physical Cores:** ${profile.cpuPhysicalCores}`);
	if (cpuLines.length > 0) {
		sections.push("\n## CPU\n");
		sections.push(cpuLines.join("\n"));
	}

	// Memory
	if (profile.totalMemoryGB) {
		sections.push("\n## Memory\n");
		sections.push(`- **Total:** ${profile.totalMemoryGB} GB`);
	}

	// Storage
	const storageLines: string[] = [];
	if (profile.diskTotal) storageLines.push(`- **Total:** ${profile.diskTotal}`);
	if (profile.diskFree) storageLines.push(`- **Free:** ${profile.diskFree}`);
	if (storageLines.length > 0) {
		sections.push("\n## Storage\n");
		sections.push(storageLines.join("\n"));
	}

	// Environment
	const envLines: string[] = [];
	if (profile.hostname) envLines.push(`- **Hostname:** ${profile.hostname}`);
	if (profile.shell) envLines.push(`- **Shell:** ${profile.shell}`);
	if (profile.terminal) envLines.push(`- **Terminal:** ${profile.terminal}`);
	if (envLines.length > 0) {
		sections.push("\n## Environment\n");
		sections.push(envLines.join("\n"));
	}

	// Management
	if (profile.management) {
		const mgmtLines: string[] = [];
		mgmtLines.push(`- **Managed:** ${profile.management.isManaged ? "Yes" : "No"}`);
		if (profile.management.mdmVendor)
			mgmtLines.push(
				`- **MDM:** ${profile.management.mdmVendor}${profile.management.mdmVersion ? ` v${profile.management.mdmVersion}` : ""}`,
			);
		if (profile.management.depEnrolled) mgmtLines.push(`- **DEP Enrolled:** Yes`);
		if (profile.management.isSupervised) mgmtLines.push(`- **Supervised:** Yes`);
		if (profile.management.userApproved) mgmtLines.push(`- **User Approved:** Yes`);
		if (profile.management.organizationName)
			mgmtLines.push(`- **Organization:** ${profile.management.organizationName}`);
		if (mgmtLines.length > 0) {
			sections.push("\n## Management\n");
			sections.push(mgmtLines.join("\n"));
		}
	}

	// Security
	if (profile.security) {
		const secLines: string[] = [];
		if (profile.security.sipEnabled !== undefined)
			secLines.push(`- **SIP:** ${profile.security.sipEnabled ? "Enabled" : "Disabled"}`);
		if (profile.security.fileVaultEnabled !== undefined)
			secLines.push(`- **FileVault:** ${profile.security.fileVaultEnabled ? "On" : "Off"}`);
		if (profile.security.gatekeeperEnabled !== undefined)
			secLines.push(`- **Gatekeeper:** ${profile.security.gatekeeperEnabled ? "Enabled" : "Disabled"}`);
		if (profile.security.firewallEnabled !== undefined)
			secLines.push(`- **Firewall:** ${profile.security.firewallEnabled ? "Enabled" : "Disabled"}`);
		if (profile.security.isAdmin !== undefined)
			secLines.push(`- **Admin:** ${profile.security.isAdmin ? "Yes" : "No"}`);
		if (secLines.length > 0) {
			sections.push("\n## Security\n");
			sections.push(secLines.join("\n"));
		}
	}

	// Endpoint Agents
	if (profile.endpointAgents && profile.endpointAgents.length > 0) {
		sections.push("\n## Endpoint Security\n");
		sections.push(profile.endpointAgents.map(a => `- ${a}`).join("\n"));
	}

	// Dev Tools
	if (profile.installedTools && profile.installedTools.length > 0) {
		sections.push("\n## Dev Tools\n");
		sections.push(profile.installedTools.join(", "));
	}

	// Footer
	if (profile.collectedAt) {
		sections.push(`\n\n---\n*Collected: ${profile.collectedAt}*`);
	}

	return sections.join("\n");
}
