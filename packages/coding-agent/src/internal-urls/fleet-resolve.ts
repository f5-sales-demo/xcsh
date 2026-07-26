/**
 * Resolver for xcsh://fleet — "what kind of repository am I in, and what may I do here?"
 *
 * xcsh belongs to a fleet of repositories that are not interchangeable. Some hold
 * demo and product content — documentation, Terraform plans, howtos — which xcsh
 * authors directly. Some hold compiled code with their own build and test harness,
 * where implementation belongs in a development environment and xcsh's deliverable
 * is a verified issue. Some hold the fleet plumbing itself.
 *
 * That distinction is declared, not guessed: docs-control publishes `repo_classes`
 * in `.claude/governance.json`, a managed file synced byte-identically into every
 * governed repository. So the classification is readable offline from any checkout,
 * and this resolver reads it from the working directory before reaching for the
 * network.
 *
 * URL forms (host = "fleet"):
 * - xcsh://fleet   -> the current repository's class first, then the whole fleet
 *
 * Dynamic and uncached, mirroring xcsh://about. All shelling and file reading is
 * injected so the resolver is unit-testable without a git repo, a `gh` binary, or
 * a network.
 */

import path from "node:path";
import { $ } from "bun";
import type { InternalResource, InternalUrl } from "./types";

export interface GhResult {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
}

export interface FleetDeps {
	readonly cwd: () => string;
	/** Absolute path to the enclosing git repository root, or null when outside one. */
	readonly repoRoot: (cwd: string) => Promise<string | null>;
	/** The `origin` remote URL, or null when there is none. */
	readonly repoOrigin: (cwd: string) => Promise<string | null>;
	/** Contents of `<repoRoot>/.claude/governance.json`, or null when absent/unreadable. */
	readonly readGovernance: (repoRoot: string) => Promise<string | null>;
	readonly runGh: (args: string[]) => Promise<GhResult>;
}

/** The repository the classification manifest is published from. */
export const GOVERNANCE_REPO = "f5-sales-demo/docs-control";
export const GOVERNANCE_RELPATH = ".claude/governance.json";

/**
 * The organization's pre-rename name. Reads still redirect from it, but pushes are
 * rejected, so a clone left on the old slug looks healthy until the first push
 * fails. Classification keys are bare repository names, so the org does not affect
 * the lookup — but it is worth warning about where we notice it.
 */
export const LEGACY_ORG = "f5xc-salesdemos";
export const CURRENT_ORG = "f5-sales-demo";

/** Rendered class name when no manifest could be read at all. */
export const CLASS_UNCLASSIFIED = "UNCLASSIFIED";

export interface ClassDefinition {
	readonly authority: string;
	readonly description?: string;
	readonly surfaces?: readonly string[];
	readonly delegateTo?: string;
}

export interface RepoClasses {
	readonly defaultClass: string;
	readonly classes: Readonly<Record<string, ClassDefinition>>;
	readonly repos: Readonly<Record<string, string>>;
}

export interface RepoVerdict {
	readonly className: string;
	/** True when the manifest names this repository explicitly. */
	readonly declared: boolean;
	readonly definition: ClassDefinition | null;
}

/**
 * Read `repo_classes` out of a governance.json payload. Returns null — never throws —
 * when the payload is malformed or predates the block, so a missing classification
 * degrades into an actionable message rather than an error.
 */
export function parseRepoClasses(json: string): RepoClasses | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const block = (parsed as Record<string, unknown>).repo_classes;
	if (typeof block !== "object" || block === null) return null;

	const raw = block as Record<string, unknown>;
	const rawClasses = typeof raw.classes === "object" && raw.classes !== null ? raw.classes : {};
	const rawRepos = typeof raw.repos === "object" && raw.repos !== null ? raw.repos : {};

	const classes: Record<string, ClassDefinition> = {};
	for (const [name, value] of Object.entries(rawClasses as Record<string, unknown>)) {
		if (typeof value !== "object" || value === null) continue;
		const def = value as Record<string, unknown>;
		classes[name] = {
			authority: String(def.authority ?? ""),
			description: typeof def.description === "string" ? def.description : undefined,
			surfaces: Array.isArray(def.surfaces) ? def.surfaces.map(String) : undefined,
			delegateTo: typeof def.delegate_to === "string" ? def.delegate_to : undefined,
		};
	}

	const repos: Record<string, string> = {};
	for (const [name, value] of Object.entries(rawRepos as Record<string, unknown>)) {
		if (typeof value === "string") repos[name] = value;
	}

	// A block with no classes is unusable; treat it as absent rather than render an
	// empty fleet that looks authoritative.
	if (Object.keys(classes).length === 0) return null;

	return {
		defaultClass: typeof raw._default === "string" ? raw._default : "",
		classes,
		repos,
	};
}

/** Split a GitHub remote URL into its org and bare repository name. */
export function repoNameFromOrigin(origin: string): { org: string; name: string } | null {
	const cleaned = origin.trim().replace(/\.git$/, "");
	const match = cleaned.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+)$/);
	if (!match) return null;
	const [, org, name] = match;
	if (!org || !name) return null;
	return { org, name };
}

/**
 * Resolve a repository name to its class. An unlisted repository takes the
 * manifest's `_default`, which docs-control pins to the most restrictive class, so
 * forgetting an assignment withholds authority rather than granting it.
 */
export function classifyRepo(classes: RepoClasses | null, repoName: string): RepoVerdict {
	if (!classes) {
		return { className: CLASS_UNCLASSIFIED, declared: false, definition: null };
	}
	const declared = Object.hasOwn(classes.repos, repoName);
	const className = declared ? (classes.repos[repoName] as string) : classes.defaultClass;
	return {
		className: className || CLASS_UNCLASSIFIED,
		declared,
		definition: classes.classes[className] ?? null,
	};
}

/** The behaviour each authority implies, stated so the agent does not have to infer it. */
function authorityGuidance(authority: string): string[] {
	switch (authority) {
		case "author":
			return [
				"**Authority: author.** Create, update and delete content here directly — documentation,",
				"Terraform plans, howtos, diagrams, demo and traffic-generation scripts. You do not need to",
				"ask permission to author; you do need to follow the governed path:",
				"linked issue → branch → pull request → CI → auto-merge. Never commit to `main`.",
			];
		case "delegate":
			return [
				"**Authority: delegate.** This repository holds compiled or tested code with its own build",
				"and test harness. Do not implement feature code here. File a CONTRIBUTING-compliant issue —",
				"reproduce first, no unverified claims — and delegate the implementation to a development",
				"environment (Claude Code / Codex). Reviewing, specifying and documenting are still yours.",
			];
		case "governed":
			return [
				"**Authority: governed.** This is fleet plumbing: CI, packaging, container images, or",
				"governance itself. Changes propagate to every repository, so they go through the governed",
				"path only and are never made freehand.",
			];
		default:
			return [
				"**Authority: unknown.** The manifest does not declare an authority for this class.",
				"Treat it as `delegate` — the restrictive case — and ask docs-control to fix the manifest.",
			];
	}
}

function renderCurrentRepo(
	slug: string | null,
	verdict: RepoVerdict,
	classes: RepoClasses | null,
	legacyOrg: boolean,
): string[] {
	const lines = ["## This repository", ""];

	if (!slug) {
		lines.push(
			"Not inside a GitHub repository from this organization, so there is no class to apply.",
			"Classify explicitly before authoring anything: read this document again from the repository",
			"you intend to change.",
			"",
		);
		return lines;
	}

	lines.push(`\`${slug}\` — class: **${verdict.className}**${verdict.declared ? " (declared)" : ""}`);
	lines.push("");

	if (verdict.className === CLASS_UNCLASSIFIED) {
		lines.push(
			"No classification manifest was available, so **no authority is implied**. Do not author",
			"content here on the strength of a guess.",
			"",
		);
		return lines;
	}

	if (!verdict.declared) {
		lines.push(
			`This repository is **UNCLASSIFIED** — it is not named in the manifest, so it falls back to`,
			`the fail-safe default (\`${classes?.defaultClass || "developer"}\`) and is treated as the most`,
			"restrictive case. Ask docs-control to classify it rather than assuming authoring rights.",
			"",
		);
	}

	lines.push(...authorityGuidance(verdict.definition?.authority ?? ""));
	lines.push("");

	if (verdict.definition?.surfaces?.length) {
		lines.push(`Content surfaces: ${verdict.definition.surfaces.map(s => `\`${s}\``).join(", ")}`, "");
	}

	if (legacyOrg) {
		lines.push(
			`> **This clone points at the pre-rename organization \`${LEGACY_ORG}\`.** Reads redirect, but`,
			"> **pushes are rejected**, so the branch will look fine until you try to publish it. Fix it first:",
			">",
			"> ```",
			`> git remote set-url origin https://github.com/${CURRENT_ORG}/${repoNameFromOrigin(slug)?.name ?? "<repo>"}.git`,
			"> ```",
			"",
		);
	}

	return lines;
}

function renderFleet(classes: RepoClasses): string[] {
	const byClass = new Map<string, string[]>();
	for (const name of Object.keys(classes.classes)) byClass.set(name, []);
	for (const [repo, className] of Object.entries(classes.repos)) {
		if (!byClass.has(className)) byClass.set(className, []);
		byClass.get(className)?.push(repo);
	}

	const lines = ["## Fleet", ""];
	for (const [className, repos] of byClass) {
		const def = classes.classes[className];
		lines.push(`### ${className} (${repos.length}) — authority: ${def?.authority ?? "unknown"}`);
		if (def?.description) lines.push("", def.description);
		lines.push(
			"",
			repos.length > 0
				? repos
						.sort()
						.map(r => `\`${r}\``)
						.join(" ")
				: "_none_",
			"",
		);
	}

	lines.push(
		`Any repository not listed above is **UNCLASSIFIED** and is treated as`,
		`\`${classes.defaultClass || "developer"}\` — the restrictive default. Authority is never assumed`,
		"from a repository's contents; it is read from the manifest.",
		"",
	);
	return lines;
}

/** Rendered when no manifest could be read — actionable, never a thrown error. */
function renderUnavailable(reason: string, slug: string | null): string {
	return [
		"# Fleet — classification unavailable",
		"",
		reason,
		"",
		"Until the classification is readable, **do not assume authority over any repository**: file an",
		"issue and delegate rather than authoring content on a guess.",
		"",
		"Resolve it manually:",
		"",
		"```",
		`gh api repos/${GOVERNANCE_REPO}/contents/${GOVERNANCE_RELPATH} --jq '.content' | base64 -d | jq .repo_classes`,
		"```",
		"",
		`Or read \`${GOVERNANCE_RELPATH}\` in any governed checkout — the file is synced byte-identically`,
		"across the fleet.",
		"",
		slug ? `Current repository: \`${slug}\`.` : "Not inside a GitHub repository from this organization.",
	].join("\n");
}

const FOOTER = [
	"---",
	"This classification decides *how* you contribute, not *whether* you do. In a `content`",
	"repository, author directly through the governed path. In a `developer` repository, your",
	"deliverable is a verified issue plus the specification, review and documentation around it —",
	"the implementation belongs to a development environment. See `xcsh://source` for where xcsh's",
	"own code lives and `xcsh://changes` for what shipped recently.",
];

export function renderFleetDoc(
	slug: string | null,
	verdict: RepoVerdict,
	classes: RepoClasses,
	legacyOrg: boolean,
): string {
	return [
		"# Fleet — repository classes and your authority here",
		"",
		...renderCurrentRepo(slug, verdict, classes, legacyOrg),
		...renderFleet(classes),
		...FOOTER,
	].join("\n");
}

async function defaultRunGh(args: string[]): Promise<GhResult> {
	try {
		const res = await $`gh ${args}`.quiet().nothrow();
		return { ok: res.exitCode === 0, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
	} catch (err) {
		return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
	}
}

export class FleetResolver {
	readonly #deps: FleetDeps;

	constructor(deps: FleetDeps) {
		this.#deps = deps;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const content = await this.#render();
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: "xcsh://fleet",
		};
	}

	async #render(): Promise<string> {
		const cwd = this.#deps.cwd();
		const root = await this.#deps.repoRoot(cwd);

		let slug: string | null = null;
		let repoName = "";
		let legacyOrg = false;
		if (root) {
			const origin = await this.#deps.repoOrigin(root);
			const parsed = origin ? repoNameFromOrigin(origin) : null;
			if (parsed) {
				slug = `${parsed.org}/${parsed.name}`;
				repoName = parsed.name;
				legacyOrg = parsed.org === LEGACY_ORG;
			}
		}

		// Prefer the local, offline copy: it is byte-identical to the published one
		// across the whole governed fleet, so there is no reason to spend a network
		// round trip when we are standing in a governed repository.
		let classes: RepoClasses | null = null;
		let staleLocal = false;
		if (root) {
			const local = await this.#deps.readGovernance(root);
			if (local !== null) {
				classes = parseRepoClasses(local);
				staleLocal = classes === null;
			}
		}

		if (!classes) {
			const remote = await this.#deps.runGh([
				"api",
				`repos/${GOVERNANCE_REPO}/contents/${GOVERNANCE_RELPATH}`,
				"--jq",
				".content",
			]);
			if (remote.ok && remote.stdout.trim()) {
				const decoded = decodeMaybeBase64(remote.stdout.trim());
				classes = parseRepoClasses(decoded);
			}
		}

		if (!classes) {
			const reason = staleLocal
				? `This checkout's \`${GOVERNANCE_RELPATH}\` has no \`repo_classes\` block — the classification ` +
					`is not yet published to this repository, and querying \`${GOVERNANCE_REPO}\` did not succeed either.`
				: `No \`${GOVERNANCE_RELPATH}\` was readable here, and querying \`${GOVERNANCE_REPO}\` did not succeed.`;
			return renderUnavailable(reason, slug);
		}

		return renderFleetDoc(slug, classifyRepo(classes, repoName), classes, legacyOrg);
	}
}

/**
 * `gh api --jq .content` returns the base64 payload of a contents response. Accept
 * either that or already-decoded JSON, so the caller does not have to care which
 * form it got.
 */
function decodeMaybeBase64(raw: string): string {
	if (raw.startsWith("{")) return raw;
	try {
		return Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf-8");
	} catch {
		return raw;
	}
}

async function defaultRepoRoot(cwd: string): Promise<string | null> {
	const git = await import("../utils/git");
	return git.repo.root(cwd);
}

async function defaultRepoOrigin(cwd: string): Promise<string | null> {
	const git = await import("../utils/git");
	return (await git.remote.url(cwd, "origin")) ?? null;
}

async function defaultReadGovernance(repoRoot: string): Promise<string | null> {
	try {
		const file = Bun.file(path.join(repoRoot, GOVERNANCE_RELPATH));
		if (!(await file.exists())) return null;
		return await file.text();
	} catch {
		return null;
	}
}

export function createFleetResolver(deps: Partial<FleetDeps> = {}): FleetResolver {
	return new FleetResolver({
		cwd: deps.cwd ?? (() => process.cwd()),
		repoRoot: deps.repoRoot ?? defaultRepoRoot,
		repoOrigin: deps.repoOrigin ?? defaultRepoOrigin,
		readGovernance: deps.readGovernance ?? defaultReadGovernance,
		runGh: deps.runGh ?? defaultRunGh,
	});
}
