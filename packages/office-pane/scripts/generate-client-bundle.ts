#!/usr/bin/env bun

/**
 * Embed the built Office task-pane bundle into the `@f5-sales-demo/xcsh` binary.
 *
 * OPTION A (publish-safe): the office pane is a build-time embedded ASSET of the
 * binary, not a published library. `office-pane` stays `private`, and the base64
 * tar.gz of its `dist/` is written into a CODING-AGENT-owned file
 * (`packages/coding-agent/src/browser/office-pane.generated.txt`) which
 * coding-agent imports directly — so `@f5-sales-demo/xcsh` gains NO dependency on
 * the private office-pane package and stays installable from npm.
 *
 * Mirrors `packages/stats/scripts/generate-client-bundle.ts`:
 *  - `--generate` (pre-compile): build `dist/`, tar.gz it, base64-encode, write it
 *    into the coding-agent generated file;
 *  - `--reset` (post-compile): restore the committed empty placeholder.
 */

import * as path from "node:path";
import { $ } from "bun";
import { buildDeterministicArchiveBase64 } from "../../../scripts/deterministic-tar-gzip";

// packages/office-pane/scripts → repo/packages → coding-agent target file.
const PACKAGES_DIR = path.resolve(import.meta.dir, "..", "..");
const GENERATED_FILE = path.join(PACKAGES_DIR, "coding-agent", "src", "browser", "office-pane.generated.txt");
const OFFICE_PANE_DIR = path.resolve(import.meta.dir, "..");
const DIST_DIR = path.join(OFFICE_PANE_DIR, "dist");

const GENERATE_FLAG = "--generate";
const RESET_FLAG = "--reset";

/** The committed placeholder is intentionally EMPTY so the runtime null-guard fires. */
function placeholderContent(): string {
	return "";
}

async function main(): Promise<void> {
	if (process.argv.includes(RESET_FLAG)) {
		await Bun.write(GENERATED_FILE, placeholderContent());
		console.log(`Reset ${GENERATED_FILE}`);
		return;
	}

	if (!process.argv.includes(GENERATE_FLAG)) {
		console.log(`Skipping ${GENERATED_FILE}; pass ${GENERATE_FLAG} to build the embedded bundle`);
		return;
	}

	await $`bun run build`.cwd(OFFICE_PANE_DIR);
	const archiveBase64 = await buildDeterministicArchiveBase64(DIST_DIR);
	await Bun.write(GENERATED_FILE, archiveBase64);
	console.log(`Generated ${GENERATED_FILE} (${archiveBase64.length} base64 chars)`);
}

await main();
