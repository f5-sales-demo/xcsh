import { describe, expect, test } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";
import type { ActiveModelSnapshot } from "../../src/session/active-model";

function snapshot(id: string): ActiveModelSnapshot {
	return {
		id,
		name: id,
		provider: "anthropic",
		api: "anthropic-messages",
		gatewayHost: "api.anthropic.com",
		contextWindow: 200_000,
		resolutionSource: "runtime-switch",
		resolutionSourceNote: "(switched during this session)",
		roles: {},
	};
}

async function readAbout(handler: InternalDocsProtocolHandler): Promise<string> {
	const resource = await handler.resolve(parseInternalUrl("xcsh://about") as never);
	return resource.content;
}

describe("xcsh://about active model", () => {
	test("renders the snapshot the getter returns", async () => {
		const handler = new InternalDocsProtocolHandler({ getActiveModel: () => snapshot("claude-opus-5") });
		const content = await readAbout(handler);
		expect(content).toContain("## Active model");
		expect(content).toContain("claude-opus-5");
	});

	// The getter must be called per read, not captured at construction: a Ctrl+P switch has to show up
	// on the next read, which is the whole point of reporting it here instead of at launch (#2459).
	test("reflects a model switch between reads", async () => {
		let current = snapshot("claude-opus-5");
		const handler = new InternalDocsProtocolHandler({ getActiveModel: () => current });

		expect(await readAbout(handler)).toContain("claude-opus-5");

		current = snapshot("claude-sonnet-5");
		const after = await readAbout(handler);
		expect(after).toContain("claude-sonnet-5");
		expect(after).not.toContain("claude-opus-5");
	});

	test("degrades to an explicit unknown when no getter is supplied", async () => {
		const handler = new InternalDocsProtocolHandler({});
		const content = await readAbout(handler);
		expect(content).toContain("## Active model");
		expect(content).toContain("unknown");
	});
});
