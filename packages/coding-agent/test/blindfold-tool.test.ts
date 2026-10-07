import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { evaluateToolCall } from "../src/sandbox/enforce";
import { ContextService } from "../src/services/xcsh-context";
import { XcshBlindfoldTool } from "../src/tools/xcsh-blindfold";

let root: string, settings: Settings, service: ContextService;
let plan = false;
beforeEach(async () => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	root = mkdtempSync(join(tmpdir(), "blindfold-tool-"));
	settings = await Settings.init({ cwd: root, agentDir: root, inMemory: true });
	service = ContextService.init(join(root, "config"));
	plan = false;
});
afterEach(() => {
	ContextService._resetForTest();
	_resetSettingsForTest();
	rmSync(root, { recursive: true, force: true });
});
function tool() {
	return new XcshBlindfoldTool({
		cwd: root,
		settings,
		getContextService: async () => service,
		getPlanModeState: () => (plan ? { enabled: true } : undefined),
	} as never);
}
describe("Blindfold assistant boundary", () => {
	test("offline assistant preparation bypasses context and retains ciphertext only in the artifact", async () => {
		const fixture = await Bun.file(
			join(import.meta.dir, "../../natives/test/fixtures/blindfold-synthetic.json"),
		).json();
		const jwk = createPrivateKey(Buffer.from(fixture["rsa-key.pem"], "base64")).export({ format: "jwk" });
		writeFileSync(
			join(root, "pub"),
			JSON.stringify({
				data: {
					tenant: "example-tenant",
					key_version: 1,
					modulus_base64: Buffer.from(jwk.n!, "base64url").toString("base64"),
					public_exponent_base64: Buffer.from(jwk.e!, "base64url").toString("base64"),
				},
			}),
		);
		writeFileSync(join(root, "policy"), JSON.stringify({ data: { tenant: "example-tenant", policy_id: "101" } }));
		writeFileSync(join(root, "input"), "synthetic-private-marker");
		const adapter = new XcshBlindfoldTool({
			cwd: root,
			settings,
			getContextService: async () => {
				throw new Error("offline context access forbidden");
			},
			getPlanModeState: () => undefined,
		} as never);
		const result = await adapter.execute("offline", {
			operation: "encrypt",
			input: "input",
			publicKey: "pub",
			policyDocument: "policy",
			outputFile: "out",
		});
		const artifact = readFileSync(join(root, "out"), "utf8");
		expect(artifact).toMatch(/^string:\/\/\//);
		expect(JSON.stringify(result)).not.toContain(artifact.trim());
		expect(JSON.stringify(result)).not.toContain("synthetic-private-marker");
		expect(result.details).toMatchObject({ materialSource: "supplied" });
	});
	test("preparation requires a retained output path", async () => {
		await expect(tool().execute("call", { operation: "encrypt", input: "input" })).rejects.toThrow(
			"requires outputFile",
		);
	});
	test("assistant encryption remains file based with public material paths", async () => {
		await expect(
			tool().execute("stdin", {
				operation: "encrypt",
				input: "-",
				publicKey: "pub",
				policyDocument: "policy",
				outputFile: "out",
			}),
		).rejects.toThrow("input file path");
		await expect(
			tool().execute("partial", { operation: "encrypt", input: "in", publicKey: "pub", outputFile: "out" }),
		).rejects.toThrow("together");
	});
	test("schema rejects plaintext keys, literal passwords and tokens", async () => {
		for (const field of ["password", "passphrase", "token", "privateKey"]) {
			await expect(
				tool().execute("call", { operation: "encrypt", input: "input", [field]: "secret" } as never),
			).rejects.toThrow("Invalid Blindfold arguments");
		}
	});
	test("Plan Mode blocks create and artifact output", async () => {
		plan = true;
		await expect(tool().execute("call", { operation: "create", cert: "a", key: "b", name: "demo" })).rejects.toThrow(
			"Plan mode",
		);
		await expect(tool().execute("call", { operation: "policy", outputFile: "policy.json" })).rejects.toThrow(
			"Plan mode",
		);
	});
	test("file fence checks every input and output", () => {
		const fence = {
			allow: [root],
			allowReadOnly: [],
			allowWriteOnly: [],
			deny: ["/private-test"],
			denyOnSeatbelt: [],
			denyEnumerate: [],
		};
		for (const key of ["input", "publicKey", "policyDocument", "cert", "key", "bundle", "outputFile", "resultFile"]) {
			expect(
				evaluateToolCall({ toolName: "xcsh_blindfold", input: { [key]: "/private-test/secret" }, cwd: root, fence })
					.block,
			).toBe(true);
		}
	});
});

describe("Blindfold admitted tenant snapshot", () => {
	test("uses admitted A despite ambient B and never consults mutable context", async () => {
		const { runWithContextExecution } = await import("../src/services/context-execution");
		const priorUrl = process.env.XCSH_API_URL,
			priorToken = process.env.XCSH_API_TOKEN;
		process.env.XCSH_API_URL = "https://b.console.ves.volterra.io";
		process.env.XCSH_API_TOKEN = "synthetic-b";
		const previousFetch = globalThis.fetch;
		const seen: Array<{ url: string; token: string | null }> = [];
		globalThis.fetch = (async (url, init) => {
			seen.push({ url: String(url), token: new Headers(init?.headers).get("Authorization") });
			return Response.json({
				data: { tenant: "example-tenant", key_version: 1, modulus_base64: "AQ==", public_exponent_base64: "AQAB" },
			});
		}) as typeof fetch;
		const adapter = new XcshBlindfoldTool({
			cwd: root,
			settings,
			getContextService: async () => {
				throw new Error("mutable context must not be consulted");
			},
		} as never);
		try {
			const result = await runWithContextExecution(
				{
					environment: Object.freeze({
						XCSH_API_URL: "https://a.console.ves.volterra.io",
						XCSH_API_TOKEN: "synthetic-a",
						XCSH_CONTEXT_NAME: "a",
						XCSH_NAMESPACE: "example-a",
					}),
					sensitiveKeys: [],
					source: "global",
				},
				() => adapter.execute("admitted", { operation: "public-key", contextName: "a" }),
			);
			expect(seen).toEqual([
				{
					url: "https://a.console.ves.volterra.io/api/secret_management/get_public_key",
					token: "APIToken synthetic-a",
				},
			]);
			expect(JSON.stringify(result)).not.toContain("synthetic-a");
		} finally {
			globalThis.fetch = previousFetch;
			if (priorUrl === undefined) delete process.env.XCSH_API_URL;
			else process.env.XCSH_API_URL = priorUrl;
			if (priorToken === undefined) delete process.env.XCSH_API_TOKEN;
			else process.env.XCSH_API_TOKEN = priorToken;
		}
	});
});
