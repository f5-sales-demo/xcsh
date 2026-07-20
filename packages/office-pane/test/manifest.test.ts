/**
 * Unified-manifest shape gate.
 *
 * The manifest under `manifest/manifest.json` is the source of truth for the
 * embedded Office add-in served by `xcsh office serve`. It must keep the Excel
 * (`workbook`), PowerPoint (`presentation`), and Word (`document`) scopes, the
 * `Document.ReadWrite.User` permission (required even to READ via the
 * application-specific APIs), the local-ip.sh `:8444` page URL, and absolute
 * https ribbon icon URLs backed by real files we ship.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Single documented constant for the task-pane listener port. The manifest's
 * page URL and the `office serve` listener must agree on this value.
 * `127-0-0-1.local-ip.sh` is the publicly-trusted `*.local-ip.sh` SAN name that
 * resolves to 127.0.0.1, so the WebView loads the page over a genuinely-trusted
 * origin with no dev-cert trust step.
 */
const PORT = 8444;
const TASKPANE_URL = `https://127-0-0-1.local-ip.sh:${PORT}/taskpane.html`;
const LOCAL_IP_HOST = "127-0-0-1.local-ip.sh";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_DIR = resolve(HERE, "..", "manifest");
const MANIFEST_PATH = join(MANIFEST_DIR, "manifest.json");

/** The manifest is a free-form JSON document under test; shape is asserted, not typed. */
type Manifest = any;

async function loadManifest(): Promise<Manifest> {
	const raw = await readFile(MANIFEST_PATH, "utf8");
	return JSON.parse(raw);
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

test("manifest.json exists and parses as JSON", async () => {
	expect(existsSync(MANIFEST_PATH)).toBe(true);
	const m = await loadManifest();
	expect(typeof m).toBe("object");
});

test("required unified-manifest base properties are present and well-formed", async () => {
	const m = await loadManifest();

	expect(typeof m.$schema).toBe("string");
	expect(typeof m.manifestVersion).toBe("string");
	expect(m.id).toMatch(GUID);
	expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);

	expect(typeof m.name.short).toBe("string");
	expect(typeof m.name.full).toBe("string");
	expect(typeof m.description.short).toBe("string");
	expect(typeof m.description.full).toBe("string");

	expect(typeof m.developer.name).toBe("string");
	expect(typeof m.developer.websiteUrl).toBe("string");

	expect(typeof m.icons.color).toBe("string");
	expect(typeof m.icons.outline).toBe("string");
});

test("extension declares the Excel (workbook), PowerPoint (presentation), and Word (document) scopes", async () => {
	const m = await loadManifest();
	const ext = m.extensions[0];
	expect(ext.requirements.scopes).toContain("workbook");
	expect(ext.requirements.scopes).toContain("presentation");
	expect(ext.requirements.scopes).toContain("document");
});

test("the task-pane runtime page URL is the local-ip.sh taskpane.html (not an IP, not localhost)", async () => {
	const m = await loadManifest();
	const runtimes = m.extensions[0].runtimes;
	const pages = runtimes.map((r: { code?: { page?: string } }) => r.code?.page);

	expect(pages).toContain(TASKPANE_URL);
	// Guard the trusted-origin invariant explicitly.
	const page = pages.find((p: string | undefined) => p === TASKPANE_URL);
	expect(page).toContain(LOCAL_IP_HOST);
	expect(page).not.toMatch(/localhost/);
	expect(page).not.toMatch(/\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]/); // no bare IPv4 host
	expect(page).toMatch(/^https:\/\//);
});

test("a ribbon button opens the task pane via a runtime openPage action", async () => {
	const m = await loadManifest();
	const ext = m.extensions[0];

	// Collect openPage actions on general runtimes.
	const openPageActionIds = new Set<string>();
	for (const rt of ext.runtimes ?? []) {
		for (const action of rt.actions ?? []) {
			if (action.type === "openPage") openPageActionIds.add(action.id);
		}
	}
	expect(openPageActionIds.size).toBeGreaterThan(0);

	// Find a ribbon button control wired to one of those actions.
	const buttons: Array<{ type: string; actionId?: string }> = [];
	for (const ribbon of ext.ribbons ?? []) {
		for (const tab of ribbon.tabs ?? []) {
			for (const group of tab.groups ?? []) {
				for (const control of group.controls ?? []) {
					buttons.push(control);
				}
			}
		}
	}
	const opener = buttons.find(c => c.type === "button" && c.actionId && openPageActionIds.has(c.actionId));
	expect(opener).toBeDefined();
});

test("validDomains includes the local-ip.sh host", async () => {
	const m = await loadManifest();
	expect(m.validDomains).toContain(LOCAL_IP_HOST);
});

test("declares Document.ReadWrite.User — required for the application-specific APIs", async () => {
	// Without this, Excel.run/Word.run fail with AccessDenied even to READ: the
	// application-specific APIs (read_range/write_range) require read/write
	// document permission. See requesting-permissions-for-api-use docs.
	const m = await loadManifest();
	const rs = m.authorization?.permissions?.resourceSpecific ?? [];
	expect(rs).toContainEqual({ name: "Document.ReadWrite.User", type: "Delegated" });
});

test("every asset reference in the manifest resolves to a file in manifest/assets/", async () => {
	const m = await loadManifest();
	const raw = await readFile(MANIFEST_PATH, "utf8");

	// Every asset-relative reference anywhere in the manifest must exist on disk.
	const refs = new Set<string>();
	for (const match of raw.matchAll(/"(assets\/[^"]+)"/g)) {
		refs.add(match[1]);
	}
	expect(refs.size).toBeGreaterThan(0);
	for (const ref of refs) {
		expect(existsSync(join(MANIFEST_DIR, ref))).toBe(true);
	}

	// Base icons specifically.
	for (const icon of [m.icons.color, m.icons.outline]) {
		expect(existsSync(join(MANIFEST_DIR, icon))).toBe(true);
	}
});

test("ribbon icon URLs are absolute https on the listener host and back real asset files", async () => {
	// The unified-manifest cloud validator rejects relative ribbon icon URLs
	// (they must match ^https?://). Guard against regressing to relative paths,
	// which silently breaks `atk` sideload. Each must also point at a file we ship.
	const m = await loadManifest();
	const urls: string[] = [];
	for (const ribbon of m.extensions?.[0]?.ribbons ?? []) {
		for (const tab of ribbon.tabs ?? []) {
			for (const group of tab.groups ?? []) {
				for (const icon of group.icons ?? []) urls.push(icon.url);
				for (const control of group.controls ?? []) {
					for (const icon of control.icons ?? []) urls.push(icon.url);
				}
			}
		}
	}
	expect(urls.length).toBeGreaterThan(0);
	for (const url of urls) {
		expect(url).toMatch(new RegExp(`^https://${LOCAL_IP_HOST.replace(/\./g, "\\.")}:${PORT}/assets/`));
		const file = url.split("/assets/")[1];
		expect(existsSync(join(MANIFEST_DIR, "assets", file))).toBe(true);
	}
});
