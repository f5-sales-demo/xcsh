import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGatewayStatus } from "../../src/ipy/gateway-coordinator";

const original = process.env.XCSH_PYTHON_GATEWAY_DIR;
const directories: string[] = [];
afterEach(() => {
	if (original === undefined) delete process.env.XCSH_PYTHON_GATEWAY_DIR;
	else process.env.XCSH_PYTHON_GATEWAY_DIR = original;
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("container gateway directories isolate stale process identities across launches", async () => {
	const root = mkdtempSync(join(tmpdir(), "xcsh-gateway-directory-"));
	directories.push(root);
	const previous = join(root, "previous");
	const current = join(root, "current");
	mkdirSync(previous);
	mkdirSync(current);
	writeFileSync(
		join(previous, "gateway.json"),
		JSON.stringify({ url: "http://127.0.0.1:1234", pid: process.pid, startedAt: Date.now() }),
	);
	process.env.XCSH_PYTHON_GATEWAY_DIR = previous;
	expect((await getGatewayStatus()).url).toBe("http://127.0.0.1:1234");
	process.env.XCSH_PYTHON_GATEWAY_DIR = current;
	expect((await getGatewayStatus()).active).toBe(false);
	expect((await getGatewayStatus()).url).toBeNull();
});
