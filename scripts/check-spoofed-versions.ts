#!/usr/bin/env bun

/** Check spoofed client versions against their authoritative release channels. */

import * as path from "node:path";

type ReleaseSource =
	| { type: "github"; repo: string; parseTag: (tag: string) => string | null }
	| { type: "npm"; packageName: string };

interface VersionCheck {
	name: string;
	sourceFile: string;
	sourcePattern: RegExp;
	releaseSource: ReleaseSource;
}

async function fetchLatestGitHubRelease(repo: string, parseTag: (tag: string) => string | null): Promise<string | null> {
	try {
		const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "xcsh/version-check" },
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { tag_name?: unknown };
		return typeof data.tag_name === "string" ? parseTag(data.tag_name) : null;
	} catch {
		return null;
	}
}

const SEMVER_RE = /(\d+\.\d+\.\d+)/;

async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`, {
			headers: { Accept: "application/json", "User-Agent": "xcsh/version-check" },
		});
		if (!response.ok) return null;
		const data = (await response.json()) as { version?: unknown };
		return typeof data.version === "string" && SEMVER_RE.test(data.version) ? data.version : null;
	} catch {
		return null;
	}
}

async function fetchLatestVersion(source: ReleaseSource): Promise<string | null> {
	return source.type === "github"
		? fetchLatestGitHubRelease(source.repo, source.parseTag)
		: fetchLatestNpmVersion(source.packageName);
}

const checks: VersionCheck[] = [
	{
		name: "Gemini CLI",
		sourceFile: path.join(import.meta.dir, "../packages/ai/src/providers/google-gemini-cli.ts"),
		sourcePattern: /PI_AI_GEMINI_CLI_VERSION\s*\|\|\s*"(\d+\.\d+\.\d+)"/,
		releaseSource: {
			type: "github",
			repo: "google-gemini/gemini-cli",
			parseTag: tag => SEMVER_RE.exec(tag)?.[1] ?? null,
		},
	},
	{
		name: "Claude Code",
		sourceFile: path.join(import.meta.dir, "../packages/ai/src/providers/anthropic.ts"),
		sourcePattern: /claudeCodeVersion\s*=\s*"(\d+\.\d+\.\d+)"/,
		releaseSource: { type: "npm", packageName: "@anthropic-ai/claude-code" },
	},
];

async function run() {
	const doUpdate = process.argv.includes("--update");
	const sources = new Map<string, string>();
	const changedFiles = new Set<string>();
	let anyDrift = false;
	let anyFailure = false;

	for (const check of checks) {
		const source = sources.get(check.sourceFile) ?? (await Bun.file(check.sourceFile).text());
		sources.set(check.sourceFile, source);
		const match = check.sourcePattern.exec(source);
		if (!match?.[1]) {
			console.error(`[FAIL] Could not extract current ${check.name} version from ${check.sourceFile}`);
			anyFailure = true;
			continue;
		}

		const current = match[1];
		const latest = await fetchLatestVersion(check.releaseSource);

		if (!latest) {
			console.error(`[FAIL] Could not fetch latest ${check.name} version`);
			anyFailure = true;
			continue;
		}

		if (current === latest) {
			console.log(`[OK]   ${check.name}: ${current} (up to date)`);
		} else {
			console.log(`[DRIFT] ${check.name}: ${current} -> ${latest}`);
			anyDrift = true;

			if (doUpdate) {
				sources.set(check.sourceFile, source.replace(match[0], match[0].replace(current, latest)));
				changedFiles.add(check.sourceFile);
				console.log(`       Updated in source.`);
			}
		}
	}

	for (const sourceFile of changedFiles) {
		await Bun.write(sourceFile, sources.get(sourceFile)!);
		console.log(`Wrote updates to ${path.relative(process.cwd(), sourceFile)}`);
	}

	if (anyFailure || (anyDrift && !doUpdate)) process.exit(1);
}

await run();
