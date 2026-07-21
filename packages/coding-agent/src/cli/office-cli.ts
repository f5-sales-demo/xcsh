/**
 * `xcsh office` command handlers.
 *
 * Drives the embedded Office task pane: start its fixed :8444 HTTPS listener
 * (`serve`), emit the unified manifest (`manifest`), or sideload it into a
 * desktop Office app (`sideload`). The serving/embed logic lives in
 * `../browser/office-pane-server`; this module is the thin, testable CLI seam
 * mirroring `stats-cli.ts` / `chrome-cli.ts`.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { getOfficePaneDir, readManifest, startOfficePaneServer } from "../browser/office-pane-server";

/** The subcommands `xcsh office` accepts (also the Args `options` constraint). */
export const OFFICE_ACTIONS = ["serve", "manifest", "sideload"] as const;
export type OfficeAction = (typeof OFFICE_ACTIONS)[number];

/** Desktop Office apps a sideload can target. */
export const OFFICE_APPS = ["excel", "powerpoint", "word"] as const;
export type OfficeApp = (typeof OFFICE_APPS)[number];

export interface OfficeCommandArgs {
	action: OfficeAction;
	/** Target app for `sideload` (defaults to excel). */
	app?: OfficeApp;
	/** Optional output path for `manifest`; when omitted, print to stdout. */
	out?: string;
}

/**
 * Resolve the manifest text and optionally write it to `outPath`. Returns the
 * manifest JSON string. Exposed for unit testing.
 */
export async function writeManifest(outPath?: string): Promise<string> {
	const text = await readManifest();
	if (outPath) {
		await Bun.write(outPath, text);
	}
	return text;
}

/** Start the :8444 listener, print the task-pane URL, and block until killed. */
async function runServe(): Promise<void> {
	const server = await startOfficePaneServer();
	console.log(`Serving the xcsh Office task pane at ${server.taskpaneUrl}`);
	if (!server.trusted) {
		console.warn(
			"Warning: a publicly-trusted local-ip.sh cert could not be provisioned; using a self-signed fallback. " +
				"Office's WebView may refuse to load the page until the cert is trusted.",
		);
	}
	console.log("Press Ctrl+C to stop.");
	// Bun.serve holds the event loop open; block run() so the process stays alive.
	await new Promise<never>(() => {});
}

/** Run the Office sideload against the embedded bundle (best-effort). */
async function runSideload(app: OfficeApp): Promise<void> {
	// Point office-addin-debugging at the extracted bundle dir, which has
	// manifest.json AND its referenced `assets/` icons colocated. A bare temp
	// manifest (without the icons next to it) fails office-addin-debugging's zip
	// step: `File to zip ".../assets/color.png" does not exist`.
	const dir = await getOfficePaneDir();
	const manifestPath = path.join(dir, "manifest.json");
	console.log(`Sideloading ${manifestPath} into ${app} (requires the office-addin-debugging / atk tool on PATH)...`);

	const result = spawnSync("office-addin-debugging", ["start", manifestPath, "desktop", "--app", app], {
		stdio: "inherit",
	});
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			console.error(
				"office-addin-debugging was not found on PATH. Install it (e.g. `npm i -g office-addin-debugging` " +
					"or `npm i -g @microsoft/m365agentstoolkit-cli` for `atk`), then run:\n" +
					`  office-addin-debugging start ${manifestPath} desktop --app ${app}`,
			);
			return;
		}
		throw result.error;
	}
	if (typeof result.status === "number" && result.status !== 0) {
		console.error(`office-addin-debugging exited with status ${result.status}.`);
	}
}

/** Dispatch an `xcsh office <action>` invocation. */
export async function runOfficeCommand(args: OfficeCommandArgs): Promise<void> {
	switch (args.action) {
		case "serve":
			await runServe();
			return;
		case "manifest": {
			const text = await writeManifest(args.out);
			if (args.out) {
				console.log(`Wrote manifest to ${args.out}`);
			} else {
				console.log(text);
			}
			return;
		}
		case "sideload":
			await runSideload(args.app ?? "excel");
			return;
	}
}
