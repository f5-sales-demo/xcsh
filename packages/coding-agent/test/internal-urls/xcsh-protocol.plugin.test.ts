import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import type { InternalUrl } from "../../src/internal-urls/types";
import { InternalDocsProtocolHandler } from "../../src/internal-urls/xcsh-protocol";

let root: string;

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-plugin-"));
	await fs.mkdir(path.join(root, ".xcsh-plugin"), { recursive: true });
	await fs.writeFile(path.join(root, ".xcsh-plugin", "resources.json"), JSON.stringify({ schema: "s.json" }));
	await fs.writeFile(path.join(root, "s.json"), `{"ok":true}`);
});
afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("InternalDocsProtocolHandler plugin host", () => {
	const handler = new InternalDocsProtocolHandler({
		getPluginRoots: async () => [{ plugin: "demo", version: "1.0.0", path: root }],
	});

	test("routes xcsh://plugin/<name>/schema", async () => {
		const r = await handler.resolve(parseInternalUrl("xcsh://plugin/demo/schema") as InternalUrl);
		expect(r.contentType).toBe("application/json");
		expect(r.sourcePath).toBe(path.join(root, "s.json"));
	});
});
