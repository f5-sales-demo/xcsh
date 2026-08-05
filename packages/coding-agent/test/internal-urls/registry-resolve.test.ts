import { describe, expect, test } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { createRegistryResolver } from "../../src/internal-urls/registry-resolve";

describe("createRegistryResolver", () => {
	const resolver = createRegistryResolver();

	test("resolves provider URL into internal resource", async () => {
		const url = parseInternalUrl("xcsh://registry/provider/hashicorp/aws");
		const resource = await resolver.resolve(url);

		expect(resource.url).toBe("xcsh://registry/provider/hashicorp/aws");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("hashicorp/aws");
	});

	test("resolves module URL into internal resource", async () => {
		const url = parseInternalUrl("xcsh://registry/module/terraform-aws-modules/vpc/aws");
		const resource = await resolver.resolve(url);

		expect(resource.url).toBe("xcsh://registry/module/terraform-aws-modules/vpc/aws");
		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("terraform-aws-modules/vpc/aws");
	});
});
