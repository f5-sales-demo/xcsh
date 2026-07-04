/**
 * Baseline benchmark for extension loading — the dominant remaining cost in the
 * blocking startup span (createAgentSession → discoverAndLoadExtensions).
 *
 * Run manually:  bun packages/coding-agent/bench/extension-loading.ts
 *
 * Reports (self-measured with Bun.nanoseconds() — logger.time spans are not
 * programmatically readable):
 *  - cold discoverAndLoadExtensions incl. the one-time app-barrel self-import
 *  - loadExtensions marginal cost as extension count grows (barrel already warm),
 *    which reveals the sequential-loop scaling a future Promise.all would address.
 *
 * Dynamic import() caches modules, so every fixture uses a UNIQUE filename to
 * measure real cold-import cost rather than cache hits.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectAgentDir, TempDir } from "@f5-sales-demo/pi-utils";
import { discoverAndLoadExtensions, loadExtensions } from "../src/extensibility/extensions/loader";

const tempDir = TempDir.createSync("@pi-ext-bench-");
const extensionsDir = path.join(getProjectAgentDir(tempDir.path()), "extensions");
fs.mkdirSync(extensionsDir, { recursive: true });

let uid = 0;
const extSource = (id: string) => `
	export default function (pi) {
		const { Type } = pi.typebox;
		pi.registerTool({
			name: "tool_${id}",
			label: "tool_${id}",
			description: "bench tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
		});
	}
`;
const writeExts = (count: number): string[] =>
	Array.from({ length: count }, () => {
		const name = `bench_${uid++}.ts`;
		const p = path.join(extensionsDir, name);
		fs.writeFileSync(p, extSource(String(uid)));
		return p;
	});

async function measure(label: string, fn: () => Promise<unknown>): Promise<void> {
	const start = Bun.nanoseconds();
	await fn();
	const elapsedMs = (Bun.nanoseconds() - start) / 1e6;
	console.log(`${label}: ${elapsedMs.toFixed(2)}ms`);
}

// 1. Cold full discovery+load (first run pays the app-barrel self-import).
await measure("discoverAndLoadExtensions (cold, incl. barrel + bundled)", () =>
	discoverAndLoadExtensions([], tempDir.path()),
);

// 2. Marginal per-extension cost with the barrel already warm.
for (const n of [1, 4, 8, 16]) {
	const paths = writeExts(n);
	await measure(`loadExtensions N=${n} (warm barrel)`, () => loadExtensions(paths, tempDir.path()));
}

tempDir.removeSync();
