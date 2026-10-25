import { expect, test } from "bun:test";
import { kindResolver as cliResolver } from "../../coding-agent/src/resource-management/index";
import { type CoreHost, F5Core, getCapabilities, kindResolver, negotiateCapabilities } from "../src/index";

test("CLI and Node core use the same authoritative resolver instance", () => {
	expect(cliResolver).toBe(kindResolver);
	expect(kindResolver.getAllKnownKinds()).toContain("http_loadbalancer");
});

test("optional CLI failure or incompatibility leaves all bundled capabilities available", () => {
	const baseline = getCapabilities();
	for (const candidate of [
		undefined,
		null,
		{},
		{ ...baseline, version: 2 },
		{ ...baseline, specificationHash: "different" },
		{ ...baseline, capabilities: [false] },
	]) {
		const result = negotiateCapabilities(candidate);
		expect(result.compatible).toBe(false);
		expect(result.capabilities).toEqual(baseline);
		expect(result.enrichment).toEqual([]);
	}
	const compatible = negotiateCapabilities({ ...baseline, capabilities: ["discovery", "unknown-feature"] });
	expect(compatible.compatible).toBe(true);
	expect(compatible.enrichment).toEqual(["discovery"]);
	expect(compatible.capabilities).toEqual(baseline);
});

test("field description exposes pinned constraints without credentials or network", async () => {
	let credentialsRequested = false;
	const host: CoreHost = {
		getContext: () => ({
			active: true,
			workspaceId: "workspace",
			contextId: "context",
			revision: "1",
			apiUrl: "https://example.invalid",
			namespace: "default",
		}),
		getCredentials: async () => {
			credentialsRequested = true;
			throw Error("No credentials");
		},
		approve: async () => ({ approved: false, planHash: "" }),
		persist: async () => {},
	};
	const core = new F5Core(host),
		binding = await core.bind("conversation");
	const description = (await core.describe(binding, "http_loadbalancer", {
		field: "spec.more_option.custom_errors",
	})) as { fields: { path: string; constraints: { constraintType: string } }[]; specificationHash: string };
	expect(description.specificationHash).toBe(getCapabilities().specificationHash);
	expect(description.fields[0]?.constraints.constraintType).toBe("map");
	expect(credentialsRequested).toBe(false);
	core.dispose();
});
