import { $which } from "@f5-sales-demo/pi-utils";
import { runCli } from "../person-profile/collectors";
import type { ManagementStatus } from "../person-profile/machine-profile";

export type HostManagement = "managed" | "unmanaged" | "unknown";
export interface ManagementProbe {
	status: HostManagement;
	details: ManagementStatus;
}
export function detectMdmVendor(output: string): string | undefined {
	const names: [RegExp, string][] = [
		[/jamf/i, "Jamf"],
		[/intune|microsoft/i, "Intune"],
		[/mosyle/i, "Mosyle"],
		[/kandji/i, "Kandji"],
		[/workspace one|airwatch/i, "Workspace ONE"],
		[/addigy/i, "Addigy"],
		[/simplemdm/i, "SimpleMDM"],
		[/hexnode/i, "Hexnode"],
	];
	return names.find(([pattern]) => pattern.test(output))?.[1];
}
export function parseEnrollment(code: number, output: string): ManagementProbe {
	if (code !== 0) return { status: "unknown", details: {} };
	const match = output.match(/MDM enrollment:\s*(Yes|No)\b/i);
	if (!match) return { status: "unknown", details: {} };
	const managed = match[1].toLowerCase() === "yes";
	const dep = output.match(/Enrolled via DEP:\s*(Yes|No)/i);
	return {
		status: managed ? "managed" : "unmanaged",
		details: {
			isManaged: managed,
			...(managed ? { userApproved: output.includes("User Approved") } : {}),
			...(dep ? { depEnrolled: dep[1].toLowerCase() === "yes" } : {}),
			...(detectMdmVendor(output) ? { mdmVendor: detectMdmVendor(output) } : {}),
		},
	};
}
export async function probeManagement(signal?: AbortSignal, platform = process.platform): Promise<ManagementProbe> {
	if (platform !== "darwin") {
		// Absence of an agent is not evidence that a host is unmanaged.
		if (platform === "linux")
			for (const agent of ["puppet", "chef-client", "salt-minion", "ansible"]) {
				if ($which(agent)) return { status: "managed", details: { isManaged: true, mdmVendor: agent } };
			}
		return { status: "unknown", details: {} };
	}
	const result = await runCli(["profiles", "status", "-type", "enrollment"], undefined, signal);
	const probe = parseEnrollment(result.exitCode, result.stdout);
	if (!probe.details.mdmVendor && ($which("jamf") || $which("/usr/local/bin/jamf"))) probe.details.mdmVendor = "Jamf";
	if (probe.details.mdmVendor === "Jamf") {
		const version = await runCli(["jamf", "version"], undefined, signal);
		if (version.exitCode === 0) probe.details.mdmVersion = version.stdout.match(/version=([\d.]+)/)?.[1];
	}
	if (probe.status === "managed") {
		const mdm = await runCli(["/usr/libexec/mdmclient", "DumpManagementStatus"], undefined, signal);
		if (mdm.exitCode === 0) {
			if (mdm.stdout.includes("DeviceIsSupervised = 1")) probe.details.isSupervised = true;
			probe.details.organizationName = mdm.stdout.match(/OrganizationName\s*=\s*"?([^"\n;]+)"?/)?.[1]?.trim();
		}
	}
	return probe;
}
