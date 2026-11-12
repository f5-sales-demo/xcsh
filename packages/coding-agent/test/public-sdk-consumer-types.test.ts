import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("published SDK source supports strict TypeScript consumers and side-effect sinks", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-public-types-"));
	const agent = resolve(import.meta.dir, "..");
	const workspace = resolve(agent, "../..");
	const fixture = join(root, "consumer.ts");
	await writeFile(
		fixture,
		`import * as sdk from ${JSON.stringify(join(agent, "src/index"))};
void sdk;
`,
	);
	const config = join(root, "tsconfig.json");
	await writeFile(
		config,
		JSON.stringify({
			extends: join(workspace, "tsconfig.base.json"),
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2024",
				module: "ESNext",
				moduleResolution: "bundler",
				lib: ["ES2024", "DOM.AsyncIterable"],
				types: ["bun"],
				skipLibCheck: true,
				typeRoots: [join(workspace, "node_modules/@types")],
			},
			files: [fixture],
		}),
	);
	const child = Bun.spawn(
		[process.execPath, join(workspace, "node_modules/typescript/bin/tsc"), "--project", config],
		{ cwd: workspace, stdout: "pipe", stderr: "pipe" },
	);
	const output = await new Response(child.stdout).text();
	const errors = await new Response(child.stderr).text();
	const code = await child.exited;
	await writeFile(join(root, "typescript-output.txt"), output + errors);
	expect(
		code,
		`Strict public SDK consumer failed; complete diagnostics retained at ${root}\n${(output + errors).slice(-4000)}`,
	).toBe(0);
}, 120_000);
