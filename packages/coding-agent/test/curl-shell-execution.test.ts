import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { _resetShellSessionsForTest } from "../src/exec/bash-executor";
import { collectEnvSecrets, SecretObfuscator } from "../src/secrets";
import type { ToolSession } from "../src/tools";
import { BashTool } from "../src/tools/bash";

describe("explicit curl execution through the existing shell tool", () => {
	it("uses the selected credential environment, sends JSON, and masks output and artifacts", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-curl-fixture-"));
		const requests: Array<{
			method: string;
			path: string;
			authorization: string | null;
			contentType: string | null;
			body: string;
		}> = [];
		const token = "SYNTHETIC-CURL-FIXTURE-TOKEN";
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				requests.push({
					method: request.method,
					path: new URL(request.url).pathname,
					authorization: request.headers.get("authorization"),
					contentType: request.headers.get("content-type"),
					body: await request.text(),
				});
				// Echo a synthetic credential to exercise the shell masking boundary.
				return new Response(JSON.stringify({ padding: "x".repeat(70_000), echo: token, status: "created" }), {
					status: 201,
				});
			},
		});
		const environment = { XCSH_API_URL: server.url.origin, XCSH_API_TOKEN: token, XCSH_NAMESPACE: "default" };
		const artifact = path.join(cwd, "curl-output.log");
		const session = {
			cwd,
			hasUI: false,
			settings: Settings.isolated({ "bash.environment": environment, "sandbox.enabled": false }),
			obfuscator: new SecretObfuscator(collectEnvSecrets({ environment })),
			getArtifactsDir: () => cwd,
			getSessionId: () => "synthetic-curl",
			allocateOutputArtifact: async () => ({ id: "curl-output", path: artifact }),
		} as unknown as ToolSession;
		try {
			_resetSettingsForTest();
			await Settings.init({ inMemory: true, cwd });
			Settings.instance.override("bash.environment", environment);
			const updates: unknown[] = [];
			const result = await new BashTool(session).execute(
				"explicit-curl",
				{
					command:
						'curl --silent --show-error --fail-with-body --request POST "$XCSH_API_URL/api/config/namespaces/$XCSH_NAMESPACE/http_loadbalancers" --header "Authorization: APIToken $XCSH_API_TOKEN" --header "Content-Type: application/json" --data \'{"metadata":{"name":"curl-example","namespace":"default"},"spec":{"domains":["curl-example.example.com"],"http":{"port":80}}}\'',
				},
				undefined,
				update => updates.push(update),
			);
			expect(requests).toHaveLength(1);
			expect(requests[0]).toEqual({
				method: "POST",
				path: "/api/config/namespaces/default/http_loadbalancers",
				authorization: `APIToken ${token}`,
				contentType: "application/json",
				body: JSON.stringify({
					metadata: { name: "curl-example", namespace: "default" },
					spec: { domains: ["curl-example.example.com"], http: { port: 80 } },
				}),
			});
			expect(JSON.stringify(result)).toContain("created");
			expect(JSON.stringify(result)).not.toContain(token);
			expect(JSON.stringify(updates)).not.toContain(token);
			expect(fs.readFileSync(artifact, "utf8")).not.toContain(token);
		} finally {
			server.stop(true);
			_resetShellSessionsForTest();
			_resetSettingsForTest();
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
