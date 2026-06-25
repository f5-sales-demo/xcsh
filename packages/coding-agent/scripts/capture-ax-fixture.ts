#!/usr/bin/env bun
// One-shot capture: login + open the HTTP-LB create form + snapshot the accessibility tree.
// Creds via env (XCSH_USERNAME/XCSH_CONSOLE_PASSWORD); never hard-coded. Output is the resolver's test oracle.
import puppeteer from "puppeteer";

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.XCSH_CONSOLE_URL ?? "https://nferreira.staging.volterra.us";
const NS = process.env.XCSH_NS ?? "demo";
const OUT = "test/browser/fixtures/xc-http-lb-create.ax.json";

const browser = await puppeteer.launch({
	headless: true,
	executablePath: CHROME,
	userDataDir: "/tmp/xc-ax-capture",
});
try {
	const page = (await browser.pages())[0] ?? (await browser.newPage());
	await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => {});
	if (/login-staging\.volterra\.us/.test(page.url())) {
		await page.waitForSelector("#username", { timeout: 20000 });
		await page.type("#username", process.env.XCSH_USERNAME ?? "");
		await page.type("#password", process.env.XCSH_CONSOLE_PASSWORD ?? "");
		await Promise.all([
			page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
			page.click("#kc-login").catch(() => page.keyboard.press("Enter")),
		]);
		await new Promise(r => setTimeout(r, 4000));
	}
	const route = `/web/workspaces/web-app-and-api-protection/namespaces/${NS}/manage/load_balancers/http_loadbalancers`;
	await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 45000 });
	await new Promise(r => setTimeout(r, 4000));
	// open the create form: click the "Add HTTP Load Balancer" tab via its resolved handle
	{
		const h = (await page.$("aria/Add HTTP Load Balancer")) ?? (await page.$("text/Add HTTP Load Balancer"));
		if (!h) {
			console.log("could not resolve the Add tab handle");
		} else {
			await h.click().catch(async () => {
				await h.evaluate(el => (el as { click(): void }).click()).catch(() => {});
			});
			await h.dispose();
		}
	}
	// wait until the create form's Name textbox is present in the AX tree (form actually open)
	let opened = false;
	for (let i = 0; i < 40; i++) {
		await new Promise(r => setTimeout(r, 1000));
		const s = await page.accessibility.snapshot({ interestingOnly: false });
		const hasName = (function find(n: { role?: string; name?: string; children?: unknown[] }): boolean {
			if (n.role === "textbox" && (n.name ?? "").trim() === "Name") return true;
			return (n.children ?? []).some(c => find(c as never));
		})((s ?? {}) as never);
		if (hasName) {
			opened = true;
			break;
		}
	}
	console.log("create form opened (Name textbox present):", opened, "url=", page.url().slice(0, 110));
	const snap = await page.accessibility.snapshot({ interestingOnly: false });
	if (!snap) throw new Error("accessibility snapshot was null");
	await Bun.write(OUT, JSON.stringify(snap, null, 2));
	// also capture the create-form DOM root (for DOM-structural context-scoping tests)
	const HTML_OUT = "test/browser/fixtures/xc-http-lb-create.html";
	const formHtml = await page.evaluate(() => {
		const d = (
			globalThis as unknown as {
				document: { querySelector(s: string): { outerHTML: string } | null; body: { outerHTML: string } };
			}
		).document;
		const root = d.querySelector('[role="main"], main, .ant-drawer-body, .ant-modal-body') ?? d.body;
		return root.outerHTML;
	});
	await Bun.write(HTML_OUT, formHtml);
	console.log(`wrote ${HTML_OUT} (${formHtml.length} bytes)`);
	const json = JSON.stringify(snap);
	const roleCount = (role: string) => (json.match(new RegExp(`"role":"${role}"`, "g")) ?? []).length;
	console.log(`wrote ${OUT} (${json.length} bytes)`);
	console.log(`url=${page.url().slice(0, 90)}`);
	console.log(
		`roles: tab=${roleCount("tab")} textbox=${roleCount("textbox")} button=${roleCount("button")} listbox=${roleCount("listbox")}`,
	);
} finally {
	await browser.close().catch(() => {});
}
