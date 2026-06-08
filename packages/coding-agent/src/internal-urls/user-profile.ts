import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@f5xc-salesdemos/pi-utils";
import { PROFILE_COLLECTORS } from "./profile-collectors";

export interface UserProfileObservation {
	key: string;
	value: string;
	source?: string;
	observedAt?: string;
}

export interface UserProfile {
	givenName?: string;
	familyName?: string;
	additionalName?: string;
	email?: string;
	telephone?: string;
	jobTitle?: string;
	department?: string;
	division?: string;
	worksFor?: { name?: string; url?: string };
	manager?: { givenName?: string; familyName?: string; email?: string };
	address?: {
		streetAddress?: string;
		addressLocality?: string;
		addressRegion?: string;
		postalCode?: string;
		addressCountry?: string;
	};
	birthDate?: string;
	birthPlace?: {
		addressLocality?: string;
		addressRegion?: string;
		addressCountry?: string;
	};
	nationality?: string;
	gender?: string;
	knowsLanguage?: string[];
	spouse?: { givenName?: string; familyName?: string };
	children?: Array<{ givenName?: string; familyName?: string; birthDate?: string }>;
	parent?: Array<{ givenName?: string; familyName?: string }>;
	sibling?: Array<{ givenName?: string; familyName?: string }>;
	url?: string;
	description?: string;
	image?: string;
	sameAs?: string[];
	identifiers?: { github?: string; twitter?: string };
	/** User-authored: short role label, e.g. 'SE', 'AE', 'CSM', 'SA'. Set manually. */
	role?: string;
	/**
	 * User-authored: confirmed partner (AE/SE counterpart, CSM, etc.).
	 * Set manually in user-profile.json.
	 */
	partner?: {
		/** Partner user ID — used to scope pipeline queries */
		id?: string;
		name: string;
		title?: string;
		/** Short role label, e.g. 'AE', 'SE', 'CSM' */
		role?: string;
	};
	/** User-authored: primary territory names. Scopes pipeline reports. */
	territories?: string[];
	/** User-authored: quarterly quota target in dollars. Used for coverage ratio calculations. */
	quota?: number;
	observations?: UserProfileObservation[];
	sources?: { github?: string; system?: string; conversation?: string };
	updatedAt?: string;
	/** Tracks which collector ID authoritatively owns each top-level field. */
	_fieldOwnership?: Record<string, string>;
}

const PROFILE_PATH = path.join(os.homedir(), ".xcsh", "user-profile.json");

export async function loadProfile(): Promise<UserProfile> {
	try {
		return (await Bun.file(PROFILE_PATH).json()) as UserProfile;
	} catch (err: unknown) {
		if (isEnoent(err)) return {};
		logger.warn("Failed to load user profile", { error: err });
		return {};
	}
}

export async function saveProfile(profile: UserProfile): Promise<void> {
	profile.updatedAt = new Date().toISOString();
	await Bun.write(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

export function mergeProfile(target: UserProfile, source: Partial<UserProfile>): void {
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null) continue;
		const k = key as keyof UserProfile;
		if (k === "sources" || k === "observations" || k === "updatedAt") continue;
		if (k === "sameAs") {
			// Merge arrays without duplicates
			if (!target.sameAs) target.sameAs = [];
			for (const url of value as string[]) {
				if (!target.sameAs.includes(url)) target.sameAs.push(url);
			}
			continue;
		}
		if (k === "knowsLanguage") {
			if (!target.knowsLanguage) target.knowsLanguage = value as string[];
			continue;
		}
		// For objects (worksFor, manager, address, etc.), merge sub-fields
		if (typeof value === "object" && !Array.isArray(value)) {
			const existing = target[k] as Record<string, unknown> | undefined;
			if (!existing) {
				(target as Record<string, unknown>)[k] = value;
			}
			continue;
		}
		// For simple values, don't overwrite
		if (target[k] === undefined || target[k] === null) {
			(target as Record<string, unknown>)[k] = value;
		}
	}
}

export async function seedProfile(): Promise<UserProfile> {
	const profile = await loadProfile();
	if (!profile.sources) profile.sources = {};

	for (const collector of PROFILE_COLLECTORS) {
		try {
			const isAvailable = await collector.available();
			if (!isAvailable) {
				logger.debug(`Profile collector '${collector.id}' not available, skipping`);
				continue;
			}
			const partial = await collector.collect();
			mergeProfile(profile, partial);
			(profile.sources as Record<string, string>)[collector.id] = new Date().toISOString();
			logger.debug(`Profile collector '${collector.id}' completed`);
		} catch (err: unknown) {
			logger.debug(`Profile collector '${collector.id}' failed`, { error: err });
		}
	}

	await saveProfile(profile);
	return profile;
}

const META_FIELDS = new Set(["sources", "observations", "updatedAt", "_fieldOwnership"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function reconcileProfile(
	target: UserProfile,
	source: Partial<UserProfile>,
	sourceId: string,
): void {
	const ownership = target._fieldOwnership ?? {};

	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null) continue;
		if (FORBIDDEN_KEYS.has(key)) continue;
		const k = key as keyof UserProfile;
		if (META_FIELDS.has(k)) continue;

		const currentOwner = ownership[k];

		if (currentOwner === "user") continue;
		if (currentOwner && currentOwner !== sourceId) continue;
		if (!currentOwner && target[k] !== undefined && target[k] !== null) continue;

		Object.defineProperty(target, k, { value, writable: true, enumerable: true, configurable: true });
		if (!currentOwner) {
			Object.defineProperty(ownership, k, { value: sourceId, writable: true, enumerable: true, configurable: true });
		}
	}

	target._fieldOwnership = ownership;
}

export async function reconcileFromCollectors(): Promise<UserProfile> {
	const profile = await loadProfile();
	if (!profile.sources) profile.sources = {};

	for (const collector of PROFILE_COLLECTORS) {
		try {
			const isAvailable = await collector.available();
			if (!isAvailable) {
				logger.debug(`Profile collector '${collector.id}' not available, skipping`);
				continue;
			}
			const partial = await collector.collect();
			reconcileProfile(profile, partial, collector.id);
			(profile.sources as Record<string, string>)[collector.id] = new Date().toISOString();
			logger.debug(`Profile collector '${collector.id}' reconciled`);
		} catch (err: unknown) {
			logger.debug(`Profile collector '${collector.id}' failed`, { error: err });
		}
	}

	await saveProfile(profile);
	return profile;
}

function formatAddress(addr: NonNullable<UserProfile["address"]>): string {
	const parts: string[] = [];
	if (addr.streetAddress) parts.push(addr.streetAddress);
	const cityState = [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ");
	if (cityState) parts.push(cityState);
	if (addr.postalCode) parts.push(addr.postalCode);
	if (addr.addressCountry) parts.push(addr.addressCountry);
	return parts.join(", ");
}

function hasValues(obj: Record<string, unknown> | undefined): boolean {
	if (!obj) return false;
	return Object.values(obj).some(v => v !== undefined && v !== null && v !== "");
}

export function renderProfileMarkdown(profile: UserProfile): string {
	const sections: string[] = [];

	sections.push("# User Profile\n");

	const isEmpty = !profile.givenName && !profile.familyName && !profile.email && !profile.jobTitle;
	if (isEmpty) {
		sections.push("No profile data yet. Use `xcsh://user?seed=true` to populate from GitHub and system sources.\n");
		sections.push("Profile facts can also be added progressively during conversation.\n");
		return sections.join("\n");
	}

	// Identity
	const identityLines: string[] = [];
	const fullName = [profile.givenName, profile.additionalName, profile.familyName].filter(Boolean).join(" ");
	if (fullName) identityLines.push(`- **Name:** ${fullName}`);
	if (profile.email) identityLines.push(`- **Email:** ${profile.email}`);
	if (profile.telephone) identityLines.push(`- **Phone:** ${profile.telephone}`);
	if (profile.image) identityLines.push(`- **Avatar:** ${profile.image}`);
	if (identityLines.length > 0) {
		sections.push("## Identity\n");
		sections.push(identityLines.join("\n"));
	}

	// Employment
	const employmentLines: string[] = [];
	if (profile.jobTitle) employmentLines.push(`- **Title:** ${profile.jobTitle}`);
	if (profile.department) employmentLines.push(`- **Department:** ${profile.department}`);
	if (profile.division) employmentLines.push(`- **Division:** ${profile.division}`);
	if (profile.worksFor?.name) {
		const org = profile.worksFor.url ? `[${profile.worksFor.name}](${profile.worksFor.url})` : profile.worksFor.name;
		employmentLines.push(`- **Organization:** ${org}`);
	}
	if (profile.manager) {
		const mgrName = [profile.manager.givenName, profile.manager.familyName].filter(Boolean).join(" ");
		const mgrLine = profile.manager.email ? `${mgrName} (${profile.manager.email})` : mgrName;
		if (mgrLine) employmentLines.push(`- **Manager:** ${mgrLine}`);
	}
	if (employmentLines.length > 0) {
		sections.push("\n## Employment\n");
		sections.push(employmentLines.join("\n"));
	}

	// Address
	if (hasValues(profile.address)) {
		sections.push("\n## Address\n");
		sections.push(`- ${formatAddress(profile.address!)}`);
	}

	// Demographics
	const demoLines: string[] = [];
	if (profile.birthDate) demoLines.push(`- **Birth Date:** ${profile.birthDate}`);
	if (profile.birthPlace && hasValues(profile.birthPlace)) {
		const bp = [
			profile.birthPlace.addressLocality,
			profile.birthPlace.addressRegion,
			profile.birthPlace.addressCountry,
		]
			.filter(Boolean)
			.join(", ");
		if (bp) demoLines.push(`- **Birth Place:** ${bp}`);
	}
	if (profile.nationality) demoLines.push(`- **Nationality:** ${profile.nationality}`);
	if (profile.gender) demoLines.push(`- **Gender:** ${profile.gender}`);
	if (profile.knowsLanguage && profile.knowsLanguage.length > 0) {
		demoLines.push(`- **Languages:** ${profile.knowsLanguage.join(", ")}`);
	}
	if (demoLines.length > 0) {
		sections.push("\n## Demographics\n");
		sections.push(demoLines.join("\n"));
	}

	// Family
	const familyLines: string[] = [];
	if (profile.spouse) {
		const spouseName = [profile.spouse.givenName, profile.spouse.familyName].filter(Boolean).join(" ");
		if (spouseName) familyLines.push(`- **Spouse:** ${spouseName}`);
	}
	if (profile.children && profile.children.length > 0) {
		for (const child of profile.children) {
			const childName = [child.givenName, child.familyName].filter(Boolean).join(" ");
			const childLine = child.birthDate ? `${childName} (b. ${child.birthDate})` : childName;
			if (childLine) familyLines.push(`- **Child:** ${childLine}`);
		}
	}
	if (profile.parent && profile.parent.length > 0) {
		for (const p of profile.parent) {
			const pName = [p.givenName, p.familyName].filter(Boolean).join(" ");
			if (pName) familyLines.push(`- **Parent:** ${pName}`);
		}
	}
	if (profile.sibling && profile.sibling.length > 0) {
		for (const s of profile.sibling) {
			const sName = [s.givenName, s.familyName].filter(Boolean).join(" ");
			if (sName) familyLines.push(`- **Sibling:** ${sName}`);
		}
	}
	if (familyLines.length > 0) {
		sections.push("\n## Family\n");
		sections.push(familyLines.join("\n"));
	}

	// Online Presence
	const onlineLines: string[] = [];
	if (profile.url) onlineLines.push(`- **Website:** ${profile.url}`);
	if (profile.description) onlineLines.push(`- **Bio:** ${profile.description}`);
	if (profile.identifiers?.github) onlineLines.push(`- **GitHub:** ${profile.identifiers.github}`);
	if (profile.identifiers?.twitter) onlineLines.push(`- **Twitter/X:** ${profile.identifiers.twitter}`);
	if (profile.sameAs && profile.sameAs.length > 0) {
		for (const link of profile.sameAs) {
			onlineLines.push(`- **Profile:** ${link}`);
		}
	}
	if (onlineLines.length > 0) {
		sections.push("\n## Online Presence\n");
		sections.push(onlineLines.join("\n"));
	}

	// Observations
	if (profile.observations && profile.observations.length > 0) {
		sections.push("\n## Observations\n");
		sections.push("| Key | Value | Source | Observed |");
		sections.push("|-----|-------|--------|----------|");
		for (const obs of profile.observations) {
			sections.push(`| ${obs.key} | ${obs.value} | ${obs.source ?? ""} | ${obs.observedAt ?? ""} |`);
		}
	}

	// Sources
	if (profile.sources && hasValues(profile.sources as unknown as Record<string, unknown>)) {
		sections.push("\n---\n");
		sections.push("**Sources:**");
		const srcLines: string[] = [];
		if (profile.sources.github) srcLines.push(`GitHub: ${profile.sources.github}`);
		if (profile.sources.system) srcLines.push(`System: ${profile.sources.system}`);
		if (profile.sources.conversation) srcLines.push(`Conversation: ${profile.sources.conversation}`);
		sections.push(srcLines.join(" | "));
		if (profile.updatedAt) sections.push(`\n*Last updated: ${profile.updatedAt}*`);
	}

	return sections.join("\n");
}
