import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PANEL_CSS } from "../../chat-ui/src/theme/panel.css";
import catalog from "../../chat-ui/test/markdown/fixtures/synthesized.catalog.json";
import { exportSessionToHtml } from "../src/export/html";
import { SessionManager } from "../src/session/session-manager";
import { assistantMsg } from "./utilities";

const body = `\tprintf '%s' '${"x".repeat(180)}'\n\n# literal <tag> & value`;
const source = `- **Strong** and [link](https://example.test)\n\n\`\`\`\`bash extra\n${body}\n\`\`\`\n\`\`\`\`\n\n| Name | Value |\n| --- | ---: |\n| ${"url".repeat(120)} | 0 |`;

test("shared web and generated exports preserve code and wrap narrow content", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-md-fidelity-"));
	const puppeteer = (await import("puppeteer")).default;
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-background-networking"],
	});
	try {
		const sm = SessionManager.create(root, root);
		sm.appendMessage(assistantMsg(source));
		await sm.ensureOnDisk();
		await sm.flush();
		const output = path.join(root, "offline.html");
		await exportSessionToHtml(sm, undefined, { outputPath: output });
		const html = await fs.readFile(output, "utf8");
		const build = await Bun.build({
			entrypoints: [path.resolve(import.meta.dir, "../../chat-ui/test/markdown/browser-entry.ts")],
			target: "browser",
			format: "iife",
		});
		if (!build.success) throw new AggregateError(build.logs);
		const script = await build.outputs[0].text();
		const page = await browser.newPage();
		await page.setOfflineMode(true);
		for (const [surface, documentHtml] of [
			["export", html],
			["shared", `<style>${PANEL_CSS}</style><div class="markdown-root" style="padding:12px"></div>`],
		]) {
			for (const width of [320, 480, 640]) {
				await page.setViewport({ width, height: 900 });
				await page.setContent(documentHtml, { waitUntil: "load" });
				if (surface === "shared") {
					await page.addScriptTag({ content: script });
					await page.evaluate(
						`document.head.insertAdjacentHTML("beforeend", "<style>" + globalThis.cssVars() + "</style>"); document.querySelector(".markdown-root").innerHTML = globalThis.renderMarkdown(${JSON.stringify(source)})`,
					);
				}
				const result = (await page.evaluate(`(() => {
					const root = document.querySelector(".markdown-root");
					const code = root.querySelector("pre code");
					const pre = code.parentElement;
					return {
						code: code.textContent,
						label: root.querySelector(".md-lang-label")?.textContent,
						strong: root.querySelector("li strong")?.textContent,
						whiteSpace: getComputedStyle(code).whiteSpace,
						overflow: pre.scrollWidth > pre.clientWidth + 1,
						tableOverflow:
							root.querySelector("table").getBoundingClientRect().right >
							root.getBoundingClientRect().right + 1,
					};
				})()`)) as {
					code: string;
					label: string;
					strong: string;
					whiteSpace: string;
					overflow: boolean;
					tableOverflow: boolean;
				};
				expect(result.code?.replace(/\n$/, ""), `${surface} code`).toBe(`${body}\n\`\`\``);
				if (process.env.XCSH_MARKDOWN_SCREENSHOT_DIR) {
					await fs.mkdir(process.env.XCSH_MARKDOWN_SCREENSHOT_DIR, { recursive: true, mode: 0o700 });
					await page.screenshot({
						path: path.join(process.env.XCSH_MARKDOWN_SCREENSHOT_DIR, `${surface}-${width}.png`),
					});
				}
				expect(result.strong, surface).toBe("Strong");
				expect(result.label, surface).toBe("bash");
				expect(result.whiteSpace, `${surface} at ${width}`).toBe("pre-wrap");
				expect(result.overflow, `${surface} code at ${width}`).toBe(false);
				expect(result.tableOverflow, `${surface} table at ${width}`).toBe(false);
			}
		}
		for (const item of catalog) {
			const session = SessionManager.create(root, root);
			session.appendMessage(assistantMsg(item.markdown));
			await session.ensureOnDisk();
			await session.flush();
			const output = path.join(root, `${item.id}.html`);
			await exportSessionToHtml(session, undefined, { outputPath: output });
			const exported = await fs.readFile(output, "utf8");
			for (const surface of ["export", "shared"]) {
				for (const width of [320, 480, 640]) {
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
							`document.head.insertAdjacentHTML("beforeend", "<style>" + globalThis.cssVars() + "</style>"); document.querySelector(".markdown-root").innerHTML = globalThis.renderMarkdown(${JSON.stringify(item.markdown)})`,
						);
					}
					const counts = (await page.evaluate(
						`Object.fromEntries(${JSON.stringify(Object.keys(item.selectors))}.map(selector => [selector, document.querySelectorAll(".markdown-root " + selector).length]))`,
					)) as Record<string, number>;
					for (const [selector, minimum] of Object.entries(item.selectors))
						expect(counts[selector], `${item.id} ${surface} ${width} ${selector}`).toBeGreaterThanOrEqual(
							minimum!,
						);
				}
			}
		}
	} finally {
		await browser.close();
		await fs.rm(root, { recursive: true, force: true });
	}
}, 60_000);
