import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { presentation } from "../src/extensibility/presentation";

test("the lightweight public package entry point uses the injected presentation implementation", async () => {
	const api = await import("@f5-sales-demo/xcsh/presentation");
	expect(api.presentation).toBe(presentation);
	expect(api.presentation.data({ total: 0 })[0]).toEqual({ kind: "fields", values: { total: 0 } });
});

test("a strict presentation consumer does not compile application dependencies", () => {
	const temp = mkdtempSync(join(tmpdir(), "xcsh-presentation-consumer-"));
	try {
		const modulePath = Bun.resolveSync("@f5-sales-demo/xcsh/presentation", import.meta.dir);
		const packagePath = Bun.resolveSync("@typescript/native-preview/package.json", import.meta.dir);
		const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
		writeFileSync(
			join(temp, "consumer.ts"),
			'import { presentation } from "@f5-sales-demo/xcsh/presentation";\npresentation.data({ total: 0 });\npresentation.command(["sf", "--version"]);\n',
		);
		writeFileSync(
			join(temp, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2022",
					module: "ESNext",
					moduleResolution: "Bundler",
					strict: true,
					noUncheckedIndexedAccess: true,
					noEmit: true,
					types: [],
					paths: { "@f5-sales-demo/xcsh/presentation": [modulePath] },
				},
				files: [join(temp, "consumer.ts")],
			}),
		);
		const result = Bun.spawnSync([
			process.execPath,
			resolve(dirname(packagePath), manifest.bin.tsgo),
			"-p",
			join(temp, "tsconfig.json"),
		]);
		expect(new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}, 30_000);
