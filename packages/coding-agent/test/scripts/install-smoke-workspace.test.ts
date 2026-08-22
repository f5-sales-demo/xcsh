import { expect, test } from "bun:test";
import * as path from "node:path";

const INSTALL_SMOKE = path.resolve(import.meta.dir, "../../../../scripts/install-tests/run-ci.sh");

test("install smoke uses the Actions workspace temp directory when available", async () => {
	const script = await Bun.file(INSTALL_SMOKE).text();

	expect(script).toContain('RUNNER_TEMP_ROOT="${RUNNER_TEMP%/}/xcsh-install-tests"');
	expect(script).toContain('mkdir -p "$RUNNER_TEMP_ROOT"');
	expect(script).toContain('export TMPDIR="$RUNNER_TEMP_ROOT"');
	expect(script).toContain('WORK_DIR="$(mktemp -d "${TMPDIR%/}/xcsh-install-tests.XXXXXX")"');
});
