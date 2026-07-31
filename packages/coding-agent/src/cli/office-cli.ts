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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LOCALIP_HOST } from "../browser/bridge-cert";
import { type HeadlessChatBridge, startHeadlessChatBridge } from "../browser/headless-bridge";
import {
	getOfficePaneDir,
	OFFICE_PANE_PORT,
	type OfficePaneServer,
	OfficePaneUnavailableError,
	readManifest,
	startOfficePaneServer,
} from "../browser/office-pane-server";
import { recycleOfficeServe, supersedeStaleServe } from "../browser/office-serve-lifecycle";

/** The subcommands `xcsh office` accepts (also the Args `options` constraint). */
export const OFFICE_ACTIONS = ["serve", "manifest", "sideload", "recycle"] as const;
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
	supersedeStaleServe: typeof supersedeStaleServe;
}

const defaultServeDeps: OfficeServeDeps = { startOfficePaneServer, startHeadlessChatBridge, supersedeStaleServe };

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
	// Step down a stale serve squatting :8444 (e.g. left over from before a
	// `brew upgrade`) so this start binds cleanly instead of "port 8444 in use".
	const superseded = await deps.supersedeStaleServe(OFFICE_PANE_PORT);
	if (superseded.superseded) {
		console.log(
			`Superseded a previous office serve (PID ${superseded.pid}) that was holding port ${OFFICE_PANE_PORT}.`,
		);
	}
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

/** The macOS Office desktop containers whose `wef` folder holds sideloaded manifests. */
const OFFICE_WEF_CONTAINERS = ["com.microsoft.Excel", "com.microsoft.Powerpoint", "com.microsoft.Word"];

/** The `wef` sideload directories for the desktop Office apps under `homeDir`. */
export function officeWefDirs(homeDir: string): string[] {
	return OFFICE_WEF_CONTAINERS.map(c => path.join(homeDir, "Library", "Containers", c, "Data", "Documents", "wef"));
}

/**
 * `office-addin-debugging` symlinks the add-in manifest into each Office container's
 * `wef` folder as `<manifestId>.manifest.json` and fails `EEXIST` if a link from a
 * prior sideload is already there — so a repeat sideload errors even though the
 * add-in registered fine. Remove any stale copy for our id so `office sideload` is
 * idempotent. Best-effort per dir (a missing file or container is a no-op). Returns
 * the paths actually removed.
 */
export function removeStaleWefManifests(manifestId: string, homeDir: string = os.homedir()): string[] {
	const removed: string[] = [];
	for (const dir of officeWefDirs(homeDir)) {
		const p = path.join(dir, `${manifestId}.manifest.json`);
		try {
			if (fs.existsSync(p)) {
				fs.rmSync(p);
				removed.push(p);
			}
		} catch {
			/* best-effort: a permission error or race here must not block the sideload */
		}
	}
	return removed;
}

/** The add-in manifest id from the bundled manifest.json (the `wef` link's basename). */
function manifestIdFrom(manifestText: string): string | undefined {
	try {
		const id = (JSON.parse(manifestText) as { id?: unknown }).id;
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

/** Run the Office sideload against the embedded bundle (idempotent + best-effort). */
async function runSideload(app: OfficeApp): Promise<void> {
	// Point office-addin-debugging at the extracted bundle dir, which has
	// manifest.json AND its referenced `assets/` icons colocated. A bare temp
	// manifest (without the icons next to it) fails office-addin-debugging's zip
	// step: `File to zip ".../assets/color.png" does not exist`.
	const dir = await getOfficePaneDir();
	const manifestPath = path.join(dir, "manifest.json");

	// Idempotency: office-addin-debugging fails EEXIST if a prior sideload left a
	// `<id>.manifest.json` link in a container's wef folder. Clear stale copies first.
	const manifestId = manifestIdFrom(
		await Bun.file(manifestPath)
			.text()
			.catch(() => ""),
	);
	if (manifestId) {
		const removed = removeStaleWefManifests(manifestId);
		if (removed.length > 0) {
			console.log(`Cleared ${removed.length} stale sideload manifest link(s) from a previous sideload.`);
		}
	}

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

/**
 * The two long-running halves of the command, injectable so the dispatch order can be
 * tested without binding :8444 or shelling out to `office-addin-debugging`.
 */
export interface OfficeCommandDeps {
	sideload: (app: OfficeApp) => Promise<void>;
	serve: () => Promise<void>;
}

const defaultCommandDeps: OfficeCommandDeps = { sideload: runSideload, serve: runServe };

/** Dispatch an `xcsh office <action>` invocation. */
export async function runOfficeCommand(
	args: OfficeCommandArgs,
	deps: OfficeCommandDeps = defaultCommandDeps,
): Promise<void> {
	try {
		await dispatchOfficeCommand(args, deps);
	} catch (err) {
		// Only this one class. The published npm form carries `office` and no pane bundle, so every
		// action here can legitimately have nothing to work with — that is a fact about the install,
		// not a defect, and it deserves the remedy rather than a stack trace. Anything else rethrows
		// with its stack intact, because swallowing a real failure here is how the original silent
		// 404 survived.
		if (!(err instanceof OfficePaneUnavailableError)) throw err;
		console.error(err.message);
		process.exitCode = 1;
	}
}

async function dispatchOfficeCommand(args: OfficeCommandArgs, deps: OfficeCommandDeps): Promise<void> {
	switch (args.action) {
		case "serve":
			await deps.serve();
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
			// Register FIRST, then serve — serve blocks until a signal, so anything
			// sequenced after it would never run.
			//
			// Registering alone used to be the whole command, which quietly left the
			// operator half-configured: the pane's cwd (what its file tools and shell are
			// confined to) comes from wherever `office serve` was launched, so a bare
			// sideload produced a pane pointed at some unrelated folder, or at nothing.
			// One command from the folder you care about now does both.
			await deps.sideload(args.app ?? "excel");
			await deps.serve();
			return;
		case "recycle":
			console.log(await recycleOfficeServe());
			return;
	}
}
