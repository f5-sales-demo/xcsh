import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Container, setTerminalHyperlinks, TERMINAL } from "@f5-sales-demo/pi-tui";
import { presentAuthLink, presentDeviceCode } from "../../../src/modes/components/auth-link-presenter";
import { selectorFrame, selectorFrameContentWidth, selectorProse } from "../../../src/modes/components/selector-frame";
import { initTheme } from "../../../src/modes/theme/theme";
import { applyHyperlinkSetting } from "../../../src/tui/hyperlink";

const LONG_URL =
	"https://login.example.test/authorize?client_id=synthetic-client&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback&scope=openid%20profile&state=synthetic-state&code_challenge=synthetic-challenge";

const OSC_8_OPEN = /\x1b\]8;;([^\x07]+)\x07/g;
const OSC_8_CLOSE = /\x1b\]8;;\x07/g;
const originalHyperlinkCapability = TERMINAL.hyperlinks;

beforeAll(() => {
	initTheme();
	setTerminalHyperlinks(true);
});

afterAll(() => setTerminalHyperlinks(originalHyperlinkCapability));

describe("presentDeviceCode", () => {
	it("keeps the verification URL and one-time code visible in a narrow terminal", () => {
		const container = new Container();
		const url = "https://auth.openai.com/codex/device";
		presentDeviceCode(container, url, "ABCD-EFGH");
		const rendered = container.render(24).join("\n");
		const visible = Bun.stripANSI(rendered);
		expect(visible.replace(/\s/g, "")).toContain(url);
		expect(visible).toContain("ABCD-EFGH");
		expect(visible).toContain("Press c");
		expect(rendered).toContain(`\x1b]8;;${url}\x07`);
	});
});

describe("presentAuthLink", () => {
	for (const width of [18, 80]) {
		it(`keeps the exact target hidden and each rendered link segment balanced at width ${width}`, () => {
			const container = new Container();

			presentAuthLink(container, LONG_URL, { platform: "linux" });

			const renderedLines = container.render(width);
			const rendered = renderedLines.join("\n");
			const visible = Bun.stripANSI(rendered).replace(/\s+/g, " ").trim();
			expect(visible).toContain("Open sign-in page");
			expect(visible).toContain("Ctrl+click to open");
			expect(visible).not.toContain("full URL is visible");
			expect(visible).not.toContain(LONG_URL);

			const linkedLines = renderedLines.filter(line => line.includes("\x1b]8;;"));
			expect(linkedLines.length).toBeGreaterThan(0);
			for (const line of linkedLines) {
				const targets = [...line.matchAll(OSC_8_OPEN)].map(match => match[1]);
				const closes = line.match(OSC_8_CLOSE) ?? [];
				expect(targets.length).toBe(closes.length);
				expect(targets.every(target => target === LONG_URL)).toBe(true);
			}
		});
	}

	it("uses the macOS click hint", () => {
		const container = new Container();
		presentAuthLink(container, LONG_URL, { platform: "darwin" });

		const visible = Bun.stripANSI(container.render(80).join("\n")).replace(/\s+/g, " ").trim();
		expect(visible).toContain("Cmd+click to open");
		expect(visible).not.toContain("Ctrl+click to open");
	});

	it("keeps each wrapped recovery segment linked when automatic detection is unavailable", () => {
		setTerminalHyperlinks(false);
		try {
			const container = new Container();
			presentAuthLink(container, LONG_URL, { platform: "linux" });

			const rendered = container.render(44).join("\n");
			const targets = [...rendered.matchAll(OSC_8_OPEN)].map(match => match[1]);
			expect(targets.length).toBeGreaterThan(1);
			expect(targets.every(target => target === LONG_URL)).toBe(true);
			const linkedGlyphs = [...rendered.matchAll(/\x1b\]8;;[^\x07]+\x07([^\x1b]*)\x1b\]8;;\x07/g)].map(
				match => match[1],
			);
			expect(linkedGlyphs.join("")).toBe(`Open sign-in page${LONG_URL}`);
			expect(Bun.stripANSI(rendered).replace(/\s/g, "")).toContain(LONG_URL);
			expect(Bun.stripANSI(rendered)).toContain("full URL is visible above");
			const framed = selectorFrame(
				44,
				40,
				"Sign in",
				"",
				[],
				container.render(selectorFrameContentWidth(44)).map(line => selectorProse(line)),
				[],
				[],
			);
			const framedLinks = framed.flatMap(line => [...line.matchAll(OSC_8_OPEN)].map(match => match[1]));
			expect(framedLinks.length).toBeGreaterThan(1);
			expect(framedLinks.every(target => target === LONG_URL)).toBe(true);
			for (const line of framed)
				expect((line.match(OSC_8_OPEN) ?? []).length).toBe((line.match(OSC_8_CLOSE) ?? []).length);
		} finally {
			setTerminalHyperlinks(true);
		}
	});

	it("respects explicit hyperlink off while keeping the exact URL visible", () => {
		applyHyperlinkSetting("off");
		try {
			const container = new Container();
			presentAuthLink(container, LONG_URL);
			const rendered = container.render(44).join("\n");
			expect(rendered).not.toContain("\x1b]8;;");
			expect(Bun.stripANSI(rendered).replace(/\s/g, "")).toContain(LONG_URL);
		} finally {
			applyHyperlinkSetting("auto");
			setTerminalHyperlinks(true);
		}
	});

	it("never links an unsafe recovery target", () => {
		const container = new Container();
		presentAuthLink(container, "https://login.example.test/\x1b]8;;injected");
		expect(container.render(80).join("\n")).not.toContain("\x1b]8;;");
	});
});
