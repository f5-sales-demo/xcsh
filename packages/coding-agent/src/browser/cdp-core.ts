import type { Browser, CDPSession, Page } from "puppeteer";
import { assertLoopbackBrowserUrl, pickCoDrivePage, resolveBrowserConnectUrl } from "../tools/browser";

type Settings = { get(key: string): unknown };

export class BrowserSession {
	#browser: Browser | null = null;
	#page: Page | null = null;
	#cdp: CDPSession | null = null;
	constructor(private readonly settings: Settings) {}

	async ensurePage(): Promise<Page> {
		if (this.#page && !this.#page.isClosed()) return this.#page;
		const puppeteer = (await import("puppeteer")).default;
		const connectUrl = resolveBrowserConnectUrl(this.settings);
		if (connectUrl) {
			assertLoopbackBrowserUrl(connectUrl);
			this.#browser = await puppeteer.connect({ browserURL: connectUrl });
			const pages = await this.#browser.pages();
			this.#page = pages.length ? pages[pickCoDrivePage(pages)]! : await this.#browser.newPage();
		} else {
			this.#browser = await puppeteer.launch({ headless: !!this.settings.get("browser.headless") });
			this.#page = await this.#browser.newPage();
		}
		return this.#page;
	}

	async cdp(): Promise<CDPSession> {
		const page = await this.ensurePage();
		if (!this.#cdp) this.#cdp = await page.createCDPSession();
		return this.#cdp;
	}

	async close(): Promise<void> {
		const connectUrl = resolveBrowserConnectUrl(this.settings);
		if (this.#browser) {
			if (connectUrl) this.#browser.disconnect();
			else await this.#browser.close();
		}
		this.#browser = null;
		this.#page = null;
		this.#cdp = null;
	}
}
