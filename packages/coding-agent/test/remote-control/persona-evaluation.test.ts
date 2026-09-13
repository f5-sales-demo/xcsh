import { expect, test } from "bun:test";
import { emptyProfile } from "../../src/person-profile/schema";
import { scorePersonContract } from "../../src/remote-control/persona-evaluation";

test("only a successful canonical retrieval with matching structured data qualifies", () => {
	const expected = emptyProfile();
	expect(
		scorePersonContract([{ toolName: "person_profile", action: "get", success: true, profile: expected }], expected)
			.passed,
	).toBe(true);
	expect(
		scorePersonContract([{ toolName: "read", resource: "xcsh://user", success: true, profile: expected }], expected)
			.passed,
	).toBe(true);
	expect(
		scorePersonContract(
			[{ toolName: "read", resource: "memory://root/memory_summary.md", success: true, profile: expected }],
			expected,
		).passed,
	).toBe(false);
	expect(
		scorePersonContract([{ toolName: "person_profile", action: "get", success: false, profile: expected }], expected)
			.passed,
	).toBe(false);
	expect(
		scorePersonContract(
			[{ toolName: "person_profile", action: "get", success: true, profile: { ...expected, revision: 1 } }],
			expected,
		).passed,
	).toBe(false);
	expect(scorePersonContract([], expected).passed).toBe(false);
});
