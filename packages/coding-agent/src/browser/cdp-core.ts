import type { Browser, CDPSession, Page } from "puppeteer";
import type { AcquireMode } from "./acquire";

type Settings = { get(key: string): unknown };

export class BrowserSession {
	#browser: Browser | null = null;
	#page: Page | null = null;
	#cdp: CDPSession | null = null;
	#mode: AcquireMode | null = null;
	constructor(private readonly settings: Settings) {}

	get mode(): AcquireMode | null {
		return this.#mode;
	}

	async ensurePage(): Promise<Page> {
		if (this.#page && !this.#page.isClosed()) return this.#page;
		const { acquirePage } = await import("./acquire");
		const { browser, page, mode } = await acquirePage({ settings: this.settings });
		this.#browser = browser;
		this.#page = page;
		this.#mode = mode;
		this.#cdp = null;
		return this.#page;
	}

	async cdp(): Promise<CDPSession> {
		const page = await this.ensurePage();
		if (!this.#cdp) this.#cdp = await page.createCDPSession();
		return this.#cdp;
	}

	async close(): Promise<void> {
		if (this.#browser) {
			// Never terminate the user's Chrome (attached or launched against their profile);
			// just detach. Puppeteer's disconnect leaves the browser running.
			await this.#browser.disconnect().catch(() => {});
		}
		this.#browser = null;
		this.#page = null;
		this.#cdp = null;
		this.#mode = null;
	}
}
