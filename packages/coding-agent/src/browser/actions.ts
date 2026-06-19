import type { Page } from "puppeteer";
import { commitInputValue } from "./input-commit";
import { resolve } from "./resolver";

/** Delay after a fill to let blur-triggered framework revalidation complete. */
const SETTLE_AFTER_FILL_MS = 600;

/** Resolve after `ms` milliseconds (a small, explicit settle for SPA timing). */
function settle(ms: number): Promise<void> {
	return new Promise(resolveSettle => setTimeout(resolveSettle, ms));
}

/** XC-SPA-aware: wait until the console's loading/spinner indicators clear. */
export async function waitForXcSettled(page: Page, timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const busy = await page
			.evaluate((): boolean => {
				const sel = '[aria-busy="true"], .ant-spin-spinning, [role="progressbar"], .loading-indicator';
				const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document;
				return doc.querySelector(sel) != null;
			})
			.catch(() => false);
		if (!busy) return;
		await Bun.sleep(150);
	}
}

async function withRetry<T>(fn: () => Promise<T>, timeoutMs = 15000): Promise<T> {
	const start = Date.now();
	let last: unknown;
	while (Date.now() - start < timeoutMs) {
		try {
			return await fn();
		} catch (e) {
			last = e;
			await Bun.sleep(150);
		}
	}
	throw last instanceof Error ? last : new Error(String(last));
}

export async function click(page: Page, selector: string, context?: string): Promise<void> {
	await waitForXcSettled(page);
	await withRetry(async () => {
		const h = await resolve(page, selector, context);
		try {
			await h.scrollIntoView().catch(() => {});
			try {
				await h.click();
			} catch {
				// sticky/offscreen elements: synthetic DOM click fallback
				await h.evaluate(el => (el as unknown as { click(): void }).click());
			}
		} finally {
			await h.dispose().catch(() => {});
		}
	});
}

export async function fill(page: Page, selector: string, value: string, context?: string): Promise<void> {
	await waitForXcSettled(page);
	await withRetry(async () => {
		const h = await resolve(page, selector, context);
		try {
			await h.focus().catch(() => {});
			// Set the value through the native value setter + framework events
			// (input/change/blur/focusout). This replaces any existing value and is
			// the robust path for framework-bound controls — including the console's
			// vsui-input over ngx-datatable, whose patched value descriptor swallows
			// plain keystrokes so they never reach the Angular model. (Use the `type`
			// action for fields that must observe individual keystrokes.)
			await h.evaluate(commitInputValue, value);
		} finally {
			await h.dispose().catch(() => {});
		}
	});
	// Let the framework's blur-triggered revalidation run before the next action
	// (Angular `updateOn: 'blur'` controls update validity asynchronously, so an
	// immediate Save would otherwise still see the field as invalid).
	await settle(SETTLE_AFTER_FILL_MS);
}

export async function selectOption(page: Page, selector: string, value: string, context?: string): Promise<void> {
	await click(page, selector, context); // open the listbox/combobox
	await click(page, `option:text('${value}')`); // pick the option by role+name
}

export async function scrollIntoView(page: Page, selector: string, context?: string): Promise<void> {
	await waitForXcSettled(page);
	const h = await resolve(page, selector, context);
	try {
		await h.scrollIntoView();
	} finally {
		await h.dispose().catch(() => {});
	}
}

export async function pressKey(page: Page, key: string): Promise<void> {
	await page.keyboard.press(key as Parameters<Page["keyboard"]["press"]>[0]);
}

export async function assertText(page: Page, selector: string, expected: string, context?: string): Promise<void> {
	await waitForXcSettled(page);
	const h = await resolve(page, selector, context);
	try {
		const txt = (await h.evaluate(el => (el as unknown as { innerText: string }).innerText)) as string;
		if (!txt.includes(expected)) throw new Error(`assert failed: "${expected}" not in "${txt.slice(0, 200)}"`);
	} finally {
		await h.dispose().catch(() => {});
	}
}

export async function waitFor(page: Page, selector: string, context?: string, timeoutMs = 30000): Promise<void> {
	await withRetry(async () => {
		const h = await resolve(page, selector, context);
		await h.dispose().catch(() => {});
	}, timeoutMs);
}

export async function screenshot(page: Page, file: string): Promise<void> {
	if (!file.endsWith(".png") || file.includes("..") || file.includes("\0")) {
		throw new Error(`Invalid screenshot path: ${file}`);
	}
	await page.screenshot({ path: file as `${string}.png`, type: "png" });
}
