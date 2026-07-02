#!/usr/bin/env bun
/**
 * CLI: derive minimal valid specs purely by error-driven API probing (seed {}).
 * Thin wrapper over `probeSpec` (src/sweep/spec-probe.ts) — the same engine the
 * hybrid (gen-specs.ts) uses with an OpenAPI-walker seed.
 *
 * Usage: XCSH_API_URL=… XCSH_API_TOKEN=… XCSH_NAMESPACE=demo \
 *        bun scripts/spec-prober.ts <resource1> [resource2 …]
 */
import { probeSpec } from "../src/sweep/spec-probe";

const NAMESPACE = process.env.XCSH_NAMESPACE ?? "demo";
const BASE_URL = (process.env.XCSH_API_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.XCSH_API_TOKEN ?? "";

async function main() {
	if (!BASE_URL || !TOKEN) {
		console.error("XCSH_API_URL / XCSH_API_TOKEN required");
		process.exit(1);
	}
	for (const resource of process.argv.slice(2)) {
		const name = /domain|dns-zone/.test(resource) ? "xcsh-probe.example.com" : `xcsh-probe-${resource}`.slice(0, 63);
		const r = await probeSpec({ baseUrl: BASE_URL, token: TOKEN, namespace: NAMESPACE, resource, name });
		console.log(
			`\n${r.ok ? "✅" : "❌"} ${resource} (${r.iters} iters, ns=${r.namespace})` +
				`\n   spec: ${JSON.stringify(r.spec)}` +
				(r.ok ? "" : `\n   stuck: ${r.lastError}`),
		);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
