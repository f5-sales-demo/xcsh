import { expect, test, vi } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLiteLLMLogin } from "../src/modes/controllers/litellm-login-transaction";
import { runProviderConnectionFlow } from "../src/modes/controllers/provider-connection-flow";
import { commitVllmLogin } from "../src/modes/controllers/vllm-login-transaction";
import { providerSelectorFixture } from "./helpers/provider-selector-fixture";

for (const count of [0, 1, 6])
	test(`connection with ${count} discovered models does not require a model choice`, async () => {
		const commit = vi.fn(async () => {});
		const result = await runProviderConnectionFlow({
			collectCredentials: async () => ({ baseUrl: "https://gateway.example.test", apiKey: "synthetic" }),
			probe: async () => providerSelectorFixture().models.slice(0, count),
			commit,
			recover: async () => "cancel",
		});
		expect(result.status).toBe("completed");
		expect(commit).toHaveBeenCalledTimes(1);
	});
test("discovery failure retains submitted connection and exposes the failure for retry", async () => {
	const commit = vi.fn(async () => {});
	const result = await runProviderConnectionFlow({
		collectCredentials: async () => ({ baseUrl: "https://gateway.example.test", apiKey: "synthetic" }),
		probe: async () => {
			throw new Error("unreachable");
		},
		commit,
		recover: async () => "cancel",
	});
	expect(result).toEqual({ status: "completed", discoveryError: "unreachable" });
	expect(commit).toHaveBeenCalledTimes(1);
});
for (const provider of ["litellm", "vllm"])
	test(`${provider} connection-only persistence never applies models, roles or routing`, async () => {
		const root = await mkdtemp(join(tmpdir(), "xcsh-connection-test-"));
		const fixture = providerSelectorFixture();
		const setModel = vi.fn(async () => {});
		const set = vi.fn();
		const refresh = vi.fn(async () => {
			throw new Error("must not roll back a saved connection on discovery failure");
		});
		const authSet = vi.fn(async () => {});
		const session = {
			modelRegistry: {
				getAll: () => fixture.models,
				refresh,
				refreshProvider: refresh,
				authStorage: { get: () => undefined, set: authSet, remove: vi.fn(async () => {}) },
			},
			setModel,
			setThinkingLevel: vi.fn(),
			settings: { getModelRoles: () => fixture.settings.getModelRoles(), set },
		};
		const configPath = join(root, "config.yml");
		const config = "routing:\n  mode: auto\nmodelRoles:\n  default: litellm/gpt-5.6-terra:medium\n";
		await writeFile(configPath, config);
		try {
			const options = {
				modelsPath: join(root, "models.yml"),
				configPath,
				credentials: { baseUrl: "https://gateway.example.test", apiKey: "synthetic-test-key" },
				probe: { reachable: true, models: fixture.models.map(model => model.id) },
				session,
				connectionOnly: true,
			};
			if (provider === "litellm") await commitLiteLLMLogin(options);
			else await commitVllmLogin(options);
			expect(await readFile(configPath, "utf8")).toBe(config);
			expect(await readFile(options.modelsPath, "utf8")).toContain("gateway.example.test");
			expect(setModel).not.toHaveBeenCalled();
			expect(set).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();
			if (provider === "vllm") expect(authSet).toHaveBeenCalledTimes(1);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
