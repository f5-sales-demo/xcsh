import type { Page } from "puppeteer";
import { resolve } from "./resolver";

/** XC-SPA-aware: wait until the console's loading/spinner indicators clear. */
export async function waitForXcSettled(page: Page, timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const busy = await page
			.evaluate((): boolean => {
				const sel = '[aria-busy="true"], .ant-spin-spinning, [role="progressbar"], .loading-indicator';
				return (document as unknown as { querySelector(s: string): unknown }).querySelector(sel) != null;
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
			await h.click();
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
			await h.focus();
			await h.evaluate((el, v) => {
				const e = el as unknown as { value: string; dispatchEvent(ev: Event): void };
				e.value = String(v);
				e.dispatchEvent(new Event("input", { bubbles: true }));
				e.dispatchEvent(new Event("change", { bubbles: true }));
			}, value);
		} finally {
			await h.dispose().catch(() => {});
		}
	});
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
