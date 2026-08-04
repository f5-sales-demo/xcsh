import { describe, expect, test } from "bun:test";
import {
	exitCodeForResourceReport,
	formatResourceCliOutput,
	resolveResourceEnvironment,
} from "../src/cli/resource-cli";

describe("resource CLI automation contract", () => {
	test("runs credential-free validation through the public CLI without starting an agent", () => {
		const result = Bun.spawnSync(
			["bun", "src/cli.ts", "validate", "-f", "test/fixtures/resource-manifest.yaml", "-o", "json"],
			{
				cwd: import.meta.dir.replace(/\/test$/, ""),
				env: { ...process.env, XCSH_API_URL: "", XCSH_API_TOKEN: "", XCSH_NAMESPACE: "" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).toBe(0);
		const report = JSON.parse(result.stdout.toString()) as { success: boolean; operation: string };
		expect(report).toMatchObject({ success: true, operation: "validate" });
	}, 20_000);

	test("maps validation failures to usage exit code 2", () => {
		expect(
			exitCodeForResourceReport({
				schemaVersion: 1,
				operation: "validate",
				success: false,
				counts: { total: 1, succeeded: 0, failed: 1, error: 1 },
				results: [{ index: 0, status: "error", error: { kind: "validation", message: "invalid" } }],
			}),
		).toBe(2);
	});

	test("maps API failures to exit code 1 and success to 0", () => {
		expect(
			exitCodeForResourceReport({
				schemaVersion: 1,
				operation: "apply",
				success: false,
				counts: { total: 1, succeeded: 0, failed: 1, error: 1 },
				results: [{ index: 0, status: "error", error: { kind: "api", message: "failed" } }],
			}),
		).toBe(1);
		expect(
			exitCodeForResourceReport({
				schemaVersion: 1,
				operation: "validate",
				success: true,
				counts: { total: 1, succeeded: 1, failed: 0, valid: 1 },
				results: [{ index: 0, status: "valid" }],
			}),
		).toBe(0);
	});

	test("reads direct automation credentials without requiring a context file", () => {
		expect(
			resolveResourceEnvironment({
				XCSH_API_URL: "https://tenant.example.com",
				XCSH_API_TOKEN: "token",
				XCSH_NAMESPACE: "demo",
			}),
		).toEqual({ apiUrl: "https://tenant.example.com", apiToken: "token", defaultNamespace: "demo" });
	});

	test("formats export output as reusable manifests while retaining aggregate result reports", () => {
		const report = {
			schemaVersion: 1 as const,
			operation: "export" as const,
			success: true,
			counts: { total: 1, succeeded: 1, failed: 0, exported: 1 },
			results: [
				{
					index: 0,
					status: "exported",
					manifest: {
						kind: "http_loadbalancer",
						metadata: { name: "example", namespace: "demo" },
						spec: { domains: ["app.example.com"] },
					},
				},
			],
		};

		expect(formatResourceCliOutput(report, "yaml")).toContain("kind: http_loadbalancer");
		expect(formatResourceCliOutput(report, "yaml")).not.toContain("schemaVersion");
		expect(JSON.parse(formatResourceCliOutput(report, "json"))).toMatchObject({ kind: "http_loadbalancer" });
	});
});
