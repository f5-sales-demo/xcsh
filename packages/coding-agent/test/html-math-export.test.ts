import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Browser } from "puppeteer";
import { exportSessionToHtml } from "../src/export/html";
import { SessionManager } from "../src/session/session-manager";
import { assistantMsg } from "./utilities";

const roots: string[] = [];
interface ExportProbe {
	mathCount: number;
	hasDisplayFraction: boolean;
	hasLambda: boolean;
	hasHighlight: boolean;
	text: string;
	hostileElement: boolean;
	pwned: boolean;
	unsafeHref: boolean;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function createExport(markdown: string): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-html-math-"));
	roots.push(root);
	const sm = SessionManager.create(root, root);
	sm.appendMessage(assistantMsg(markdown));
	await sm.ensureOnDisk();
	await sm.flush();
	const output = path.join(root, "offline.html");
	await exportSessionToHtml(sm, undefined, { outputPath: output });
	return fs.readFile(output, "utf8");
}

describe("offline HTML math export", () => {
	test("embeds markdown, highlighting, Temml, CSS, and its fallback font", async () => {
		const html = await createExport("$$x^2$$");
		expect(html).not.toContain("<script src=");
		expect(html).not.toContain("cdnjs.cloudflare.com");
		expect(html).toContain("marked=");
		expect(html).toContain("hljs");
		expect(html).toContain("xcshMath");
		expect(html).toContain("@scope (.markdown-root)");
		expect(html).toContain("data:font/woff2;base64,");
		expect(html).not.toMatch(/url\((?:https?:)?\/\//i);
	});

	test("renders semantic math and highlighted markdown without networking", async () => {
		const markdown = `${String.raw`# Offline

$$
I \propto \frac{1}{\lambda^4}
$$

Inline \(x^2\), price $5.00, shell $HOME and \$escaped.

`}\`\`\`ts\nconst answer = 42;\n\`\`\`\n\n${String.raw`Unsupported: $\includegraphics{https://example.invalid/evil.png}$

Incomplete: $\frac{1

<img id="hostile" src=x onerror="globalThis.pwned=1">

[unsafe](javascript:globalThis.pwned=1)`}`;
		const html = await createExport(markdown);
		const puppeteer = (await import("puppeteer")).default;
		const browser: Browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-background-networking"],
		});
		const errors: string[] = [];
		const requests: string[] = [];
		try {
			const page = await browser.newPage();
			page.on("pageerror", error => errors.push(String(error)));
			await page.setRequestInterception(true);
			page.on("request", request => {
				requests.push(request.url());
				request.abort();
			});
			await page.setOfflineMode(true);
			await page.setContent(html, { waitUntil: "load" });

			const probe = (await page.evaluate(`(() => {
				const root = document.querySelector(".markdown-root");
				const display = root?.querySelector('math[display="block"]');
				return {
					mathCount: root?.querySelectorAll("math").length ?? 0,
					hasDisplayFraction: Boolean(display?.querySelector("mfrac")),
					hasLambda: Array.from(root?.querySelectorAll("mi") ?? []).some(node => node.textContent === "λ"),
					hasHighlight: Boolean(root?.querySelector("pre code.hljs .hljs-keyword")),
					text: root?.textContent ?? "",
					hostileElement: Boolean(document.querySelector("#hostile")),
					pwned: Boolean(globalThis.pwned),
					unsafeHref: Boolean(root?.querySelector('a[href^="javascript:"]')),
				};
			})()`)) as ExportProbe;

			expect(errors).toEqual([]);
			expect(requests).toEqual([]);
			expect(probe.mathCount).toBe(2);
			expect(probe.hasDisplayFraction).toBe(true);
			expect(probe.hasLambda).toBe(true);
			expect(probe.hasHighlight).toBe(true);
			expect(probe.text).not.toContain("\\frac{1}{\\lambda^4}");
			expect(probe.text).toContain(String.raw`$\includegraphics{https://example.invalid/evil.png}$`);
			expect(probe.text).toContain(String.raw`Incomplete: $\frac{1`);
			expect(probe.text).toContain("price $5.00");
			expect(probe.text).toContain("shell $HOME");
			expect(probe.hostileElement).toBe(false);
			expect(probe.pwned).toBe(false);
			expect(probe.unsafeHref).toBe(false);
		} finally {
			await browser.close();
		}
	}, 60_000);
});
