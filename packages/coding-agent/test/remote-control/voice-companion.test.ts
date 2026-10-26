import { expect, test } from "bun:test";
import { CompanionAdmission } from "../../src/remote-control/voice-companion";

test("companion admission is single-use and bound to current chat, expiry and credential", () => {
	const admission = new CompanionAdmission("fixture-secret", "chat-fixture", 10);
	expect(admission.claim("wrong", "chat-fixture", 1)).toBe(false);
	expect(admission.claim("fixture-secret", "other-chat", 1)).toBe(false);
	expect(admission.claim("fixture-secret", "chat-fixture", 11)).toBe(false);
	expect(admission.claim("fixture-secret", "chat-fixture", 1)).toBe(true);
	expect(admission.claim("fixture-secret", "chat-fixture", 1)).toBe(false);
});

test("explicit app reopen reuses application authentication while only one connection can claim it", () => {
	const admission = new CompanionAdmission("fixture-token", "chat", 10);
	expect(admission.claim("fixture-token", "chat", 1)).toBe(true);
	expect(admission.claim("fixture-token", "chat", 2)).toBe(false);
	admission.release();
	expect(admission.claim("fixture-token", "different-chat", 11)).toBe(false);
	expect(admission.claim("fixture-token", "chat", 11)).toBe(true);
});
