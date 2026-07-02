/**
 * Backend-agnostic page-driving abstraction.
 *
 * Lets the catalog-workflow-runner drive both a CDP (Puppeteer) page and the
 * Chrome extension through one identical surface. Implementations: `CdpPageActions`
 * (./cdp-page-actions) and the extension-backed equivalent.
 */
export interface PageActions {
	goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
	/** `opts.native` forces a synthetic DOM `.click()` instead of the trusted CDP
	 * mouse dispatch — the escalation for controls that ignore real mouse events
	 * (used by the runner on click-step retries). Backends free to ignore it. */
	click(selector: string, context?: string, opts?: { native?: boolean }): Promise<void>;
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
	/** Extension-only: show an explanatory text callout near a target element
	 * (instructor narration). The text fades after ~2s. */
	showCallout?(selector: string, text: string): Promise<void>;
	/** Extension-only: highlight an element's bounding box ('look here' cue
	 * before clicking in guided/instructor profiles). */
	highlightElement?(selector: string): Promise<void>;
}
