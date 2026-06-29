#!/usr/bin/env bun
/**
 * Release script for pi-mono
 *
 * Usage:
 *   bun scripts/release.ts <version>   Open a release PR that bumps to <version>
 *   bun scripts/release.ts auto        Detect version from conventional commits + open release PR
 *   bun scripts/release.ts watch       Watch CI for current commit
 *
 * Release flow (since enforce_admins + required_status_checks blocks direct
 * push to main): this script creates a release/vX.Y.Z branch, commits the
 * version bump there, opens a PR, and enables auto-merge. Once the PR
 * squash-merges to main, `.github/workflows/tag-on-version-bump.yml` pushes
 * the git tag, which triggers the downstream build / sign / publish chain.
 */

import { $, Glob } from "bun";

const changelogGlob = new Glob("packages/*/CHANGELOG.md");
const packageJsonGlob = new Glob("packages/*/package.json");
const platformPackageJsonGlob = new Glob("packages/natives/npm/*/package.json");
const cargoTomlGlob = new Glob("crates/*/Cargo.toml");

// =============================================================================
// Shared functions
// =============================================================================

async function watchCI(): Promise<boolean> {
	const commitSha = (await $`git rev-parse HEAD`.text()).trim();
	console.log(`  Commit: ${commitSha.slice(0, 8)}`);

	while (true) {
		const runsOutput = await $`gh run list --commit ${commitSha} --event push --json databaseId,status,conclusion,name`.text();
		const runs: Array<{ databaseId: number; status: string; conclusion: string | null; name: string }> =
			JSON.parse(runsOutput);

		if (runs.length === 0) {
			console.log("  Waiting for CI to start...");
			await Bun.sleep(3000);
			continue;
		}

		// Check job-level status for in-progress runs (fail fast on first job failure)
		const failedJobs: Array<{ workflow: string; job: string; jobId: number; conclusion: string }> = [];
		const inProgressRuns = runs.filter((r) => r.status === "in_progress" || r.status === "queued");

		for (const run of inProgressRuns) {
			const jobsOutput =
				await $`gh run view ${run.databaseId} --json jobs`.quiet().nothrow().text();
			try {
				const { jobs } = JSON.parse(jobsOutput) as {
					jobs: Array<{ name: string; databaseId: number; status: string; conclusion: string | null }>;
				};
				for (const job of jobs) {
					if (job.status === "completed" && job.conclusion !== "success" && job.conclusion !== "skipped") {
						failedJobs.push({
							workflow: run.name,
							job: job.name,
							jobId: job.databaseId,
							conclusion: job.conclusion ?? "unknown",
						});
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		if (failedJobs.length > 0) {
			console.error("\nCI job failed:");
			for (const f of failedJobs) {
				console.error(`  - ${f.workflow} / ${f.job} (job ${f.jobId}): ${f.conclusion}`);
				// Tail the failed job's log
				const log = await $`gh run view --job ${f.jobId} --log-failed`.quiet().nothrow().text();
				if (log.trim()) {
					const lines = log.trimEnd().split("\n");
					const tail = lines.slice(-20).join("\n");
					console.error(`\n--- Last 20 lines of ${f.job} ---\n${tail}\n`);
				}
			}
			return false;
		}

		// Check workflow-level status
		const pending = runs.filter((r) => r.status !== "completed");
		const failed = runs.filter((r) => r.status === "completed" && r.conclusion !== "success");
		const passed = runs.filter((r) => r.status === "completed" && r.conclusion === "success");

		console.log(`  ${passed.length} passed, ${pending.length} pending, ${failed.length} failed`);

		if (failed.length > 0) {
			console.error("\nCI failed:");
			for (const r of failed) {
				console.error(`  - ${r.name}: ${r.conclusion}`);
				// Fetch failed jobs and tail their logs
				const jobsOutput = await $`gh run view ${r.databaseId} --json jobs`.quiet().nothrow().text();
				try {
					const { jobs } = JSON.parse(jobsOutput) as {
						jobs: Array<{ name: string; databaseId: number; status: string; conclusion: string | null }>;
					};
					for (const job of jobs) {
						if (job.conclusion !== "success" && job.conclusion !== "skipped") {
							const log = await $`gh run view --job ${job.databaseId} --log-failed`.quiet().nothrow().text();
							if (log.trim()) {
								const lines = log.trimEnd().split("\n");
								const tail = lines.slice(-20).join("\n");
								console.error(`\n--- Last 20 lines of ${job.name} (job ${job.databaseId}) ---\n${tail}\n`);
							}
						}
					}
				} catch {
					// Ignore parse errors
				}
			}
			return false;
		}

		if (pending.length === 0) {
			console.log("  All CI checks passed!\n");
			return true;
		}

		await Bun.sleep(5000);
	}
}

function hasUnreleasedContent(content: string): boolean {
	const unreleasedMatch = content.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=## \[\d|$)/);
	if (!unreleasedMatch) return false;
	const sectionContent = unreleasedMatch[1].trim();
	return sectionContent.length > 0;
}

function removeEmptyVersionEntries(content: string): string {
	// Remove version entries that have no content (just whitespace until next ## [ or EOF)
	return content.replace(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}\s*\n(?=## \[|\s*$)/g, "");
}

async function updateChangelogsForRelease(version: string): Promise<void> {
	const date = new Date().toISOString().split("T")[0];

	for await (const changelog of changelogGlob.scan(".")) {
		let content = await Bun.file(changelog).text();

		if (!content.includes("## [Unreleased]")) {
			console.log(`  Skipping ${changelog}: no [Unreleased] section`);
			continue;
		}

		// Only create version entry if [Unreleased] has content
		if (hasUnreleasedContent(content)) {
			content = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
			content = content.replace(/^(# Changelog\n\n)/, `$1## [Unreleased]\n\n`);
		}

		// Clean up any existing empty version entries
		content = removeEmptyVersionEntries(content);

		await Bun.write(changelog, content);
		console.log(`  Updated ${changelog}`);
	}
}

// =============================================================================
// Subcommands
// =============================================================================

async function cmdWatch(): Promise<void> {
	console.log("\n=== Watching CI ===\n");
	const success = await watchCI();
	process.exit(success ? 0 : 1);
}

function parseVersion(v: string): [number, number, number] {
	const match = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) throw new Error(`Invalid version: ${v}`);
	return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function compareVersions(a: string, b: string): number {
	const [aMajor, aMinor, aPatch] = parseVersion(a);
	const [bMajor, bMinor, bPatch] = parseVersion(b);
	if (aMajor !== bMajor) return aMajor - bMajor;
	if (aMinor !== bMinor) return aMinor - bMinor;
	return aPatch - bPatch;
}

async function applyVersionBumpToFiles(version: string): Promise<void> {
	// Update package versions
	console.log(`Updating package versions to ${version}…`);
	const pkgJsonPaths = await Array.fromAsync(packageJsonGlob.scan("."));

	// Filter out private packages
	const publicPkgPaths: string[] = [];
	for (const pkgPath of pkgJsonPaths) {
		const pkgJson = await Bun.file(pkgPath).json();
		if (pkgJson.private) {
			console.log(`  Skipping ${pkgJson.name} (private)`);
			continue;
		}
		publicPkgPaths.push(pkgPath);
	}

	for (const pkgPath of publicPkgPaths) {
		const content = await Bun.file(pkgPath).text();
		await Bun.write(pkgPath, content.replace(/"version": "[^"]+"/, `"version": "${version}"`));
	}

	// Update platform-specific native addon packages
	const platformPkgPaths = await Array.fromAsync(platformPackageJsonGlob.scan("."));
	for (const pkgPath of platformPkgPaths) {
		const content = await Bun.file(pkgPath).text();
		await Bun.write(pkgPath, content.replace(/"version": "[^"]+"/, `"version": "${version}"`));
	}

	// Update optionalDependencies versions in pi-natives package
	const nativesPkgPath = "packages/natives/package.json";
	const nativesPkgContent = await Bun.file(nativesPkgPath).text();
	await Bun.write(
		nativesPkgPath,
		nativesPkgContent.replace(
			/"@f5-sales-demo\/pi-natives-[^"]+": "[^"]+"/g,
			(match) => match.replace(/: "[^"]+"/, `: "${version}"`),
		),
	);

	// Verify
	console.log("  Verifying versions:");
	for (const pkgPath of publicPkgPaths) {
		const pkgJson = await Bun.file(pkgPath).json();
		console.log(`    ${pkgJson.name}: ${pkgJson.version}`);
	}
	for (const pkgPath of platformPkgPaths) {
		const pkgJson = await Bun.file(pkgPath).json();
		console.log(`    ${pkgJson.name}: ${pkgJson.version}`);
	}
	console.log();

	// 3. Update Rust workspace version
	console.log(`Updating Rust workspace version to ${version}…`);
	const cargoContent = await Bun.file("Cargo.toml").text();
	await Bun.write("Cargo.toml", cargoContent.replace(/^version = "[^"]+"/m, `version = "${version}"`));

	// Verify
	const cargoToml = await Bun.file("Cargo.toml").text();
	const versionMatch = cargoToml.match(/^\[workspace\.package\][\s\S]*?^version = "([^"]+)"/m);
	if (versionMatch) {
		console.log(`  workspace: ${versionMatch[1]}`);
	}

	// List crates using workspace version
	for await (const cargoPath of cargoTomlGlob.scan(".")) {
		const content = await Bun.file(cargoPath).text();
		if (content.includes("version.workspace = true")) {
			const nameMatch = content.match(/^name = "([^"]+)"/m);
			if (nameMatch) {
				console.log(`  ${nameMatch[1]}: ${version} (workspace)`);
			}
		}
	}
	console.log();

	// 4. Update lockfiles (preserve existing resolutions to avoid pulling
	// newer transitive deps that diverge from the tested main branch)
	console.log("Updating lockfiles...");
	await $`bun install`;
	await $`cargo generate-lockfile`;
	console.log();

	// 5. Update changelogs
	console.log("Updating CHANGELOGs...");
	await updateChangelogsForRelease(version);
	console.log();
}

function releasePRBody(version: string, commits: string[]): string {
	const commitList = commits.length
		? `### Releasable commits (${commits.length})\n\n${commits.map(c => `- ${c}`).join("\n")}`
		: "_No commit list captured (manual invocation)._";
	return [
		"Automated release PR generated by `scripts/release.ts`.",
		"",
		`Bumps every public package and the Cargo workspace to \`v${version}\` and updates CHANGELOGs for the releasable commits since the last tag.`,
		"",
		`Once this PR squash-merges to \`main\`, \`.github/workflows/tag-on-version-bump.yml\` pushes the \`v${version}\` git tag, which triggers the downstream release chain (build → sign → publish).`,
		"",
		commitList,
		"",
		"See `docs-control`'s onboarding note \"Release automation: release PR pattern\" for the governance rationale.",
	].join("\n");
}

async function openReleasePR(version: string, commits: string[]): Promise<void> {
	const branch = `release/v${version}`;

	// Bail if a release PR for this version is already pending
	const existing = (await $`git ls-remote --heads origin ${branch}`.text()).trim();
	if (existing) {
		console.log(`Release branch ${branch} already exists on origin.`);
		console.log(`A release PR for v${version} is likely already pending. Skipping.`);
		return;
	}

	// Configure git identity in CI (local invocations use the user's own config)
	if (process.env.CI) {
		await $`git config user.name ${"github-actions[bot]"}`;
		await $`git config user.email ${"github-actions[bot]@users.noreply.github.com"}`;
	}

	console.log(`Creating release branch ${branch}…`);
	await $`git checkout -b ${branch}`;

	// Run checks (skip in CI — already validated by prerequisite jobs)
	if (process.env.CI) {
		console.log("Skipping local checks (CI already validated).\n");
	} else {
		console.log("Running checks...");
		await $`bun run check`;
		console.log();
	}

	console.log("Committing version bump…");
	await $`git add .`;
	await $`git commit -m ${`chore: bump version to v${version}`}`;

	console.log(`Pushing ${branch} to origin…`);
	await $`git push --set-upstream origin ${branch}`;

	console.log("Opening release PR…");
	const body = releasePRBody(version, commits);
	const title = `chore: bump version to v${version}`;
	const prUrl = (await $`gh pr create --base main --head ${branch} --title ${title} --body ${body}`.text()).trim();
	console.log(`  ${prUrl}`);

	console.log("Enabling auto-merge (squash)…");
	await $`gh pr merge ${branch} --squash --auto --delete-branch`;
	console.log();
	console.log(`=== Release PR opened for v${version} ===`);
	console.log("Once CI passes and the PR squash-merges, tag-on-version-bump.yml will push the git tag,");
	console.log("triggering the downstream release chain.");
}

async function cmdRelease(version: string, commits: string[] = []): Promise<void> {
	console.log("\n=== Release Script ===\n");

	// 1. Pre-flight checks
	console.log("Pre-flight checks...");

	const branch = await $`git branch --show-current`.text();
	if (branch.trim() !== "main") {
		console.error(`Error: Must be on main branch (currently on '${branch.trim()}')`);
		process.exit(1);
	}
	console.log("  On main branch");

	const status = await $`git status --porcelain`.text();
	if (status.trim()) {
		console.error("Error: Uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
	console.log("  Working directory clean");

	const latestTag = (await $`git describe --tags --abbrev=0 --match ${"v*"}`.text().catch(() => "")).trim();
	if (latestTag) {
		if (compareVersions(version, latestTag) <= 0) {
			console.error(`Error: Version ${version} must be greater than latest tag ${latestTag}`);
			process.exit(1);
		}
		console.log(`  Version ${version} > ${latestTag}\n`);
	} else {
		console.log(`  No existing tags found. Creating initial release v${version}\n`);
	}

	// 2. Apply file mutations (package.json, Cargo.toml, lockfiles, CHANGELOGs)
	await applyVersionBumpToFiles(version);

	// 3. Open release PR (branch, commit, push, gh pr create, auto-merge)
	await openReleasePR(version, commits);
}

// =============================================================================
// Auto version detection from conventional commits
// =============================================================================

type BumpType = "major" | "minor" | "patch" | "none";

function classifyCommit(message: string): BumpType {
	const firstLine = message.split("\n")[0]!;

	// Check for breaking changes (! after type or BREAKING CHANGE in body)
	if (/^[a-z]+(\(.+\))?!:/.test(firstLine) || message.includes("BREAKING CHANGE")) {
		return "major";
	}

	const typeMatch = firstLine.match(/^([a-z]+)(\(.+\))?:/);
	if (!typeMatch) return "none";

	const type = typeMatch[1]!;
	switch (type) {
		case "feat":
			return "minor";
		case "fix":
		case "perf":
			return "patch";
		default:
			return "none";
	}
}

function bumpVersion(current: string, bump: BumpType): string {
	const [major, minor, patch] = parseVersion(current);
	switch (bump) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		default:
			return current;
	}
}

async function detectVersionBump(): Promise<{ version: string; bump: BumpType; commits: string[] } | null> {
	let latestTag = (await $`git describe --tags --abbrev=0 --match ${"v*"}`.text().catch(() => "")).trim();
	let currentVersion: string;
	let hasRealTag = false;

	if (latestTag) {
		currentVersion = latestTag.replace(/^v/, "");
		hasRealTag = true;
	} else {
		// No reachable tags — bootstrap from package.json version
		const codingAgentPkg = await Bun.file("packages/coding-agent/package.json").json();
		currentVersion = codingAgentPkg.version;
		latestTag = `v${currentVersion}`;
		console.log(`No reachable tags found. Bootstrapping from package.json version: ${currentVersion}`);
	}

	const logRange = hasRealTag ? `${latestTag}..HEAD` : "HEAD~50..HEAD";
	const log = (await $`git log ${logRange} --format=%B---COMMIT_SEP---`.text()).trim();

	if (!log) {
		return null;
	}

	const commitMessages = log
		.split("---COMMIT_SEP---")
		.map(m => m.trim())
		.filter(Boolean);

	let highestBump: BumpType = "none";
	const releasableCommits: string[] = [];

	for (const msg of commitMessages) {
		const bump = classifyCommit(msg);
		if (bump !== "none") {
			releasableCommits.push(msg.split("\n")[0]!);
			if (bump === "major" || (bump === "minor" && highestBump !== "major") || (bump === "patch" && highestBump === "none")) {
				highestBump = bump;
			}
		}
	}

	if (highestBump === "none") {
		return null;
	}

	return {
		version: bumpVersion(currentVersion, highestBump),
		bump: highestBump,
		commits: releasableCommits,
	};
}

async function cmdAutoRelease(): Promise<void> {
	console.log("\n=== Auto Release Detection ===\n");

	const result = await detectVersionBump();

	if (!result) {
		console.log("No releasable changes since last tag. Skipping release.");
		process.exit(0);
	}

	console.log(`Detected ${result.bump} bump → v${result.version}`);
	console.log(`Releasable commits (${result.commits.length}):`);
	for (const c of result.commits) {
		console.log(`  - ${c}`);
	}
	console.log();

	await cmdRelease(result.version, result.commits);
}

// =============================================================================
// Main
// =============================================================================

const arg = process.argv[2];

if (!arg) {
	console.error("Usage:");
	console.error("  bun scripts/release.ts <version>   Open a release PR that bumps to <version>");
	console.error("  bun scripts/release.ts auto        Detect version from conventional commits + open release PR");
	console.error("  bun scripts/release.ts watch       Watch CI for current commit");
	process.exit(1);
}

if (arg === "watch") {
	await cmdWatch();
} else if (arg === "auto") {
	await cmdAutoRelease();
} else if (/^\d+\.\d+\.\d+/.test(arg)) {
	await cmdRelease(arg);
} else {
	console.error(`Unknown command or invalid version: ${arg}`);
	console.error("Usage:");
	console.error("  bun scripts/release.ts <version>   Open a release PR that bumps to <version>");
	console.error("  bun scripts/release.ts auto        Detect version from conventional commits + open release PR");
	console.error("  bun scripts/release.ts watch       Watch CI for current commit");
	process.exit(1);
}
