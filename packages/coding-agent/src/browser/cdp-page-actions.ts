import type { Page } from "puppeteer";
import * as actions from "./actions";
import type { PageActions } from "./page-actions";

/** CDP-backed `PageActions`: wraps a Puppeteer `Page` and delegates to `actions.ts`. */
export class CdpPageActions implements PageActions {
	#page: Page;
	constructor(page: Page) {
		this.#page = page;
	}

	async goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void> {
		type GotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;
		await this.#page.goto(url, {
			waitUntil: (opts?.waitUntil as GotoOptions["waitUntil"]) ?? "networkidle2",
			timeout: opts?.timeout,
		});
	}

	async click(selector: string, context?: string, _opts?: { native?: boolean }): Promise<void> {
		// CDP/Puppeteer has no trusted-vs-native split — a Puppeteer click already
		// dispatches real events to the resolved element; the `native` escalation
		// hint is an extension-only concern, so ignore it here.
		await actions.click(this.#page, selector, context);
	}

	async fill(selector: string, value: string, context?: string): Promise<void> {
		await actions.fill(this.#page, selector, value, context);
	}

	async selectOption(selector: string, value: string, context?: string): Promise<void> {
		await actions.selectOption(this.#page, selector, value, context);
	}

	async scrollIntoView(selector: string, context?: string): Promise<void> {
		await actions.scrollIntoView(this.#page, selector, context);
	}

	async pressKey(key: string): Promise<void> {
		await actions.pressKey(this.#page, key);
	}

	async assertText(selector: string, expected: string, context?: string): Promise<void> {
		await actions.assertText(this.#page, selector, expected, context);
	}

	async waitFor(selector: string, context?: string, timeoutMs?: number): Promise<void> {
		await actions.waitFor(this.#page, selector, context, timeoutMs);
	}

	async screenshot(file: string): Promise<void> {
		await actions.screenshot(this.#page, file);
	}
}
