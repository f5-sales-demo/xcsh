import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { voiceHelperPath } from "./voice-cargo-target";

const repo = resolve("fixture-repository");
test("qualification uses the same default target as Cargo", () => {
	expect(voiceHelperPath(repo, {})).toBe(join(repo, "target", "release", "codex-voice-host"));
});
test("a relative Cargo override is resolved against the build working directory", () => {
	expect(voiceHelperPath(repo, { CARGO_TARGET_DIR: "isolated-target" })).toBe(
		join(repo, "isolated-target", "release", "codex-voice-host"),
	);
});
test("an external target cannot select an older helper from the repository target", () => {
	const external = resolve(repo, "..", "external-target");
	expect(voiceHelperPath(repo, { CARGO_TARGET_DIR: external })).toBe(join(external, "release", "codex-voice-host"));
	expect(voiceHelperPath(repo, { CARGO_TARGET_DIR: external })).not.toBe(voiceHelperPath(repo, {}));
});
