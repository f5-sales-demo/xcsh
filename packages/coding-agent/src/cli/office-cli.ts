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
import { LOCALIP_HOST } from "../browser/bridge-cert";
import { type HeadlessChatBridge, startHeadlessChatBridge } from "../browser/headless-bridge";
import {
	getOfficePaneDir,
	type OfficePaneServer,
	readManifest,
	startOfficePaneServer,
} from "../browser/office-pane-server";

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

/** Injectable seams for {@link startOfficeServe} (defaulted to the real ones). */
export interface OfficeServeDeps {
	startOfficePaneServer: typeof startOfficePaneServer;
	startHeadlessChatBridge: typeof startHeadlessChatBridge;
}

const defaultServeDeps: OfficeServeDeps = { startOfficePaneServer, startHeadlessChatBridge };

/** A running `office serve`: the pane file server, the (optional) chat bridge, and
 *  a teardown that disposes both. */
export interface OfficeServeHandle {
	server: OfficePaneServer;
	chat: HeadlessChatBridge | null;
	dispose: () => Promise<void>;
}

/**
 * Start BOTH the :8444 pane file server AND the headless chat bridge, so one
 * `xcsh office serve` yields a working pane (no separately-run bridge). A bridge
 * failure is NON-fatal: the pane still serves and we warn, so `serve` degrades to
 * "pane only" rather than failing outright. Returns a teardown that disposes both.
 * Extracted from {@link runServe} so the start/teardown wiring is unit-testable.
 */
export async function startOfficeServe(deps: OfficeServeDeps = defaultServeDeps): Promise<OfficeServeHandle> {
	const server = await deps.startOfficePaneServer();
	let chat: HeadlessChatBridge | null = null;
	try {
		chat = await deps.startHeadlessChatBridge();
	} catch (err) {
		console.warn(
			`Warning: the chat bridge could not start (${err instanceof Error ? err.message : String(err)}). ` +
				"The task pane will load but chat is unavailable until a bridge is running.",
		);
	}
	return {
		server,
		chat,
		dispose: async () => {
			if (chat) await chat.dispose();
			server.stop();
		},
	};
}

/** Start the pane server + chat bridge, print status, and block until killed. */
async function runServe(): Promise<void> {
	const { server, chat, dispose } = await startOfficeServe();
	console.log(`Serving the xcsh Office task pane at ${server.taskpaneUrl}`);
	if (!server.trusted) {
		console.warn(
			"Warning: a publicly-trusted local-ip.sh cert could not be provisioned; using a self-signed fallback. " +
				"Office's WebView may refuse to load the page until the cert is trusted.",
		);
	}
	if (chat) {
		if (chat.bridge.wssPort) {
			console.log(
				`Chat bridge ready on wss://${LOCALIP_HOST}:${chat.bridge.wssPort} — the pane connects automatically.`,
			);
		} else {
			console.warn(
				"Warning: the chat bridge is ws-only (no wss cert). The pane connects over wss and may not reach it.",
			);
		}
	}
	console.log("Press Ctrl+C to stop.");
	// Block until a signal tears us down, then dispose the bridge + pane server.
	await new Promise<void>(resolve => {
		const shutdown = (): void => {
			void dispose().finally(resolve);
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
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
