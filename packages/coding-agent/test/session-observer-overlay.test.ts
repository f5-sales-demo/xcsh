import { beforeAll, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { SessionObserverOverlayComponent } from "../src/modes/components/session-observer-overlay";
import type { SessionObserverRegistry } from "../src/modes/session-observer-registry";
import { setTheme } from "../src/modes/theme/theme";

beforeAll(async () => setTheme("xcsh-dark"));

function registry(sessionFile?: string): SessionObserverRegistry {
	return {
		getSessions: () => [
			{ id: "main", kind: "main", label: "Main Session", status: "active", lastUpdate: 1 },
			{
				id: "subagent:scope/duplicate-name",
				kind: "subagent",
				label: "Duplicate name",
				agent: "reviewer",
				description: "Inspect the candidate",
				sessionFile,
				status: "active",
				lastUpdate: 2,
			},
		],
	} as unknown as SessionObserverRegistry;
}

describe("SessionObserverOverlayComponent", () => {
	it("uses the shared searchable picker and preserves scoped session identity", () => {
		const done = vi.fn();
		const component = new SessionObserverOverlayComponent(registry(), done, ["ctrl+s"]);
		const wide = component.render(140);
		expect(wide.every(line => visibleWidth(line) <= 100)).toBe(true);
		expect(Bun.stripANSI(wide.join("\n"))).toContain("Observe sessions");
		component.handleInput("d");
		const filtered = Bun.stripANSI(component.render(80).join("\n"));
		expect(filtered).toContain("Duplicate name");
		expect(filtered).toContain("subagent:scope/duplicate-name");
		component.handleInput("\x1b");
		expect(done).not.toHaveBeenCalled();
		component.handleInput("\x1b");
		expect(done).toHaveBeenCalledTimes(1);
	});

	it("opens a bounded viewer and returns one level with the selector Back binding", () => {
		const component = new SessionObserverOverlayComponent(registry(), vi.fn(), ["ctrl+s"]);
		component.handleInput("\x1b[B");
		component.handleInput("\r");
		const viewer = Bun.stripANSI(component.render(80).join("\n"));
		expect(viewer).toContain("Session observer");
		expect(viewer).toContain("identity");
		expect(viewer).toContain("subagent:scope/duplicate-name");
		expect(viewer).toContain("No session file available yet.");
		expect(viewer).toContain("Ctrl+S: back to sessions");
		component.handleInput("\x1b");
		expect(Bun.stripANSI(component.render(80).join("\n"))).toContain("Observe sessions");
	});

	it("keeps long thinking, arguments, and results reachable through transcript paging", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-observer-details-"));
		const sessionFile = path.join(directory, "subagent.jsonl");
		const thinkingSentinel = "THINKING_END_SENTINEL";
		const argumentSentinel = "ARGUMENT_END_SENTINEL";
		const resultSentinel = "RESULT_END_SENTINEL";
		const records = [
			{
				type: "message",
				id: "assistant-1",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: `${"thinking ".repeat(120)}${thinkingSentinel}` },
						{
							type: "toolCall",
							id: "tool-1",
							name: "synthetic_tool",
							arguments: { payload: `${"argument ".repeat(80)}${argumentSentinel}` },
						},
					],
					timestamp: 1,
				},
			},
			{
				type: "message",
				id: "result-1",
				parentId: "assistant-1",
				timestamp: new Date(1).toISOString(),
				message: {
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "synthetic_tool",
					content: [{ type: "text", text: `${"result line\n".repeat(40)}${resultSentinel}` }],
					isError: false,
					timestamp: 2,
				},
			},
		];
		fs.writeFileSync(sessionFile, `${records.map(record => JSON.stringify(record)).join("\n")}\n`);
		try {
			const component = new SessionObserverOverlayComponent(registry(sessionFile), vi.fn(), ["ctrl+s"]);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			let observed = "";
			for (let page = 0; page < 10; page++) {
				observed += `\n${Bun.stripANSI(component.render(80).join("\n"))}`;
				component.handleInput("\x1b[6~");
			}
			expect(observed).toContain(thinkingSentinel);
			expect(observed).toContain(argumentSentinel);
			expect(observed).toContain(resultSentinel);
			expect(observed).toContain("Pageup/Pagedown: transcript");
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});
});
