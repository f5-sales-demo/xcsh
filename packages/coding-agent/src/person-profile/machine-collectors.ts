import * as os from "node:os";
import { $which } from "@f5-sales-demo/pi-utils";
import { runCli } from "./collectors";
import type { MachineFacts, ManagementStatus, SecurityPosture } from "./machine-profile";

// Adapted from the historical computer collector. All subprocesses are now bounded and cancellable.
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

export function collectInstant(): Partial<MachineFacts> {
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

async function collectDarwin(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	const result: Partial<MachineFacts> = {};

	const [modelRes, coresRes, versionRes] = await Promise.all([
		runCli(["sysctl", "-n", "hw.model"], undefined, signal),
		runCli(["sysctl", "-n", "hw.physicalcpu"], undefined, signal),
		runCli(["sw_vers", "-productVersion"], undefined, signal),
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

async function collectLinux(_signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	const result: Partial<MachineFacts> = {};

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

async function collectWindows(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	const result: Partial<MachineFacts> = {};

	try {
		const modelRes = await runCli(["wmic", "computersystem", "get", "model", "/format:list"], undefined, signal);
		if (modelRes.exitCode === 0) {
			const match = modelRes.stdout.toString().match(/Model=(.+)/);
			if (match) result.machineModel = match[1].trim();
		}
	} catch {
		// wmic may not be available
	}

	try {
		const coresRes = await runCli(["wmic", "cpu", "get", "NumberOfCores", "/format:list"], undefined, signal);
		if (coresRes.exitCode === 0) {
			const match = coresRes.stdout.toString().match(/NumberOfCores=(\d+)/);
			if (match) result.cpuPhysicalCores = parseInt(match[1], 10);
		}
	} catch {
		// wmic may not be available
	}

	return result;
}

async function collectDiskInfo(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	if (process.platform === "win32") return {};

	try {
		const dfRes = await runCli(["df", "-P", "/"], undefined, signal);
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

async function collectManagement(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
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
		const profilesRes = await runCli(["profiles", "status", "-type", "enrollment"], undefined, signal);
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
			const jamfRes = await runCli(["jamf", "version"], undefined, signal);
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
			const mdmRes = await runCli(["/usr/libexec/mdmclient", "DumpManagementStatus"], undefined, signal);
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

async function collectSecurity(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	const sec: SecurityPosture = {};

	// Cross-platform: admin check
	if (process.platform === "win32") {
		try {
			const res = await runCli(["net", "localgroup", "Administrators"], undefined, signal);
			const user = Bun.env.USERNAME ?? "";
			sec.isAdmin = res.exitCode === 0 && res.stdout.toString().includes(user);
		} catch {
			/* non-fatal */
		}
	} else {
		try {
			const res = await runCli(["id", "-Gn"], undefined, signal);
			if (res.exitCode === 0) {
				const groups = res.stdout.toString().trim().split(/\s+/);
				sec.isAdmin =
					groups.includes("admin") ||
					groups.includes("wheel") ||
					groups.includes("sudo") ||
					groups.includes("root");
			}
		} catch {
			/* non-fatal */
		}
	}

	if (process.platform !== "darwin") return { security: sec };

	// macOS-specific security probes (parallel)
	const [sipRes, fvRes, gkRes, fwRes] = await Promise.all([
		runCli(["csrutil", "status"], undefined, signal),
		runCli(["fdesetup", "status"], undefined, signal),
		runCli(["spctl", "--status"], undefined, signal),
		runCli(["/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"], undefined, signal),
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

async function collectEndpointAgents(signal?: AbortSignal): Promise<string[]> {
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
		const res = await runCli(["systemextensionsctl", "list"], undefined, signal);
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

export async function collectDeferred(signal?: AbortSignal): Promise<Partial<MachineFacts>> {
	const [platformData, diskData, managementData, securityData, agents, tools] = await Promise.all([
		process.platform === "darwin"
			? collectDarwin(signal)
			: process.platform === "linux"
				? collectLinux(signal)
				: process.platform === "win32"
					? collectWindows(signal)
					: Promise.resolve({}),
		collectDiskInfo(signal),
		collectManagement(signal).catch(() => ({}) as Partial<MachineFacts>),
		collectSecurity(signal).catch(() => ({}) as Partial<MachineFacts>),
		collectEndpointAgents(signal).catch(() => [] as string[]),
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

export async function collectMachine(signal?: AbortSignal): Promise<MachineFacts> {
	return { ...collectInstant(), ...(await collectDeferred(signal)) };
}
