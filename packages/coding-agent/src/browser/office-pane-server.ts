/**
 * Static HTTPS listener for the embedded Office task pane.
 *
 * Serves the add-in's page shell + JS bundle + unified manifest + ribbon/app
 * icons over a FIXED `https://127-0-0-1.local-ip.sh:8444` origin — the exact URL
 * the manifest's `code.page` and ribbon icon URLs point at. TLS terminates with
 * the SAME publicly-trusted `*.local-ip.sh` cert the `wss` extension bridge uses
 * (via {@link resolveBridgeTls}), so Office's WebView loads the page with real
 * TLS verification and no local trust / MDM step.
 *
 * This listener is SEPARATE from the extension bridge and serves ONLY static GET
 * requests (no WebSocket). It never auto-starts — it is launched exclusively by
 * `xcsh office serve`, keeping blast radius zero.
 *
 * Compiled vs dev (Option A — the pane is a build-time embedded asset of the
 * binary, not a published library):
 *  - COMPILED: the base64 tar.gz baked into `office-pane.generated.txt` is
 *    extracted (once, path-traversal-guarded) to `os.tmpdir()/xcsh-office-pane/<hash>`.
 *  - DEV: assets are read straight from `packages/office-pane/dist` via a
 *    filesystem path — never a module import, so no dependency on the private
 *    office-pane package is introduced.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LOCALIP_HOST, resolveBridgeTls } from "./bridge-cert";
import embeddedPaneArchiveTxt from "./office-pane.generated.txt";

/** Fixed listener port — must match the manifest page + ribbon icon URLs. */
export const OFFICE_PANE_PORT = 8444;
/** Bind loopback only; the local-ip.sh SAN host resolves here for the WebView. */
export const OFFICE_PANE_HOSTNAME = "127.0.0.1";
/** The trusted-origin base URL the task pane is reachable at. */
export const OFFICE_PANE_URL = `https://${LOCALIP_HOST}:${OFFICE_PANE_PORT}`;
/** The task-pane page URL (the manifest `code.page`). */
export const OFFICE_PANE_TASKPANE_URL = `${OFFICE_PANE_URL}/taskpane.html`;

const IS_BUN_COMPILED =
	Bun.env.PI_COMPILED ||
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

// Dev-mode assets: packages/coding-agent/src/browser → packages/office-pane/dist.
const DEV_DIST_DIR = path.resolve(import.meta.dir, "..", "..", "..", "office-pane", "dist");
const COMPILED_DIR_ROOT = path.join(os.tmpdir(), "xcsh-office-pane");

const getEmbeddedArchive = (() => {
	const txt = embeddedPaneArchiveTxt.replaceAll(/[\s\r\n]/g, "").trim();
	if (!txt) return null;
	return () => Buffer.from(txt, "base64");
})();

let compiledDirPromise: Promise<string> | null = null;

/**
 * Sanitize an archive-relative path, rejecting anything that would escape the
 * extraction/serve root (`..`, absolute paths, empty/`.`). Returns the
 * normalized forward-slash path, or `null` when the input is unsafe.
 */
export function sanitizeArchivePath(archivePath: string): string | null {
	const normalized = archivePath.replaceAll("\\", "/").replace(/^\.\//, "");
	if (!normalized || normalized === ".") return null;
	if (normalized.includes("..") || path.isAbsolute(normalized)) return null;
	return normalized;
}

async function extractEmbeddedArchive(archiveBytes: Buffer, outputDir: string): Promise<void> {
	const archive = new Bun.Archive(archiveBytes);
	const files = await archive.files();
	const extractRoot = path.resolve(outputDir);

	for (const [archivePath, file] of files) {
		const sanitizedPath = sanitizeArchivePath(archivePath);
		if (!sanitizedPath) continue;
		const destinationPath = path.resolve(extractRoot, sanitizedPath);
		if (!destinationPath.startsWith(extractRoot + path.sep)) {
			throw new Error(`Archive entry escapes extraction directory: ${archivePath}`);
		}
		await Bun.write(destinationPath, file);
	}
}

/**
 * Resolve the directory the assets are served from: the extracted embedded
 * bundle in a compiled binary, else `packages/office-pane/dist` in dev.
 */
export async function getOfficePaneDir(): Promise<string> {
	if (!IS_BUN_COMPILED) return DEV_DIST_DIR;
	if (compiledDirPromise) return compiledDirPromise;

	const archiveBytes = getEmbeddedArchive?.();
	if (!archiveBytes) {
		throw new Error("Compiled office-pane bundle missing. Rebuild the binary with the embedded office-pane assets.");
	}

	compiledDirPromise = (async () => {
		const bundleHash = Bun.hash(archiveBytes).toString(16);
		const outputDir = path.join(COMPILED_DIR_ROOT, bundleHash);
		const markerPath = path.join(outputDir, "taskpane.html");
		try {
			if ((await fs.stat(markerPath)).isFile()) return outputDir;
		} catch {}

		await fs.rm(outputDir, { recursive: true, force: true });
		await fs.mkdir(outputDir, { recursive: true });
		await extractEmbeddedArchive(archiveBytes, outputDir);
		return outputDir;
	})();

	return compiledDirPromise;
}

/**
 * Pure request handler: map a URL pathname to a file under `dir` and return it
 * with the content-type inferred from its extension, or a 404. `/` maps to
 * `taskpane.html`. Path-traversal is rejected before any filesystem access.
 */
export async function handleAssetRequest(pathname: string, dir: string): Promise<Response> {
	const requested = pathname === "/" ? "taskpane.html" : pathname.replace(/^\/+/, "");
	const safe = sanitizeArchivePath(requested);
	if (!safe) return new Response("Not Found", { status: 404 });

	const root = path.resolve(dir);
	const fullPath = path.resolve(root, safe);
	if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
		return new Response("Not Found", { status: 404 });
	}

	const file = Bun.file(fullPath);
	if (await file.exists()) return new Response(file);
	return new Response("Not Found", { status: 404 });
}

/** Read the embedded/dev manifest.json as text (for `xcsh office manifest`). */
export async function readManifest(): Promise<string> {
	const dir = await getOfficePaneDir();
	return Bun.file(path.join(dir, "manifest.json")).text();
}

export interface OfficePaneServer {
	port: number;
	url: string;
	taskpaneUrl: string;
	/** true when a publicly-trusted `*.local-ip.sh` cert is in use. */
	trusted: boolean;
	stop: () => void;
}

/**
 * Start the fixed :8444 HTTPS listener serving the embedded/dev assets. Resolves
 * TLS via {@link resolveBridgeTls} (the shared local-ip.sh cert). Serves only GET
 * (405 otherwise); unknown paths return 404.
 */
export async function startOfficePaneServer(port = OFFICE_PANE_PORT): Promise<OfficePaneServer> {
	const dir = await getOfficePaneDir();
	const tls = await resolveBridgeTls();

	const server = Bun.serve({
		port,
		hostname: OFFICE_PANE_HOSTNAME,
		tls,
		async fetch(req) {
			if (req.method !== "GET" && req.method !== "HEAD") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			try {
				const url = new URL(req.url);
				return await handleAssetRequest(url.pathname, dir);
			} catch (error) {
				return new Response(error instanceof Error ? error.message : "Internal Server Error", { status: 500 });
			}
		},
	});

	return {
		port: server.port ?? port,
		url: OFFICE_PANE_URL,
		taskpaneUrl: OFFICE_PANE_TASKPANE_URL,
		trusted: tls !== undefined,
		stop: () => server.stop(),
	};
}
