/** Live curl policy acceptance. Every API request is confined to a synthetic loopback fixture. */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { CURL_POLICY_SCENARIO_IDS } from "./model-scenario-library";
import { DEFAULT_MODEL_SCENARIO_TARGETS } from "./model-scenarios";
import type { ScenarioBenchmarkReport } from "./model-scenario-report";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const outputDir = path.resolve(process.argv[2] ?? "/tmp/xcsh-curl-policy-evidence");
await fs.mkdir(outputDir, { recursive: true });
const token = "SYNTHETIC-CURL-BENCHMARK-TOKEN";
const results: unknown[] = [];
let failed = false;

const selectedIds = process.argv.slice(3);
for (const id of CURL_POLICY_SCENARIO_IDS.filter(id => selectedIds.length === 0 || selectedIds.includes(id))) {
	const requests: Array<{
		method: string;
		path: string;
		authenticated: boolean;
		contentType: string | null;
		body: string;
	}> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const body = await request.text();
			requests.push({
				method: request.method,
				path: url.pathname,
				authenticated: request.headers.get("authorization") === `APIToken ${token}`,
				contentType: request.headers.get("content-type"),
				body,
			});
			if (request.method === "HEAD") return new Response(null);
			if (url.pathname !== "/api/config/namespaces/default/http_loadbalancers")
				return Response.json({ message: "unexpected fixture path" }, { status: 404 });
			if (request.method === "POST")
				return Response.json(
					{ metadata: { name: "curl-example", namespace: "default" }, spec: JSON.parse(body).spec },
					{ status: 201 },
				);
			return Response.json({ items: [{ name: "synthetic-lb", namespace: "default", uid: "synthetic-uid" }] });
		},
	});
	const out = path.join(outputDir, `${id}.json`);
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				"packages/coding-agent/bench/model-scenarios.ts",
				"--scenario",
				id,
				"--tier",
				"3",
				"--runs",
				"1",
				"--warmups",
				"0",
				"--thinking",
				"low",
				"--timeout-ms",
				"120000",
				"--fail-fast-provider-error",
				"--out",
				out,
			],
			{
				cwd: repoRoot,
				env: {
					...process.env,
					XCSH_API_URL: server.url.origin,
					XCSH_API_TOKEN: token,
					XCSH_NAMESPACE: "default",
					XCSH_BENCHMARK_LOCAL_FIXTURE: "1",
				},
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		const exitCode = await child.exited;
		const raw = await fs.readFile(out, "utf8");
		const secretsMasked = !raw.includes(token);
		// Persist only sanitized evidence, even if acceptance discovers a masking regression.
		await fs.writeFile(out, raw.replaceAll(token, "[SYNTHETIC-TOKEN-MASKED]"));
		const report = JSON.parse(raw) as ScenarioBenchmarkReport;
		const operations = requests.filter(request => request.method !== "HEAD");
		const modelCount = DEFAULT_MODEL_SCENARIO_TARGETS.length;
		let requestPassed = operations.length === 0;
		if (id === "api-native-execution")
			requestPassed =
				operations.length === modelCount &&
				operations.every(
					request =>
						request.method === "GET" &&
						request.path === "/api/config/namespaces/default/http_loadbalancers" &&
						request.authenticated &&
						request.body === "",
				);
		if (id === "api-curl-execution")
			requestPassed =
				operations.length === modelCount &&
				operations.every(request => {
					const body = JSON.parse(request.body);
					return (
						request.method === "POST" &&
						request.path === "/api/config/namespaces/default/http_loadbalancers" &&
						request.authenticated &&
						request.contentType?.includes("application/json") &&
						body.metadata.name === "curl-example" &&
						body.metadata.namespace === "default" &&
						body.spec.domains?.[0] === "curl-example.example.com" &&
						body.spec.http?.port === 80
					);
				});
		let examplesPassed = true;
		if (id.endsWith("example")) {
			for (const sample of report.samples) {
				for (const turn of sample.turns) {
					const validator = Bun.spawn(
						[
							"python3",
							path.join(repoRoot, "scripts/validate_curl_example.py"),
							id === "api-curl-post-example" ? "POST" : "GET",
						],
						{ stdin: "pipe", stdout: "inherit", stderr: "inherit" },
					);
					validator.stdin.write(turn.response);
					validator.stdin.end();
					if ((await validator.exited) !== 0) examplesPassed = false;
				}
			}
		}
		const passed = exitCode === 0 && secretsMasked && requestPassed && examplesPassed;
		results.push({
			id,
			passed,
			secretsMasked,
			requestPassed,
			examplesPassed,
			operations,
			samples: report.samples.map(sample => ({
				model: sample.selector,
				success: sample.success,
				contractPassed: sample.contractPassed,
				contractFailures: sample.contractFailures,
			})),
		});
		if (!passed) failed = true;
	} finally {
		server.stop(true);
	}
}
await fs.writeFile(path.join(outputDir, "acceptance.json"), `${JSON.stringify(results, null, 2)}\n`);
if (failed) process.exitCode = 1;
