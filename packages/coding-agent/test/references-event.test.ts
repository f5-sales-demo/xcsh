/**
 * The turn-boundary rule for citation events (#2420).
 *
 * An INTERMEDIATE tool-use step also emits `message_end`, so "assistant message
 * ended" is not the same as "turn ended". Treating the former as terminal is the
 * trap `browser/chat-handler.ts` documents at length — it would publish the
 * citations of a half-finished answer. This lives in a pure function precisely so
 * the rule is testable; `runRpcMode` can't be imported by a test.
 */
import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@f5-sales-demo/pi-agent-core";
import { referencesEventFor } from "../src/references";

function messageEnd(message: unknown): AgentEvent {
	return { type: "message_end", message } as unknown as AgentEvent;
}
const cited = (text: string, extra: Record<string, unknown> = {}): unknown => ({
	role: "assistant",
	content: [{ type: "text", text }],
	...extra,
});

describe("referencesEventFor", () => {
	test("a settled assistant turn with cited sources yields a references event", () => {
		const ev = referencesEventFor(messageEnd(cited("See [HTTP LB](https://docs.cloud.f5.com/lb) for details.")));
		expect(ev).toEqual({
			type: "references",
			references: [{ kind: "doc", title: "HTTP LB", url: "https://docs.cloud.f5.com/lb" }],
		});
	});

	test("an INTERMEDIATE tool-use step yields nothing (stopReason)", () => {
		// The turn continues after the tool round-trip; its citations are not final.
		expect(
			referencesEventFor(
				messageEnd(cited("Checking [docs](https://docs.cloud.f5.com/x)", { stopReason: "toolUse" })),
			),
		).toBeNull();
	});

	test("an INTERMEDIATE tool-use step yields nothing (toolCall block)", () => {
		expect(
			referencesEventFor(
				messageEnd({
					role: "assistant",
					content: [
						{ type: "text", text: "Reading [docs](https://docs.cloud.f5.com/y)" },
						{ type: "toolCall", id: "t1", name: "read" },
					],
				}),
			),
		).toBeNull();
	});

	test("a turn that cited nothing yields nothing (no empty event on the stream)", () => {
		expect(referencesEventFor(messageEnd(cited("No sources needed.")))).toBeNull();
	});

	test("non-assistant and non-message_end events yield nothing", () => {
		expect(referencesEventFor(messageEnd({ role: "user", content: [] }))).toBeNull();
		expect(referencesEventFor({ type: "turn_end" } as unknown as AgentEvent)).toBeNull();
		expect(referencesEventFor(messageEnd(undefined))).toBeNull();
	});

	test("classifies a tenant console deep link as console, not doc", () => {
		const ev = referencesEventFor(
			messageEnd(cited("Open https://example-corp.console.ves.volterra.io/lb to confirm.")),
		);
		expect(ev?.references[0].kind).toBe("console");
	});
});
