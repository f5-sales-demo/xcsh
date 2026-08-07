import type { RoutingPoolConfig } from "./types";

export interface ParsePoolResult {
	valid: boolean;
	pool?: RoutingPoolConfig;
	errors: string[];
}

export function parseRoutingPoolConfig(raw: unknown): ParsePoolResult {
	const errors: string[] = [];
	if (!raw || typeof raw !== "object") {
		return { valid: false, errors: ["Pool configuration must be an object"] };
	}

	const pool = raw as Partial<RoutingPoolConfig>;
	const id = pool.id;
	if (!id || typeof id !== "string") {
		errors.push("Pool config missing 'id'");
	}

	if (!pool.tiers || typeof pool.tiers !== "object") {
		errors.push(`Pool '${id ?? "unknown"}' missing 'tiers' object`);
		return { valid: false, errors };
	}

	const tiers = pool.tiers as unknown as Record<string, unknown>;
	const utility = tiers.utility;
	const balanced = tiers.balanced;
	const frontier = tiers.frontier;

	if (typeof utility !== "string" || !utility) errors.push(`Pool '${id}' missing utility tier`);
	if (typeof balanced !== "string" || !balanced) errors.push(`Pool '${id}' missing balanced tier`);
	if (typeof frontier !== "string" || !frontier) errors.push(`Pool '${id}' missing frontier tier`);

	if (utility && balanced && utility === balanced) {
		errors.push(`Duplicate selector '${utility}' in pool '${id}'`);
	}
	if (utility && frontier && utility === frontier) {
		errors.push(`Duplicate selector '${utility}' in pool '${id}'`);
	}
	if (balanced && frontier && balanced === frontier) {
		errors.push(`Duplicate selector '${balanced}' in pool '${id}'`);
	}

	// Mixed provider check
	const isMixed =
		typeof utility === "string" &&
		typeof balanced === "string" &&
		typeof frontier === "string" &&
		(utility.includes("/") || balanced.includes("/") || frontier.includes("/")) &&
		(utility.split("/")[0] !== balanced.split("/")[0] || balanced.split("/")[0] !== frontier.split("/")[0]);

	if (isMixed && !pool.allowMixed) {
		errors.push(`Mixed provider pool '${id}' requires allowMixed: true`);
	}

	if (errors.length > 0) {
		return { valid: false, errors };
	}

	return {
		valid: true,
		pool: {
			id: id!,
			provider: pool.provider,
			allowMixed: pool.allowMixed ?? false,
			tiers: {
				utility: utility as string,
				balanced: balanced as string,
				frontier: frontier as string,
			},
		},
		errors: [],
	};
}

export function validateRoutingConfig(_raw: unknown): { valid: boolean; errors: string[] } {
	return { valid: true, errors: [] };
}
