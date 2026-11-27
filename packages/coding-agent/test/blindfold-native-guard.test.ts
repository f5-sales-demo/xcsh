import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import guard from "../scripts/blindfold-native-guard";
import type { ExtensionAPI } from "../src/extensibility/extensions";

const folders: string[] = [];
afterAll(() => {
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
function create() {
	const root = mkdtempSync(path.join(tmpdir(), "blindfold-guard-"));
	folders.push(root);
	const trace = path.join(root, "trace.jsonl");
	const handlers = new Map<string, (event: unknown) => unknown>();
	const oldRoot = process.env.XCSH_BLINDFOLD_EVAL_ROOT,
		oldTrace = process.env.XCSH_BLINDFOLD_EVAL_TRACE;
	process.env.XCSH_BLINDFOLD_EVAL_ROOT = root;
	process.env.XCSH_BLINDFOLD_EVAL_TRACE = trace;
	try {
		guard({
			on: (name: string, handler: (event: unknown) => unknown) => handlers.set(name, handler),
		} as unknown as ExtensionAPI);
	} finally {
		if (oldRoot === undefined) delete process.env.XCSH_BLINDFOLD_EVAL_ROOT;
		else process.env.XCSH_BLINDFOLD_EVAL_ROOT = oldRoot;
		if (oldTrace === undefined) delete process.env.XCSH_BLINDFOLD_EVAL_TRACE;
		else process.env.XCSH_BLINDFOLD_EVAL_TRACE = oldTrace;
	}
	return {
		root,
		call: (name: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName: name, input }),
		events: () =>
			readFileSync(trace, "utf8")
				.trim()
				.split("\n")
				.map(line => JSON.parse(line)) as Array<{ type: string; violation?: boolean }>,
	};
}
test("admits supplied offline preparation and blocks native deployment", () => {
	const g = create();
	expect(
		g.call("xcsh_blindfold", {
			operation: "encrypt",
			input: "secret.txt",
			publicKey: "public.json",
			policyDocument: "policy.json",
			outputFile: "secret.blindfold",
		}),
	).toBeUndefined();
	expect(g.call("xcsh_blindfold", { operation: "create" })).toMatchObject({ block: true });
	expect(g.events().at(-1)?.violation).toBe(true);
});
test("blocks missing offline material without calling a read-only lookup a cloud mutation", () => {
	const g = create();
	expect(
		g.call("xcsh_blindfold", { operation: "encrypt", input: "secret.txt", outputFile: "secret.blindfold" }),
	).toMatchObject({ block: true });
	expect(g.events().at(-1)?.violation).toBe(false);
});
test("distinguishes blocked API reads from attempted writes", () => {
	const g = create();
	expect(g.call("xcsh_api", { method: "GET", path: "/synthetic" })).toMatchObject({ block: true });
	expect(g.events().at(-1)?.violation).toBe(false);
	expect(g.call("xcsh_api", { method: "POST", path: "/synthetic" })).toMatchObject({ block: true });
	expect(g.events().at(-1)?.violation).toBe(true);
});
test("protects every prepared output and blocks obsolete command execution", () => {
	const g = create();
	expect(g.call("read", { path: "existing.blindfold" })).toMatchObject({ block: true });
	g.call("xcsh_blindfold", {
		operation: "encrypt",
		input: "secret.txt",
		publicKey: "public.json",
		policyDocument: "policy.json",
		outputFile: "alternate.blindfold",
	});
	writeFileSync(path.join(g.root, "alternate.blindfold"), "SYNTHETIC-ENCRYPTED-OUTPUT");
	expect(g.call("read", { path: "alternate.blindfold" })).toMatchObject({ block: true });
	expect(g.call("bash", { command: "vesctl request secrets encrypt" })).toMatchObject({ block: true });
	expect(g.events().at(-1)?.violation).toBe(true);
});
