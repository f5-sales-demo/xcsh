/**
 * Extension-backed {@link PageActions} implementation.
 *
 * Wraps an {@link ExtensionPage} (the Chrome extension bridge surface) so the
 * catalogue-workflow runner can drive the extension through the exact same
 * `PageActions` interface it uses for CDP. For tools that operate on a `ref`
 * handle (`click`/`fill`/`selectOption`/`scrollIntoView`), resolution happens
 * xcsh-side: read the AX tree, {@link resolveRef} the selector to a `ref`, then
 * call the bridge tool. `assertText`/`waitFor` resolve selectors on the bridge
 * (service-worker) side, so they pass through directly.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtensionPage, resolveRef } from "./extension-provider";
import type { PageActions } from "./page-actions";

const ALLOWED_SCHEMES = new Set(["https:"]);
const CONSOLE_DOMAIN_RE = /\.(volterra\.us|console\.ves\.volterra\.io)$/;

export class ExtensionPageActions implements PageActions {
	#ext: ExtensionPage;

	constructor(ext: ExtensionPage) {
		this.#ext = ext;
	}

	async goto(url: string): Promise<void> {
		// Defense-in-depth: validate URL scheme + console-domain scope before sending to the extension.
		// The extension SW also validates, but rejecting early is cleaner + prevents SSRF.
		const parsed = new URL(url); // throws on malformed
		if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
			throw new Error(`Disallowed URL scheme: ${parsed.protocol} (only https: is allowed)`);
		}
		if (!CONSOLE_DOMAIN_RE.test(parsed.hostname)) {
			throw new Error(`URL "${parsed.hostname}" is not an F5 XC console domain`);
		}
		await this.#ext.navigate(url);
	}

	async click(selector: string, _context?: string): Promise<void> {
		const tree = await this.#ext.readAx();
		const ref = resolveRef(tree, selector);
		await this.#ext.click(ref);
	}

	async fill(selector: string, value: string, _context?: string): Promise<void> {
		const tree = await this.#ext.readAx();
		const ref = resolveRef(tree, selector);
		await this.#ext.formInput(ref, value);
	}

	async selectOption(selector: string, value: string, _context?: string): Promise<void> {
		const tree = await this.#ext.readAx();
		const ref = resolveRef(tree, selector);
		await this.#ext.selectOption(ref, value);
	}

	async scrollIntoView(selector: string, _context?: string): Promise<void> {
		const tree = await this.#ext.readAx();
		const ref = resolveRef(tree, selector);
		await this.#ext.scrollTo(ref);
	}

	async pressKey(key: string): Promise<void> {
		await this.#ext.keyPress(key);
	}

	async assertText(selector: string, expected: string, context?: string): Promise<void> {
		await this.#ext.assertText(selector, expected, context);
	}

	async waitFor(selector: string, context?: string, timeoutMs?: number): Promise<void> {
		await this.#ext.waitFor(selector, context, timeoutMs);
	}

	async screenshot(file: string): Promise<void> {
		// Defense-in-depth: resolve symlinks via realpathSync so a symlinked parent
		// can't bypass the cwd containment check and write outside the working directory.
		const cwdReal = fs.realpathSync(process.cwd());
		const lexical = path.resolve(file);
		let parentReal: string;
		try {
			parentReal = fs.realpathSync(path.dirname(lexical));
		} catch {
			throw new Error(`Screenshot directory does not exist: ${path.dirname(lexical)}`);
		}
		const resolved = path.join(parentReal, path.basename(lexical));
		if (!resolved.startsWith(cwdReal + path.sep) && resolved !== cwdReal) {
			throw new Error(`Screenshot path "${file}" resolves outside the working directory`);
		}
		const b64 = await this.#ext.screenshot();
		await Bun.write(resolved, Buffer.from(b64, "base64"));
	}
}
