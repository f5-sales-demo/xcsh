export type KnowledgeRoute = "api" | "documentation" | "direct-uri" | "none";
export type DocumentationKnowledgeSource = "community-f5-com" | "docs-cloud-f5-com" | "my-f5-com" | "www-f5-com";

export interface KnowledgeClassifierResource {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly domain: string;
	readonly categories: readonly string[];
}

export interface KnowledgeSearchPlan {
	readonly intent: string;
	readonly lex: readonly string[];
	readonly vec: readonly string[];
	readonly hyde: readonly string[];
}

export interface KnowledgeConstraints {
	readonly domain?: string;
	readonly source?: DocumentationKnowledgeSource;
}

export interface KnowledgeClassification {
	readonly route: KnowledgeRoute;
	readonly confidence: number;
	readonly query: KnowledgeSearchPlan;
	readonly constraints: KnowledgeConstraints;
	readonly resource?: string;
	readonly domain?: string;
	readonly source?: DocumentationKnowledgeSource;
	readonly documentPath?: string;
	readonly directUri?: string;
}

export interface KnowledgeClassifierOptions {
	readonly toolsEnabled: boolean;
	readonly resources?: readonly KnowledgeClassifierResource[];
	readonly documentationSource?: DocumentationKnowledgeSource;
	readonly previous?: KnowledgeClassification | null;
}

const EMPTY_QUERY: KnowledgeSearchPlan = { intent: "", lex: [], vec: [], hyde: [] };
const THIRD_PARTY_SCOPE = /\b(?:aws|amazon|azure|gcp|google cloud|kubernetes)\b/i;
const F5_SCOPE = /\b(?:f5(?:\s+distributed\s+cloud)?|xc)\b/i;
const ANAPHORIC = /\b(?:its|it|that|this|those|them|the same)\b/i;
const API_METADATA =
	/\b(?:api|endpoint|operation\s*id|api\s+path|http\s+method|method|payload|request\s+body|required\s+fields?|enum|allowed\s+values?|constraints?|limits?|maximum|max(?:imum)?|minimum|min(?:imum)?|how\s+many|create|creates|creating|get|gets|list|lists|update|updates|replace|replaces|delete|deletes|clone|import)\b/i;
const DOCUMENTATION_INTENT =
	/\b(?:documentation|docs?|guide|tutorial|community|forum|discussion|example|walkthrough|support|article|knowledge[- ]base|how\s+(?:do|can|to)|configure|configuration|set\s*up|troubleshoot|procedure|instructions?|what\s+(?:is|are)|overview|product|solution|capabilities|benefits)\b/i;
const CONFIGURATION_INTENT = /\b(?:configure|configuration|set\s*up|procedure|instructions?|how\s+(?:do|can|to))\b/i;
const SUPPORT_INTENT = /\b(?:troubleshoot|support|knowledge[- ]base|error|failure|issue|K[0-9]{6,})\b/i;
const COMMUNITY_INTENT =
	/\b(?:community|forum|discussion|example|walkthrough|tutorial|troubleshoot|troubleshooting)\b/i;
const MARKETING_TOPIC =
	/\b(?:client[- ]side defense|distributed cloud|web (?:app|application) and api protection|multi[- ]cloud networking|dns load balancer|bot defense|api security|app connect|appstack|content delivery network|cdn|mobile app shield|synthetic monitoring|web app scanning)\b/i;
const EXCLUDED_API_INTENT = /\b(?:pricing|price|quote|licen[cs]ing|sales)\b/i;
const DIRECT_URI = /\bxcsh:\/\/(?:api-catalog|api-spec|documentation|terraform-documentation|terraform)\/[^\s)>\]}]*/i;

function normalizePhrase(value: string): string {
	return value
		.toLocaleLowerCase("en-US")
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function action(value: string): { base?: string; gerund?: string } {
	if (/\b(?:create|creates|creating)\b/i.test(value)) return { base: "create", gerund: "creating" };
	if (/\b(?:configure|configuration|configuring)\b/i.test(value)) return { base: "configure", gerund: "configuring" };
	if (/\b(?:set\s*up|setting\s*up)\b/i.test(value)) return { base: "set up", gerund: "setting up" };
	if (/\b(?:get|gets|read|fetch)\b/i.test(value)) return { base: "get", gerund: "getting" };
	if (/\b(?:list|lists|listing)\b/i.test(value)) return { base: "list", gerund: "listing" };
	if (/\b(?:update|updates|updating)\b/i.test(value)) return { base: "update", gerund: "updating" };
	if (/\b(?:replace|replaces|replacing)\b/i.test(value)) return { base: "replace", gerund: "replacing" };
	if (/\b(?:delete|deletes|remove|removing)\b/i.test(value)) return { base: "delete", gerund: "deleting" };
	if (/\bclone\b/i.test(value)) return { base: "clone", gerund: "cloning" };
	if (/\bimport\b/i.test(value)) return { base: "import", gerund: "importing" };
	return {};
}

function documentationSubject(prompt: string): string {
	const normalized = normalizePhrase(prompt);
	const withoutPreamble = normalized
		.replace(/^(?:please )?(?:use|read|find|show me|show) /, "")
		.replace(/^(?:the )?(?:official |pinned )?f5 (?:distributed cloud )?(?:documentation|docs?) (?:to |for )?/, "")
		.replace(/^(?:the )?(?:official |pinned )?(?:documentation|docs?) (?:to |for )?/, "");
	return (withoutPreamble || normalized)
		.replace(/\b(?:a|an|the)\b/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function buildKnowledgeSearchPlan(route: "api" | "documentation", subject: string): KnowledgeSearchPlan {
	const normalized = normalizePhrase(subject);
	const verb = action(normalized);
	if (route === "api") {
		const resource = verb.base
			? normalizePhrase(normalized.replace(new RegExp(`\\b${verb.base}\\b`), ""))
			: normalized;
		const lex = [...new Set([resource, verb.base ? `${verb.base} ${resource}` : resource].filter(Boolean))];
		const phrase = verb.gerund ? `${verb.gerund} ${resource}` : resource;
		return {
			intent: `Find the authoritative F5 Distributed Cloud API operation for ${phrase}.`,
			lex,
			vec: [`${verb.base ? `${verb.base} ` : ""}${resource} F5 Distributed Cloud API`],
			hyde: [
				`An authoritative F5 Distributed Cloud API operation for ${phrase}, including method, path, operation ID, request fields, and constraints.`,
			],
		};
	}
	const phrase = verb.gerund ? normalized.replace(new RegExp(`^${verb.base}`), verb.gerund) : normalized;
	return {
		intent: `Find the authoritative F5 documentation page for ${phrase}.`,
		lex: [normalized],
		vec: [`${subject.trim()} F5 documentation`],
		hyde: [
			`An authoritative F5 documentation page explains how to ${subject.trim()} with prerequisites, ordered steps, verification, and limitations.`,
		],
	};
}

function none(): KnowledgeClassification {
	return { route: "none", confidence: 0, query: EMPTY_QUERY, constraints: {} };
}

function direct(prompt: string): KnowledgeClassification | null {
	const directUri = DIRECT_URI.exec(prompt)?.[0];
	if (!directUri) return null;
	try {
		const parsed = new URL(directUri);
		const constraints: KnowledgeConstraints = {};
		if (parsed.hostname === "api-spec") {
			const domain = parsed.pathname.split("/").filter(Boolean)[0];
			if (domain) Object.assign(constraints, { domain });
		}
		if (parsed.hostname === "documentation") {
			const source = parsed.pathname.split("/").filter(Boolean)[0];
			if (
				source === "community-f5-com" ||
				source === "docs-cloud-f5-com" ||
				source === "my-f5-com" ||
				source === "www-f5-com"
			) {
				Object.assign(constraints, { source });
			}
		}
		return { route: "direct-uri", confidence: 1, directUri, constraints, query: EMPTY_QUERY };
	} catch {
		return null;
	}
}

function selectResource(
	prompt: string,
	resources: readonly KnowledgeClassifierResource[],
): KnowledgeClassifierResource | undefined {
	const normalizedPrompt = ` ${normalizePhrase(prompt)} `;
	return resources
		.flatMap(resource =>
			resource.aliases
				.map(alias => normalizePhrase(alias))
				.filter(alias => alias && normalizedPrompt.includes(` ${alias} `))
				.map(alias => ({ resource, alias })),
		)
		.sort(
			(left, right) =>
				right.alias.length - left.alias.length ||
				right.resource.categories.length - left.resource.categories.length ||
				left.resource.name.localeCompare(right.resource.name) ||
				left.resource.domain.localeCompare(right.resource.domain),
		)[0]?.resource;
}

export function classifyKnowledgeRequest(prompt: string, options: KnowledgeClassifierOptions): KnowledgeClassification {
	if (!options.toolsEnabled) return none();
	const directResult = direct(prompt);
	if (directResult) return directResult;

	const resources = options.resources ?? [];
	const selected = selectResource(prompt, resources);
	const thirdPartyOnly = THIRD_PARTY_SCOPE.test(prompt) && !F5_SCOPE.test(prompt);
	if (
		!thirdPartyOnly &&
		!EXCLUDED_API_INTENT.test(prompt) &&
		!COMMUNITY_INTENT.test(prompt) &&
		API_METADATA.test(prompt)
	) {
		const contextual =
			!selected && ANAPHORIC.test(prompt) && options.previous?.route === "api" ? options.previous : null;
		const resource = selected?.name ?? contextual?.resource;
		const domain = selected?.domain ?? contextual?.domain;
		if (resource && domain) {
			const alias = normalizePhrase(selected?.aliases[0] ?? contextual?.query.lex[0] ?? resource);
			const verb = action(prompt).base;
			const subject = verb ? `${verb} ${alias}` : alias;
			return {
				route: "api",
				confidence: F5_SCOPE.test(prompt) || contextual ? 0.99 : 0.97,
				resource,
				domain,
				constraints: { domain },
				query: buildKnowledgeSearchPlan("api", subject),
			};
		}
	}

	const previousDocumentation = options.previous?.route === "documentation" ? options.previous : null;
	if (
		!thirdPartyOnly &&
		(DOCUMENTATION_INTENT.test(prompt) || (ANAPHORIC.test(prompt) && previousDocumentation)) &&
		(F5_SCOPE.test(prompt) ||
			/\b(?:documentation|docs?)\b/i.test(prompt) ||
			COMMUNITY_INTENT.test(prompt) ||
			MARKETING_TOPIC.test(prompt) ||
			previousDocumentation)
	) {
		const inferredSource = COMMUNITY_INTENT.test(prompt)
			? "community-f5-com"
			: SUPPORT_INTENT.test(prompt)
				? "my-f5-com"
				: CONFIGURATION_INTENT.test(prompt)
					? "docs-cloud-f5-com"
					: "www-f5-com";
		const source = options.documentationSource ?? previousDocumentation?.source ?? inferredSource;
		const subject = documentationSubject(prompt);
		return {
			route: "documentation",
			confidence: /\b(?:documentation|docs?)\b/i.test(prompt) ? 0.99 : 0.96,
			source,
			documentPath: previousDocumentation?.documentPath,
			constraints: source ? { source } : {},
			query: buildKnowledgeSearchPlan("documentation", subject),
		};
	}

	return none();
}
