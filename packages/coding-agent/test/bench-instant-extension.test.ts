import { describe, expect, it } from "bun:test";
import benchExtension from "../bench/bench-instant-extension";

describe("bench-instant extension", () => {
	it("registers a bench-instant model whose stream emits a text_delta then done", async () => {
		let captured: { name: string; config: Record<string, any> } | null = null;
		const pi = {
			registerProvider: (name: string, config: Record<string, any>) => {
				captured = { name, config };
			},
			events: {},
		} as unknown as Parameters<typeof benchExtension>[0];

		benchExtension(pi);

		expect(captured!.name).toBe("bench-instant");
		expect(captured!.config.models[0].id).toBe("bench-instant");
		expect(captured!.config.apiKey).toBeTruthy();

		const stream = captured!.config.streamSimple(
			{ id: "bench-instant", provider: "bench-instant", api: "bench-instant" },
			{ messages: [] },
		);
		const events: Array<{ type: string; delta?: string }> = [];
		for await (const ev of stream) events.push(ev);
		const delta = events.find(e => e.type === "text_delta");
		expect(delta?.delta).toBe("ok");
		expect(events.some(e => e.type === "done")).toBe(true);
	});
});
