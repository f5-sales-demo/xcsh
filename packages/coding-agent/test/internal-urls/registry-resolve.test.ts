import { afterEach, describe, expect, it } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { createRegistryResolver } from "../../src/internal-urls/registry-resolve";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

function registryServer(handler: (request: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
	servers.push(server);
	return `http://127.0.0.1:${server.port}`;
}

describe("Terraform Registry resolver routes", () => {
	it("uses the documented provider versions endpoint", async () => {
		let requested = "";
		const baseUrl = registryServer(request => {
			requested = new URL(request.url).pathname;
			return Response.json({
				versions: [
					{ version: "5.1.0", protocols: ["5.0"], platforms: [{ os: "linux", arch: "amd64" }] },
					{ version: "5.2.0", protocols: ["5.0"], platforms: [{ os: "darwin", arch: "arm64" }] },
				],
			});
		});
		const resolver = createRegistryResolver({ providerBaseUrl: `${baseUrl}/v1/providers` });

		const resource = await resolver.resolve(parseInternalUrl("xcsh://registry/provider/hashicorp/aws"));

		expect(requested).toBe("/v1/providers/hashicorp/aws/versions");
		expect(resource.content).toContain("hashicorp/aws");
		expect(resource.content).toContain("5.2.0");
		expect(resource.content).toContain("darwin/arm64");
	});

	it("uses the documented module metadata endpoint", async () => {
		let requested = "";
		const baseUrl = registryServer(request => {
			requested = new URL(request.url).pathname;
			return Response.json({
				id: "example/vpc/aws/6.0.1",
				namespace: "example",
				name: "vpc",
				provider: "aws",
				version: "6.0.1",
				description: "Example module which creates VPC resources",
				source: "https://example.invalid/vpc",
				verified: true,
			});
		});
		const resolver = createRegistryResolver({ moduleBaseUrl: `${baseUrl}/v1/modules` });

		const resource = await resolver.resolve(parseInternalUrl("xcsh://registry/module/example/vpc/aws"));

		expect(requested).toBe("/v1/modules/example/vpc/aws");
		expect(resource.content).toContain("6.0.1");
		expect(resource.content).toContain("Example module which creates VPC resources");
		expect(resource.content).toContain("Verified: yes");
	});

	it.each([
		"xcsh://registry/provider/hashicorp",
		"xcsh://registry/provider/hashicorp/aws/extra",
		"xcsh://registry/module/hashicorp/consul",
		"xcsh://registry/module/hashicorp/consul/aws/extra",
		"xcsh://registry/search/aws",
	])("rejects an invalid route shape without a network request: %s", async url => {
		const resolver = createRegistryResolver({ fetch: () => Promise.reject(new Error("must not fetch")) });
		await expect(resolver.resolve(parseInternalUrl(url))).rejects.toThrow(/Expected xcsh:\/\/registry/);
	});

	it.each([
		"xcsh://registry/provider/HashiCorp/aws",
		"xcsh://registry/provider/hashicorp/aws_provider",
		"xcsh://registry/module/hashicorp/vpc/aws%2Fbeta",
		"xcsh://registry/module/hashicorp/.hidden/aws",
	])("rejects invalid source-name characters: %s", async url => {
		const resolver = createRegistryResolver({ fetch: () => Promise.reject(new Error("must not fetch")) });
		await expect(resolver.resolve(parseInternalUrl(url))).rejects.toThrow(
			/lowercase ASCII letters, digits, and hyphens/,
		);
	});
});

describe("Terraform Registry response handling", () => {
	it("returns actionable provider not-found content", async () => {
		const baseUrl = registryServer(() => Response.json({ errors: ["Not Found"] }, { status: 404 }));
		const resource = await createRegistryResolver({ providerBaseUrl: `${baseUrl}/v1/providers` }).resolve(
			parseInternalUrl("xcsh://registry/provider/example/missing"),
		);
		expect(resource.content).toContain("Provider not found");
		expect(resource.content).toContain("example/missing");
		expect(resource.content).toContain("Verify the namespace and type");
	});

	it("returns actionable module not-found content", async () => {
		const baseUrl = registryServer(() => new Response("missing", { status: 404 }));
		const resource = await createRegistryResolver({ moduleBaseUrl: `${baseUrl}/v1/modules` }).resolve(
			parseInternalUrl("xcsh://registry/module/example/missing/aws"),
		);
		expect(resource.content).toContain("Module not found");
		expect(resource.content).toContain("example/missing/aws");
	});

	it("reports malformed provider responses without inventing a version", async () => {
		const baseUrl = registryServer(() => Response.json({ versions: [{ protocols: ["5.0"] }] }));
		const resource = await createRegistryResolver({ providerBaseUrl: `${baseUrl}/v1/providers` }).resolve(
			parseInternalUrl("xcsh://registry/provider/hashicorp/aws"),
		);
		expect(resource.content).toContain("invalid response");
		expect(resource.content).not.toContain("latest version");
	});

	it("bounds requests with an abort signal and explains timeouts", async () => {
		const resolver = createRegistryResolver({
			timeoutMs: 5,
			fetch: async (_input, init) => {
				await new Promise((_, reject) =>
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
				);
				throw new Error("unreachable");
			},
		});
		const resource = await resolver.resolve(parseInternalUrl("xcsh://registry/provider/hashicorp/aws"));
		expect(resource.content).toContain("timed out after 5 ms");
		expect(resource.content).toContain("Try the lookup again");
	});

	it("reports network failures without a guessed namespace or provider", async () => {
		const resolver = createRegistryResolver({
			fetch: () => Promise.reject(new TypeError("connection refused")),
		});
		const resource = await resolver.resolve(parseInternalUrl("xcsh://registry/module/example/network/aws"));
		expect(resource.content).toContain("Registry request failed");
		expect(resource.content).toContain("connection refused");
		expect(resource.content).not.toContain("terraform-aws-modules");
	});
});
