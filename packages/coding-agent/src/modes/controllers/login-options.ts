import { getOAuthProviders, type OAuthProviderInfo } from "@f5-sales-demo/pi-ai";
import type { ProviderAccessState, ProviderPickerMetadata } from "../../config/model-registry";
import { getProviderDisplayName } from "./provider-presentation";

export type LoginOption = OAuthProviderInfo & {
	kind: "local" | "oauth";
	/** Provider routes managed by this row. Grouped transports share one row. */
	providerIds?: string[];
	/** Opens the searchable full catalog instead of starting authentication. */
	action?: "add-provider" | "manage-only";
};

export interface ProviderManagementOptions {
	mode: "login" | "logout";
	providerInventory: Iterable<string>;
	configuredProviderIds: Iterable<string>;
	providerAllowlist: readonly string[];
	getAccessState(providerId: string): ProviderAccessState | undefined;
	getPickerMetadata(providerId: string): ProviderPickerMetadata | undefined;
	hasStoredCredential(providerId: string): boolean;
}

export const ADD_PROVIDER_ID = "__add-provider__";

function catalogOption(providerId: string, catalog: readonly LoginOption[]): LoginOption {
	return (
		catalog.find(option => option.id === providerId) ?? {
			id: providerId,
			kind: "oauth",
			name: getProviderDisplayName(providerId),
			available: true,
			action: "manage-only",
		}
	);
}

/**
 * Build the compact provider-management list used by `/login` and `/logout`.
 * The full built-in catalog is deliberately excluded unless the user chooses
 * `Add provider…`; an empty allowlist is not an allow-everything signal here.
 */
export function buildProviderManagementOptions(options: ProviderManagementOptions): LoginOption[] {
	const catalog = getLoginOptions();
	const inventory = new Set(options.providerInventory);
	const configured = new Set(options.configuredProviderIds);
	const allowlisted = new Set(options.providerAllowlist);
	const providerIds = new Set<string>([...inventory, ...configured, ...allowlisted]);
	for (const provider of catalog) {
		const access = options.getAccessState(provider.id);
		if (
			options.hasStoredCredential(provider.id) ||
			access?.configured ||
			(access !== undefined && access.status !== "unconfigured")
		) {
			providerIds.add(provider.id);
		}
	}

	if (options.mode === "logout") {
		return catalog
			.filter(provider => !provider.loginOnly && options.hasStoredCredential(provider.id))
			.map(provider => ({ ...provider, providerIds: [provider.id] }));
	}

	const groups = new Map<string, { members: string[]; order: number; metadata?: ProviderPickerMetadata }>();
	for (const providerId of providerIds) {
		const access = options.getAccessState(providerId);
		const relevant =
			inventory.has(providerId) ||
			configured.has(providerId) ||
			allowlisted.has(providerId) ||
			options.hasStoredCredential(providerId) ||
			access?.configured ||
			(access !== undefined && access.status !== "unconfigured");
		if (!relevant) continue;
		const metadata = options.getPickerMetadata(providerId);
		const groupId = metadata?.groupId ?? providerId;
		const order = catalog.findIndex(provider => provider.id === providerId);
		const existing = groups.get(groupId);
		if (existing) {
			existing.members.push(providerId);
			existing.order = Math.min(existing.order, order < 0 ? Number.MAX_SAFE_INTEGER : order);
			existing.metadata ??= metadata;
		} else {
			groups.set(groupId, {
				members: [providerId],
				order: order < 0 ? Number.MAX_SAFE_INTEGER : order,
				metadata,
			});
		}
	}

	const relevant = [...groups.entries()]
		.sort(([, a], [, b]) => a.order - b.order || a.members[0].localeCompare(b.members[0]))
		.map(([groupId, group]) => {
			const representativeId = group.members.includes(groupId) ? groupId : group.members[0];
			const representative = catalogOption(representativeId, catalog);
			return {
				...representative,
				id: representativeId,
				name: group.metadata?.groupLabel ?? representative.name,
				providerIds: [...new Set(group.members)],
			};
		});

	return [
		...relevant,
		{
			id: ADD_PROVIDER_ID,
			kind: "local",
			name: "Add provider…",
			description: "Search the full provider catalog",
			available: true,
			action: "add-provider",
			providerIds: [],
		},
	];
}

/**
 * The login menu is broader than OAuth. Keep local setup routes here instead
 * of pretending they are OAuth providers (and therefore credential storage).
 */
export function getLoginOptions(): LoginOption[] {
	return [
		{
			id: "google-vertex",
			kind: "local",
			name: "Google Vertex AI",
			description: "Enterprise cloud access with browser sign-in",
			available: true,
			loginOrder: -100,
		},
		...getOAuthProviders().map(provider => ({
			...provider,
			name: getProviderDisplayName(provider.id),
			kind: "oauth" as const,
		})),
	];
}
