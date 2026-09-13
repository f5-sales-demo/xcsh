import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** Isolate both saved user contexts and ancestor project contexts for each test module. */
export function contextlessCliFixture() {
	const cwd = mkdtempSync(join(tmpdir(), "xcsh-contextless-cli-"));
	afterAll(() => rmSync(cwd, { recursive: true, force: true }));
	return { cwd, env: { XDG_CONFIG_HOME: cwd, XCSH_API_URL: "", XCSH_API_TOKEN: "", XCSH_NAMESPACE: "" } };
}
