import { expect, test } from "bun:test";
import { propertyWorkloadArchitecture } from "../../src/internal-urls/terraform-property-ranking";

test("source-described fungible replicas resolve only the workload service architecture", () => {
	expect(propertyWorkloadArchitecture("The fungible service uses custom advertisement ports.")).toBe("stateless");
	expect(propertyWorkloadArchitecture("The replicas are fungible within this workload.")).toBe("stateless");
	expect(propertyWorkloadArchitecture("The service is not fungible in this deployment.")).toBeUndefined();
	expect(propertyWorkloadArchitecture("Which workload architecture should I use?")).toBeUndefined();
	expect(propertyWorkloadArchitecture("Compare fungible service and stateful service branches.")).toBeUndefined();
});
