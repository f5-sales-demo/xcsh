import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";
import { buildJsonSessionHeaderLine } from "../../src/modes/print-mode";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "../../src/session/session-manager";

const header: SessionHeader = {
	type: "session",
	version: CURRENT_SESSION_VERSION,
	id: "154024a895ca3bf1",
	timestamp: "2026-07-27T11:37:09.975Z",
	cwd: "/work/custA",
};

const model = { id: "claude-opus-5", provider: "anthropic" } as Model;

function parse(header: SessionHeader | null, model: Model | undefined): Record<string, unknown> {
	const line = buildJsonSessionHeaderLine(header, model);
	expect(line?.endsWith("\n")).toBe(true);
	return JSON.parse(line ?? "{}");
}

describe("json mode session header", () => {
	// #2459: the header omitted the model while the assistant message events carried it, so an
	// exported transcript could not state which model produced it without walking later events.
	it("carries the active model and provider", () => {
		const parsed = parse(header, model);
		expect(parsed.type).toBe("session");
		expect(parsed.model).toBe("claude-opus-5");
		expect(parsed.provider).toBe("anthropic");
		expect(parsed.thinking).toBeNull();
	});

	it("carries the effective thinking level used by the session", () => {
		const line = buildJsonSessionHeaderLine(header, model, ThinkingLevel.XHigh);
		expect(JSON.parse(line ?? "{}").thinking).toBe("xhigh");
	});

	it("keeps every field of the persisted header, at the current version", () => {
		const parsed = parse(header, model);
		expect(parsed.id).toBe(header.id);
		expect(parsed.cwd).toBe(header.cwd);
		expect(parsed.timestamp).toBe(header.timestamp);
		// The persisted shape is untouched: adding fields there would need a session migration.
		expect(parsed.version).toBe(CURRENT_SESSION_VERSION);
	});

	it("reports null rather than omitting the fields when no model is resolved", () => {
		const parsed = parse(header, undefined);
		expect(parsed.model).toBeNull();
		expect(parsed.provider).toBeNull();
	});

	it("emits nothing when the session has no header", () => {
		expect(buildJsonSessionHeaderLine(null, model)).toBeUndefined();
	});
});
