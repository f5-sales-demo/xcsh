import { expect, test } from "bun:test";
import * as path from "node:path";

const INSTALL_SMOKE = path.resolve(import.meta.dir, "../../../../scripts/install-tests/run-ci.sh");

test("install smoke uses the Actions workspace temp directory when available", async () => {
	const script = await Bun.file(INSTALL_SMOKE).text();

	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell interpolation contract
	expect(script).toContain('RUNNER_TEMP_ROOT="${RUNNER_TEMP%/}/xcsh-install-tests"');
	expect(script).toContain('mkdir -p "$RUNNER_TEMP_ROOT"');
	expect(script).toContain('export TMPDIR="$RUNNER_TEMP_ROOT"');
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell interpolation contract
	expect(script).toContain('WORK_DIR="$(mktemp -d "${TMPDIR%/}/xcsh-install-tests.XXXXXX")"');
});

test("tarball smoke seeds an isolated cache with the unpublished candidate binary", async () => {
	const script = await Bun.file(INSTALL_SMOKE).text();

	expect(script).toContain("candidate_version=$(node -p \"require('./packages/coding-agent/package.json').version\")");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell interpolation contract
	expect(script).toContain('candidate_cache_dir="$candidate_cache/v${candidate_version}/${candidate_runtime}"');
	expect(script).toContain('cp "$BINARY_DIR/xcsh" "$candidate_cache_dir/$candidate_asset"');
	expect(script).toContain('XCSH_RELEASE_CACHE_DIR="$candidate_cache" smoke_cli ./node_modules/.bin/xcsh');
	expect(script).toContain("post-publish npm");
});
