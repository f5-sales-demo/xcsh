import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "@f5xc-salesdemos/xcsh/config/settings";
import { ContextService } from "@f5xc-salesdemos/xcsh/services/xcsh-context";

describe("ContextService with local contexts", () => {
	let tmpDir: string;
	let globalConfigDir: string;
	let projectDir: string;
	const originalEnv = { ...process.env };

	beforeEach(async () => {
		_resetSettingsForTest();
		ContextService._resetForTest();

		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-svc-local-"));
		globalConfigDir = path.join(tmpDir, "global-config", "xcsh");
		projectDir = path.join(tmpDir, "project");
		const localContextsDir = path.join(projectDir, ".xcsh", "contexts");
		const globalContextsDir = path.join(globalConfigDir, "contexts");

		fs.mkdirSync(localContextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(globalContextsDir, { recursive: true, mode: 0o700 });
		fs.mkdirSync(path.join(tmpDir, "agent"), { recursive: true });

		process.env.XDG_CONFIG_HOME = path.join(tmpDir, "global-config");
		delete process.env.XCSH_API_URL;
		delete process.env.XCSH_API_TOKEN;
		delete process.env.XCSH_NAMESPACE;

		await Settings.init({ cwd: projectDir, agentDir: path.join(tmpDir, "agent"), inMemory: true });
	});

	afterEach(() => {
		_resetSettingsForTest();
		ContextService._resetForTest();
		process.env = { ...originalEnv };
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("loadActive picks up local inline context when present", async () => {
		const localCtx = {
			name: "local-dev",
			apiUrl: "https://local.example.com",
			apiToken: "local-token",
			defaultNamespace: "local-ns",
			version: 1,
		};
		fs.writeFileSync(path.join(projectDir, ".xcsh", "contexts", "local-dev.json"), JSON.stringify(localCtx), {
			mode: 0o600,
		});
		fs.writeFileSync(path.join(projectDir, ".xcsh", "contexts", "active_context"), "local-dev", { mode: 0o600 });

		const service = ContextService.init(globalConfigDir);
		const result = await service.loadActive(projectDir);
		expect(result).not.toBeNull();
		expect(result!.name).toBe("local-dev");
		expect(result!.apiUrl).toBe("https://local.example.com");
	});
});
