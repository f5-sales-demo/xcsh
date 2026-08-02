import * as path from "node:path";

/** Stable package paths for subprocess integration tests, independent of the test runner's cwd. */
export const CODING_AGENT_ROOT = path.resolve(import.meta.dir, "../..");
export const CODING_AGENT_CLI = path.join(CODING_AGENT_ROOT, "src/cli.ts");
