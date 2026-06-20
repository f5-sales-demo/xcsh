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
import { type ExtensionPage, resolveRef } from "./extension-provider";
import type { PageActions } from "./page-actions";

export class ExtensionPageActions implements PageActions {
	#ext: ExtensionPage;

	constructor(ext: ExtensionPage) {
		this.#ext = ext;
	}

	async goto(url: string): Promise<void> {
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
		const b64 = await this.#ext.screenshot();
		await Bun.write(file, Buffer.from(b64, "base64"));
	}
}
