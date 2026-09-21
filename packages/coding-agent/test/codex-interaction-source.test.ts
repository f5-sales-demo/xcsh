import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FRESH_PLAN_PREFIX, PLAN_ACTIONS } from "../../chat-ui/src/interactions/conversation-plan";
import { requestUserInputSchema } from "../src/tools/request-user-input";

const root = resolve(import.meta.dir, "../../chat-ui/test/fixtures/codex-interactions");
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
test("pinned reference fixture bytes retain independent upstream provenance", () => {
	expect(manifest.commit).toBe("d6d43270bd791c41624fd3ee25a37e80a38d374e");
	expect(manifest.upstreamComparisonCommit).toBe("ebc05da3bdb76f25861e7cb418bd06d28cadc609");
	expect(manifest.upstreamComparisonCommit).toBe("ebc05da3bdb76f25861e7cb418bd06d28cadc609");
	for (const [file, digest] of Object.entries(manifest.files))
		expect(
			createHash("sha256")
				.update(readFileSync(resolve(root, file)))
				.digest("hex"),
		).toBe(String(digest));
});
test("waiting field descriptions match pinned Codex source text", () => {
	const source = readFileSync(
		resolve(root, "codex-rs/core/src/tools/handlers/request_user_input_spec.source"),
		"utf8",
	).replaceAll('\\"', '"');
	function visit(value: unknown): void {
		if (value === null || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			if (key === "description" && typeof child === "string") expect(source).toContain(child);
			else visit(child);
		}
	}
	visit(requestUserInputSchema);
});
test("plan instructions and action labels match pinned source", () => {
	expect(readFileSync(resolve(import.meta.dir, "../src/prompts/system/plan-mode-active.md"), "utf8")).toBe(
		readFileSync(resolve(root, "codex-rs/collaboration-mode-templates/templates/plan.source"), "utf8"),
	);
	const implementation = readFileSync(resolve(root, "codex-rs/tui/src/chatwidget/plan_implementation.source"), "utf8");
	for (const action of PLAN_ACTIONS) expect(implementation).toContain(action.label);
	expect(implementation).toContain("AppEvent::FollowTranscript");
	const block = implementation.split("PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX: &str = concat!(")[1].split(");")[0];
	expect([...block.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(match => JSON.parse(`"${match[1]}"`)).join("")).toBe(
		FRESH_PLAN_PREFIX,
	);
});

test("app-server fixtures pin blocking, secret, and active-status contracts", () => {
	const item = readFileSync(resolve(root, "codex-rs/app-server-protocol/src/protocol/v2/item.source"), "utf8");
	const thread = readFileSync(resolve(root, "codex-rs/app-server-protocol/src/protocol/v2/thread.source"), "utf8");
	expect(item).toContain("pub is_secret: bool");
	expect(item).toContain("pub is_blocking: bool");
	expect(thread).toContain("active_flags: Vec<ThreadActiveFlag>");
	expect(thread).toContain("WaitingOnUserInput");
});
