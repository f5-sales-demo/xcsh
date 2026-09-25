import { beforeAll, describe, expect, it, vi } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { SessionSelectorComponent } from "../../../src/modes/components/session-selector";
import { initTheme } from "../../../src/modes/theme/theme";
import type { SessionInfo } from "../../../src/session/session-manager";

beforeAll(() => initTheme());

const longTitle = "ANSI café 東京 session title with a deliberately complete selected value";
const longMessage =
	"FIRST-MESSAGE-START This ANSI café 東京 session summary must remain complete across every constrained terminal detail page without dropping any explanatory words. FIRST-MESSAGE-END";

function session(): SessionInfo {
	return {
		path: "/synthetic/workspace/café-東京/session-with-a-deliberately-long-path.jsonl",
		id: "synthetic-session-café-東京-with-a-long-identifier",
		cwd: "/synthetic/workspace/café-東京/with-a-long-directory-name",
		title: `\u001b[33m${longTitle}\u001b[39m`,
		created: new Date("2026-01-01T00:00:00Z"),
		modified: new Date("2026-01-02T00:00:00Z"),
		messageCount: 7,
		firstMessage: longMessage,
		allMessagesText: longMessage,
	};
}

function collectPages(
	component: SessionSelectorComponent,
	width: number,
	detailStart: (line: string) => boolean,
): { pages: string; details: string } {
	const pages: string[] = [];
	const details: string[] = [];
	for (let page = 0; page < 24; page += 1) {
		const rendered = component.render(width);
		expect(rendered.every(line => visibleWidth(line) === width)).toBe(true);
		const content = rendered.map(line => Bun.stripANSI(line).slice(1, -1).trim());
		const text = content.join("\n");
		pages.push(text);
		const start = content.findLastIndex(detailStart);
		const footer = content.findIndex(
			(line, index) => index > start && /^(Tab\/Shift\+Tab|Pageup\/Pagedown|Esc:)/u.test(line),
		);
		details.push(...content.slice(start + 1, footer).filter(Boolean));
		const paging = text.match(/details (\d+)–(\d+) of (\d+)/u);
		if (!paging || paging[2] === paging[3]) break;
		component.handleInput("\x1b[6~");
	}
	return { pages: pages.join("\n"), details: details.join("") };
}

describe("SessionSelectorComponent readability", () => {
	for (const width of [40, 100]) {
		it(`keeps complete selected session prose reachable at width ${width}`, () => {
			const component = new SessionSelectorComponent([session()], vi.fn(), vi.fn(), vi.fn(), undefined, {
				allSessions: [session()],
				currentCwd: "/synthetic/workspace/café-東京/with-a-long-directory-name",
				getTerminalRows: () => 18,
			});
			const result = collectPages(component, width, line => line.includes("7 msg"));
			const details = result.details.replace(/\s+/gu, "");

			for (const expected of [longTitle, longMessage]) {
				expect(details).toContain(expected.replace(/\s+/gu, ""));
			}
			expect(details).not.toContain("…");
		});
	}

	it("pages complete session details while retaining the selected action", () => {
		const component = new SessionSelectorComponent([session()], vi.fn(), vi.fn(), vi.fn(), undefined, {
			getTerminalRows: () => 18,
		});
		component.handleInput("\n");
		const result = collectPages(component, 40, line => line.includes("Delete this session"));
		const normalized = result.details.replace(/\s+/gu, "");

		for (const expected of [longTitle, session().id, session().cwd, session().path, longMessage]) {
			expect(normalized).toContain(Bun.stripANSI(expected).replace(/\s+/gu, ""));
		}
		for (const page of result.pages.split("Session details").slice(1)) expect(page).toContain("Resume this session");
	});

	it("resets detail paging after a resize so all content remains reachable", () => {
		const component = new SessionSelectorComponent([session()], vi.fn(), vi.fn(), vi.fn(), undefined, {
			getTerminalRows: () => 18,
		});
		component.render(40);
		component.handleInput("\x1b[6~");

		const resized = collectPages(component, 100, line => line.includes("7 msg")).details.replace(/\s+/gu, "");
		expect(resized).toContain(longMessage.replace(/\s+/gu, ""));
	});
});
