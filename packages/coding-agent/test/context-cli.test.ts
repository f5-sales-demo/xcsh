import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-cli-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
async function invoke(args: string[], input = "", preload?: string) {
	const child = Bun.spawn(
		[
			process.execPath,
			...(preload ? ["--preload", preload] : []),
			path.resolve(import.meta.dir, "../src/cli.ts"),
			"context",
			...args,
		],
		{
			cwd: root,
			env: { ...process.env, XDG_CONFIG_HOME: root, XCSH_API_URL: "", XCSH_API_TOKEN: "" },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	child.stdin.write(input);
	child.stdin.end();
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
describe("deterministic context CLI", () => {
	it("lists JSON without prompts or inference", async () => {
		const result = await invoke(["--json"]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual([]);
		expect(result.stderr).toBe("");
	});
	it.each([
		[["show"]],
		[["delete", "demo"]],
		[["create", "demo", "https://tenant.example.test"]],
		[["rename", "demo"]],
		[["edit", "demo"]],
	])("returns usage exit 2 for %j", async args => {
		const result = await invoke(args);
		expect(result.code).toBe(2);
		expect(result.stdout).toBe("");
	});
	it("imports stdin and masks ordinary JSON output", async () => {
		const bundle = {
			version: 1,
			tokensMasked: false,
			contexts: [
				{
					name: "demo",
					apiUrl: "https://tenant.example.test",
					apiToken: "private-synthetic-token",
					defaultNamespace: "default",
					env: { XCSH_PASSWORD: "private-synthetic-password" },
				},
			],
		};
		expect((await invoke(["import", "-", "--json"], JSON.stringify(bundle))).code).toBe(0);
		const result = await invoke(["show", "demo", "--json"]);
		expect(result.code).toBe(0);
		expect(result.stdout).not.toContain("private-synthetic");
		expect(JSON.parse(result.stdout).context.name).toBe("demo");
		const exported = await invoke(["export", "demo"]);
		expect(JSON.parse(exported.stdout).tokensMasked).toBe(true);
	});
	it("returns execution exit 1 and safe parse errors", async () => {
		expect((await invoke(["show", "missing", "--json"])).code).toBe(1);
		const result = await invoke(["import", "-"], "secret-synthetic-invalid-json");
		expect(result.code).toBe(1);
		expect(result.stderr).not.toContain("secret-synthetic");
	});
});

it("creates and replaces tokens from stdin, validates failures and never prints secrets", async () => {
	const mock = path.join(root, "auth-fixture.ts");
	fs.writeFileSync(mock, "globalThis.fetch = async () => Response.json({items: []});");
	let result = await invoke(
		["create", "stdin-demo", "https://tenant.example.test", "--token-stdin", "--json"],
		"synthetic-private-token\n",
		mock,
	);
	expect(result.code).toBe(0);
	expect(result.stdout).not.toContain("synthetic-private-token");
	result = await invoke(["edit", "stdin-demo", "--token-stdin", "--json"], "synthetic-replacement-token\n", mock);
	expect(result.code).toBe(0);
	expect(result.stdout).not.toContain("synthetic-replacement-token");
	fs.writeFileSync(mock, "globalThis.fetch = async () => Response.json({}, {status: 401});");
	result = await invoke(["validate", "stdin-demo", "--json"], "", mock);
	expect(result.code).toBe(1);
	expect(JSON.parse(result.stdout).failureReason).toBe("unauthorized");
	expect((await invoke(["edit", "stdin-demo", "--token-stdin"], "one\ntwo\n", mock)).code).toBe(2);
});
