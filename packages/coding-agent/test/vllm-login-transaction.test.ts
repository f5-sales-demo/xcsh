import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";
import { parse } from "yaml";
import { getVllmLoginModelChoices } from "../src/modes/controllers/login-model";
import { commitVllmLogin } from "../src/modes/controllers/vllm-login-transaction";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createHarness(options: { previousKey?: string; failApply?: boolean } = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-vllm-transaction-"));
	directories.push(directory);
	const modelsPath = path.join(directory, "agent", "models.yml");
	const previousModel = { id: "previous", provider: "previous-provider" } as Model;
	const selectedModel = { id: "local-tool-model", provider: "vllm" } as Model;
	let credential = options.previousKey ? { type: "api_key" as const, key: options.previousKey } : undefined;
	let modelRoles: Record<string, string> = { default: "previous-provider/previous:medium", smol: "other/smol" };
	const authStorage = {
		get: vi.fn(() => credential),
		set: vi.fn(async (_provider: string, next: { type: "api_key"; key: string }) => {
			credential = next;
		}),
		remove: vi.fn(async () => {
			credential = undefined;
		}),
	};
	const refreshProvider = vi.fn(async () => {});
	const setModel = vi.fn(async () => {
		modelRoles = { ...modelRoles, default: "vllm/local-tool-model:off" };
		if (options.failApply) throw new Error("model apply failed");
	});
	const setModelTemporary = vi.fn(async () => {});
	const setThinkingLevel = vi.fn();
	const settings = {
		getModelRoles: vi.fn(() => modelRoles),
		set: vi.fn((_key: "modelRoles", value: Record<string, string>) => {
			modelRoles = value;
		}),
	};
	return {
		modelsPath,
		previousModel,
		authStorage,
		refreshProvider,
		setModel,
		setModelTemporary,
		getCredential: () => credential,
		getModelRoles: () => modelRoles,
		session: {
			model: previousModel,
			thinkingLevel: ThinkingLevel.Medium,
			modelRegistry: { authStorage, refreshProvider, getAll: () => [selectedModel, previousModel] },
			setModel,
			setModelTemporary,
			setThinkingLevel,
			settings,
		},
	};
}

const CHOICE = getVllmLoginModelChoices([{ id: "local-tool-model", contextWindow: 32_768 }])[0]!;

describe("commitVllmLogin", () => {
	it("commits a keyless provider, removes stale credentials, and refreshes only vLLM", async () => {
		const state = createHarness({ previousKey: "stale-key" });

		await commitVllmLogin({
			modelsPath: state.modelsPath,
			credentials: { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "" },
			choice: CHOICE,
			session: state.session,
		});

		const config = parse(fs.readFileSync(state.modelsPath, "utf8")) as Record<string, any>;
		expect(config.providers.vllm.auth).toBe("none");
		expect(config.providers.vllm.apiKey).toBeUndefined();
		expect(state.getCredential()).toBeUndefined();
		expect(state.authStorage.remove).toHaveBeenCalledWith("vllm");
		expect(state.refreshProvider).toHaveBeenCalledTimes(1);
		expect(state.refreshProvider).toHaveBeenCalledWith("vllm", "online");
		expect(state.setModel).toHaveBeenCalledWith(expect.objectContaining({ id: "local-tool-model" }), "default", {
			selector: "vllm/local-tool-model",
			thinkingLevel: ThinkingLevel.Off,
		});
	});

	it("stores an authenticated remote key only in agent.db storage", async () => {
		const state = createHarness();
		await commitVllmLogin({
			modelsPath: state.modelsPath,
			credentials: { baseUrl: "https://vllm.example.test/v1", apiKey: "remote-key" },
			choice: CHOICE,
			session: state.session,
		});

		const content = fs.readFileSync(state.modelsPath, "utf8");
		expect(content).not.toContain("remote-key");
		expect(state.getCredential()).toEqual({ type: "api_key", key: "remote-key" });
		expect(state.authStorage.set).toHaveBeenCalledWith("vllm", { type: "api_key", key: "remote-key" });
	});

	it("rolls back YAML, credentials, roles, and active model after any commit failure", async () => {
		const state = createHarness({ previousKey: "previous-key", failApply: true });
		fs.mkdirSync(path.dirname(state.modelsPath), { recursive: true });
		fs.chmodSync(path.dirname(state.modelsPath), 0o750);
		fs.writeFileSync(state.modelsPath, "# original\nproviders:\n  custom:\n    auth: none\n", { mode: 0o640 });

		await expect(
			commitVllmLogin({
				modelsPath: state.modelsPath,
				credentials: { baseUrl: "https://vllm.example.test/v1", apiKey: "new-key" },
				choice: CHOICE,
				session: state.session,
			}),
		).rejects.toThrow("model apply failed");

		expect(fs.readFileSync(state.modelsPath, "utf8")).toBe("# original\nproviders:\n  custom:\n    auth: none\n");
		expect(fs.statSync(state.modelsPath).mode & 0o777).toBe(0o640);
		expect(fs.statSync(path.dirname(state.modelsPath)).mode & 0o777).toBe(0o750);
		expect(state.getCredential()).toEqual({ type: "api_key", key: "previous-key" });
		expect(state.getModelRoles()).toEqual({ default: "previous-provider/previous:medium", smol: "other/smol" });
		expect(state.refreshProvider).toHaveBeenCalledTimes(2);
		expect(state.setModelTemporary).toHaveBeenCalledWith(state.previousModel, ThinkingLevel.Medium);
	});
});
