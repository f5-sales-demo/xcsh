import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PANEL_CSS } from "../../chat-ui/src/theme/panel.css";
import { presentCode } from "../../utils/src/code-presentation";
import { codeCatalogMarkdown, codeLanguageCatalog } from "../../utils/test/fixtures/code-language.catalog";
import { exportSessionToHtml } from "../src/export/html";
import { SessionManager } from "../src/session/session-manager";
import { assistantMsg } from "./utilities";

test("Chromium: shared and actual exports retain source, syntax and marked continuations", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-code-browser-"));
	const puppeteer = (await import("puppeteer")).default;
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-background-networking"],
	});
	try {
		const markdown = codeCatalogMarkdown();
		const session = SessionManager.create(directory, directory);
		session.appendMessage(assistantMsg(markdown));
		await session.ensureOnDisk();
		await session.flush();
		const output = join(directory, "catalog.html");
		await exportSessionToHtml(session, undefined, { outputPath: output });
		const exports: Record<string, string> = {};
		for (const themeName of ["xcsh-dark", "xcsh-light"]) {
			await exportSessionToHtml(session, undefined, { outputPath: output, themeName });
			exports[themeName] = await readFile(output, "utf8");
		}
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "../../chat-ui/test/markdown/code-browser-probe.ts")],
			target: "browser",
			format: "iife",
		});
		if (!build.success) throw new AggregateError(build.logs);
		const script = await build.outputs[0].text();
		const page = await browser.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(String(error)));
		await page.setOfflineMode(true);
		for (const surface of ["shared", "export"]) {
			for (const themeName of ["xcsh-dark", "xcsh-light"]) {
				const exported = exports[themeName];
				for (const width of [320, 480, 640, 1200]) {
					await page.setViewport({ width, height: 900 });
					await page.setContent(
						surface === "export"
							? exported
							: `<style>${PANEL_CSS}</style><div class="markdown-root" style="padding:12px"></div>`,
						{ waitUntil: "load" },
					);
					if (surface === "shared") {
						await page.addScriptTag({ content: script });
						await page.evaluate(
							`globalThis.mountCodeCatalog(${JSON.stringify(markdown)}); document.documentElement.dataset.theme = ${JSON.stringify(themeName)}`,
						);
					}
					await page.waitForFunction("document.querySelectorAll('.md-code-row').length > 0");
					if (surface === "export") await page.addScriptTag({ content: script });
					const results = (await page.evaluate("globalThis.probeCodePanels()")) as Array<{
						source: string;
						copied: string;
						text: string;
						categories: string[];
						overflow: boolean;
						continuations: number;
						border: string;
						indentPreserved: boolean;
						colors: Array<{ category: string; color: string; contrast: number; expectedColor?: string }>;
					}>;
					expect(results.length, surface).toBe(codeLanguageCatalog.length);
					for (const [index, result] of results.entries()) {
						const item = codeLanguageCatalog[index];
						expect(result.source, `${surface} ${item.id}`).toBe(item.source);
						expect(result.copied, `${surface} ${item.id}`).toBe(item.source);
						expect(result.text, `${surface} ${item.id}`).toBe(
							presentCode(item.source, item.language).display.replace(/\t/g, "    "),
						);
						expect(result.overflow, `${surface} ${item.id} ${width}`).toBe(false);
						expect(result.border).toBe("2px");
						expect(result.indentPreserved, `${surface} ${themeName} ${item.id} continuation indentation`).toBe(
							true,
						);
						for (const color of result.colors) {
							if (color.expectedColor)
								expect(color.color, `${surface} ${themeName} ${item.id} ${color.category}`).toBe(
									color.expectedColor,
								);

							expect(
								color.contrast,
								`${surface} ${themeName} ${item.id} ${color.category}`,
							).toBeGreaterThanOrEqual(4.5);
						}
						if (item.id === "unknown" || item.id === "unspecified") expect(result.categories.length).toBe(0);
						if (item.id === "long-literal") expect(result.continuations).toBeGreaterThan(0);
						if (item.id === "hcl")
							for (const category of ["comment", "keyword", "attr", "string", "number", "control", "operator"])
								expect(result.categories).toContain(`hljs-${category}`);
					}
					expect(await page.$(".md-lang-label")).toBeNull();
					if (process.env.XCSH_CODE_SCREENSHOT_DIR) {
						await mkdir(process.env.XCSH_CODE_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
						await page.screenshot({
							path: join(process.env.XCSH_CODE_SCREENSHOT_DIR, `${surface}-${themeName}-${width}.png`),
							fullPage: true,
						});
						await Bun.write(join(process.env.XCSH_CODE_SCREENSHOT_DIR, `${themeName}-catalog.html`), exported);
					}
				}
			}
		}
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
}, 120_000);
