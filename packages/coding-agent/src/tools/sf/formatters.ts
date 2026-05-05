import type { SfOrg, SfQueryResult, SfUserProfile } from "./types";

export function formatOrgTable(orgs: SfOrg[]): string {
	if (orgs.length === 0) {
		return "No authenticated orgs found.";
	}

	const header = "| Alias | Username | Org ID | Instance | Status |";
	const divider = "|-------|----------|--------|----------|--------|";

	const rows = orgs.map(org => {
		const alias = org.alias
			? org.isDefault
				? `${org.alias} (default)`
				: org.alias
			: org.isDefault
				? "(none) (default)"
				: "(none)";
		return `| ${alias} | ${org.username} | ${org.orgId} | ${org.instanceUrl} | ${org.connectedStatus} |`;
	});

	return [header, divider, ...rows].join("\n");
}

export function formatOrgDetail(org: SfOrg): string {
	const lines: string[] = [];

	lines.push(`**${org.alias || org.username}**`);
	lines.push(`Username: ${org.username}`);
	lines.push(`Org ID: ${org.orgId}`);
	lines.push(`Instance: ${org.instanceUrl}`);
	lines.push(`Status: ${org.connectedStatus}`);

	if (org.isDefault) {
		lines.push("Default: yes");
	}

	if (org.isSandbox) {
		lines.push("Type: Sandbox");
	}

	return lines.join("\n");
}

export function flattenRecord(record: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(record)) {
		if (key === "attributes") {
			continue;
		}

		if (value === null) {
			continue;
		}

		if (typeof value === "object" && !Array.isArray(value)) {
			const nested = value as Record<string, unknown>;
			for (const [nestedKey, nestedValue] of Object.entries(nested)) {
				if (nestedKey === "attributes") {
					continue;
				}
				result[`${key}.${nestedKey}`] = nestedValue;
			}
			continue;
		}

		result[key] = value;
	}

	return result;
}

export function formatQueryResults(result: SfQueryResult): string {
	if (result.records.length === 0) {
		return "No records found.";
	}

	const flatRecords = result.records.map(r => flattenRecord(r as Record<string, unknown>));

	const allColumns = Array.from(
		flatRecords.reduce((cols, record) => {
			for (const key of Object.keys(record)) {
				cols.add(key);
			}
			return cols;
		}, new Set<string>()),
	);

	const header = `| ${allColumns.join(" | ")} |`;
	const divider = `| ${allColumns.map(() => "---").join(" | ")} |`;

	const rows = flatRecords.map(record => {
		const cells = allColumns.map(col => {
			const val = record[col];
			return val === null || val === undefined ? "" : String(val);
		});
		return `| ${cells.join(" | ")} |`;
	});

	return `${result.totalSize} records returned.\n\n${[header, divider, ...rows].join("\n")}`;
}

export function formatUserProfile(profile: SfUserProfile): string {
	const lines: string[] = [];

	lines.push(`**${profile.firstName} ${profile.lastName}** (${profile.username})`);

	if (profile.title) {
		lines.push(`Title: ${profile.title}`);
	}

	if (profile.department) {
		lines.push(`Department: ${profile.department}`);
	}

	if (profile.division) {
		lines.push(`Division: ${profile.division}`);
	}

	if (profile.role) {
		lines.push(`Role: ${profile.role}`);
	}

	if (profile.profile) {
		lines.push(`Profile: ${profile.profile}`);
	}

	if (profile.aboutMe) {
		lines.push(`About: ${profile.aboutMe}`);
	}

	if (profile.managerName) {
		const managerLine = profile.managerEmail
			? `Manager: ${profile.managerName} (${profile.managerEmail})`
			: `Manager: ${profile.managerName}`;
		lines.push(managerLine);
	}

	if (profile.phone) {
		lines.push(`Phone: ${profile.phone}`);
	}

	const locationParts = [profile.city, profile.state, profile.country].filter(Boolean);
	if (locationParts.length > 0) {
		lines.push(`Location: ${locationParts.join(", ")}`);
	}

	return lines.join("\n");
}
