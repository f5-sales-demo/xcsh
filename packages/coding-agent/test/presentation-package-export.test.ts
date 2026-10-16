import { expect, test } from "bun:test";
import { presentation } from "../src/extensibility/presentation";

test("the lightweight public package entry point uses the injected presentation implementation", async () => {
	const api = await import("@f5-sales-demo/xcsh/presentation");
	expect(api.presentation).toBe(presentation);
	expect(api.presentation.data({ total: 0 })[0]).toEqual({ kind: "fields", values: { total: 0 } });
});
