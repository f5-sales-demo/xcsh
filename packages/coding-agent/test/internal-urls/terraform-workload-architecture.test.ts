import { expect, test } from "bun:test";
import {
	propertyMatchesWorkloadAdvertisement,
	propertyWorkloadArchitecture,
} from "../../src/internal-urls/terraform-property-ranking";

test("source-described fungible replicas resolve only the workload service architecture", () => {
	expect(propertyWorkloadArchitecture("The fungible service uses custom advertisement ports.")).toBe("stateless");
	expect(propertyWorkloadArchitecture("The replicas are fungible within this workload.")).toBe("stateless");
	expect(propertyWorkloadArchitecture("The service is not fungible in this deployment.")).toBeUndefined();
	expect(propertyWorkloadArchitecture("Which workload architecture should I use?")).toBeUndefined();
	expect(propertyWorkloadArchitecture("Compare fungible service and stateful service branches.")).toBeUndefined();
});

test("canonical public and custom advertisement descriptions keep their own branches", () => {
	const row = (branch: string) => ({
		provider_type: "resources",
		provider_name: "workload",
		schema_path: `service.advertise_options.${branch}.port.http_loadbalancer.https.min_version`,
		path: "",
		anchor: "",
		description: "",
	});
	const publicQuery =
		"The service uses Internet advertisement with the default VIP and its single port. Within tls_parameters (not the other TLS representation).";
	const customQuery = "The service uses custom advertisement and its port entries.";
	expect(propertyMatchesWorkloadAdvertisement(publicQuery, row("advertise_on_public"))).toBe(true);
	expect(propertyMatchesWorkloadAdvertisement(publicQuery, row("advertise_custom"))).toBe(false);
	expect(propertyMatchesWorkloadAdvertisement(customQuery, row("advertise_custom"))).toBe(true);
	expect(propertyMatchesWorkloadAdvertisement(customQuery, row("advertise_on_public"))).toBe(false);
	for (const query of [
		"Compare custom advertisement and Internet advertisement with the default VIP.",
		"The service does not use custom advertisement.",
		"Which advertisement should I use?",
	]) {
		expect(propertyMatchesWorkloadAdvertisement(query, row("advertise_custom"))).toBe(true);
		expect(propertyMatchesWorkloadAdvertisement(query, row("advertise_on_public"))).toBe(true);
	}
	expect(
		propertyMatchesWorkloadAdvertisement(publicQuery, { ...row("advertise_custom"), provider_name: "fixture" }),
	).toBe(true);
});
