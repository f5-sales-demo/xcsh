import { describe, expect, it } from "bun:test";
import { isScopedOut, paramsFor, SCOPED_OUT, SWEEP_PARAMS } from "../../src/sweep/sweep-params";

describe("isScopedOut", () => {
	it("scopes out cloud/external resources", () => {
		expect(isScopedOut("aws-vpc-site")).toBe(true);
		expect(isScopedOut("cloud-connect")).toBe(true);
		expect(isScopedOut("securemesh-site")).toBe(true);
	});
	it("does not scope out standalone resources", () => {
		expect(isScopedOut("http-load-balancer")).toBe(false);
		expect(isScopedOut("bgp-asn-set")).toBe(false);
	});
});

describe("paramsFor", () => {
	it("merges curated values over the base, keeping name+namespace", () => {
		const p = paramsFor("api-credential", { name: "x", namespace: "demo" });
		expect(p.name).toBe("x");
		expect(p.namespace).toBe("demo");
		expect(p.password).toBeDefined();
		expect(p.password).toBe(p.confirm_password);
	});
	it("returns base unchanged for resources with no curated params", () => {
		const p = paramsFor("bgp-asn-set", { name: "x", namespace: "demo" });
		expect(p).toEqual({ name: "x", namespace: "demo" });
	});
	it("fills list-valued scalar fields", () => {
		expect(paramsFor("http-load-balancer", {}).domains).toEqual(["xcsh-sweep.example.com"]);
		expect(paramsFor("ip-prefix-set", {}).prefix).toEqual(["10.10.0.0/24"]);
	});
});

describe("invariants", () => {
	it("scoped-out and curated sets do not overlap (a resource is one or the other)", () => {
		for (const r of Object.keys(SWEEP_PARAMS)) expect(SCOPED_OUT.has(r)).toBe(false);
	});
});
