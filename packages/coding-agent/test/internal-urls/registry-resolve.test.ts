import { describe, expect, test } from "bun:test";
import { createRegistryResolver } from "../../src/internal-urls/registry-resolve";

describe("createRegistryResolver", () => {
	const resolver = createRegistryResolver();

	test("resolves provider URL into internal resource", async () => {
		const resource = await resolver.resolve({
			href: "xcsh://registry/provider/hashicorp/aws",
			protocol: "xcsh:",
			hostname: "registry",
			pathname: "/provider/hashicorp/aws",
			rawHost: "registry",
			rawPathname: "/provider/hashicorp/aws",
		});

		expect(resource.url).toBe("xcsh://registry/provider/hashicorp/aws");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("hashicorp/aws");
	});

	test("resolves module URL into internal resource", async () => {
		const resource = await resolver.resolve({
			href: "xcsh://registry/module/terraform-aws-modules/vpc/aws",
			protocol: "xcsh:",
			hostname: "registry",
			pathname: "/module/terraform-aws-modules/vpc/aws",
			rawHost: "registry",
			rawPathname: "/module/terraform-aws-modules/vpc/aws",
		});

		expect(resource.url).toBe("xcsh://registry/module/terraform-aws-modules/vpc/aws");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("terraform-aws-modules/vpc/aws");
	});
});
