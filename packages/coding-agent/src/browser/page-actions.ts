/**
 * Backend-agnostic page-driving abstraction.
 *
 * Lets the catalog-workflow-runner drive both a CDP (Puppeteer) page and the
 * Chrome extension through one identical surface. Implementations: `CdpPageActions`
 * (./cdp-page-actions) and the extension-backed equivalent.
 */
export interface PageActions {
	goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
	click(selector: string, context?: string): Promise<void>;
	fill(selector: string, value: string, context?: string): Promise<void>;
	selectOption(selector: string, value: string, context?: string): Promise<void>;
	scrollIntoView(selector: string, context?: string): Promise<void>;
	pressKey(key: string): Promise<void>;
	assertText(selector: string, expected: string, context?: string): Promise<void>;
	waitFor(selector: string, context?: string, timeoutMs?: number): Promise<void>;
	screenshot(file: string): Promise<void>;
	/** Extension-only: toggle "explain mode" so on-page annotation overlays
	 * (fingerprints/highlights) show during human-paced (observable) runs.
	 * Backends that don't support it (CDP/Puppeteer) omit this method. */
	setExplainMode?(enabled: boolean): Promise<void>;
}
