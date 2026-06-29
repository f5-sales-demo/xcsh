import { describe, expect, it } from "bun:test";
import { parseError, probeSpec, setPath, typeFix } from "../../src/sweep/spec-probe";

describe("setPath prototype-pollution guard", () => {
	it("refuses __proto__/constructor/prototype paths", () => {
		const o: Record<string, unknown> = {};
		setPath(o, "__proto__.polluted", "x");
		setPath(o, "constructor.prototype.polluted", "x");
		// biome-ignore lint/suspicious/noExplicitAny: probing the prototype on purpose
		expect(({} as any).polluted).toBeUndefined();
		expect(Object.hasOwn(o, "__proto__")).toBe(false);
	});
	it("still sets normal nested paths", () => {
		const o: Record<string, unknown> = {};
		setPath(o, "a.b", 1);
		expect(o).toEqual({ a: { b: 1 } });
	});
});

function fakeFetch(responses: Array<{ ok: boolean; body?: string }>): typeof fetch {
	let i = 0;
	// biome-ignore lint/suspicious/noExplicitAny: minimal Response stub for tests
	return (async (url: string, init?: { method?: string }) => {
		if (init?.method === "DELETE") return { ok: true, text: async () => "" } as any;
		const r = responses[Math.min(i, responses.length - 1)]!;
		i++;
		return { ok: r.ok, text: async () => r.body ?? "" } as any;
	}) as unknown as typeof fetch;
}

const base = { baseUrl: "https://t", token: "k", namespace: "demo", resource: "thing", name: "x" };

describe("typeFix / parseError", () => {
	it("detects array/object/numeric mismatches", () => {
		expect(typeFix("cannot unmarshal number into Go value of type []json.RawMessage")).toBe("array");
		expect(typeFix("cannot unmarshal string into Go value of type map[string]x")).toBe("object");
		expect(typeFix("invalid character 'x' looking for beginning of value")).toBe("numeric");
	});
	it("extracts the failing field path", () => {
		expect(parseError("Field spec.foo should be not be empty").path).toBe("spec.foo");
		expect(parseError("Field spec.a.b fails rule ves.io...").path).toBe("spec.a.b");
	});
});

describe("probeSpec patch loop", () => {
	it("returns ok immediately when the seed already validates", async () => {
		const r = await probeSpec({ ...base, seedSpec: { a: 1 }, fetchFn: fakeFetch([{ ok: true }]) });
		expect(r.ok).toBe(true);
		expect(r.spec).toEqual({ a: 1 });
	});

	it("patches an empty required field from the error, then succeeds", async () => {
		const r = await probeSpec({
			...base,
			fetchFn: fakeFetch([{ ok: false, body: '{"message":"Field spec.foo should be not be empty"}' }, { ok: true }]),
		});
		expect(r.ok).toBe(true);
		expect(r.spec.foo).toBeDefined();
	});

	it("retries in the system namespace on the DNS namespace error", async () => {
		const r = await probeSpec({
			...base,
			fetchFn: fakeFetch([{ ok: false, body: "Creation of DNS objects outside system namespace" }, { ok: true }]),
		});
		expect(r.ok).toBe(true);
		expect(r.namespace).toBe("system");
	});

	it("gives up on a semantic error it can't act on", async () => {
		const r = await probeSpec({
			...base,
			fetchFn: fakeFetch([{ ok: false, body: '{"message":"account is not the owner of this domain"}' }]),
		});
		expect(r.ok).toBe(false);
		expect(r.lastError).toMatch(/owner/);
	});
});
