import { describe, expect, it } from "bun:test";
import type { ExtensionRunner } from "../src/extensibility/extensions/runner";
import type { RegisteredTool } from "../src/extensibility/extensions/types";
import { RegisteredToolAdapter } from "../src/extensibility/extensions/wrapper";

describe("registered tool rendering", () => {
	it("adapts renderers before forwarding tool properties", () => {
		const definition = {
			name: "example",
			renderCall: () => "call",
			renderResult: (_result: unknown, options: unknown) => options,
		};
		const adapter = new RegisteredToolAdapter({ definition } as unknown as RegisteredTool, {} as ExtensionRunner);
		expect(adapter.name).toBe("example");
		expect(adapter.renderCall?.({}, {}, {})).toBe("call");
		expect(adapter.renderResult?.({}, { expanded: true, isPartial: false, extra: true }, {})).toEqual({
			expanded: true,
			isPartial: false,
			spinnerFrame: undefined,
		});
	});

	it("leaves absent renderers undefined", () => {
		const adapter = new RegisteredToolAdapter(
			{ definition: { name: "example" } } as unknown as RegisteredTool,
			{} as ExtensionRunner,
		);
		expect(adapter.renderCall).toBeUndefined();
		expect(adapter.renderResult).toBeUndefined();
	});
});
