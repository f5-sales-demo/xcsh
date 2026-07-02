import { describe, expect, it } from "bun:test";
import { isAlreadyExistsError, isTrustedApiUrl, resolvePreflightAction } from "../../src/tools/idempotency";

describe("resolvePreflightAction", () => {
	it("proceeds when the object does not exist (any mode)", () => {
		expect(resolvePreflightAction(false, "skip")).toBe("proceed");
		expect(resolvePreflightAction(false, "recreate")).toBe("proceed");
		expect(resolvePreflightAction(false, "error")).toBe("proceed");
	});

	it("skips an existing object in skip mode (idempotent no-op)", () => {
		expect(resolvePreflightAction(true, "skip")).toBe("skip");
	});

	it("deletes first when recreate mode and the object exists", () => {
		expect(resolvePreflightAction(true, "recreate")).toBe("delete-first");
	});

	it("proceeds (surfaces the console error) in error mode", () => {
		expect(resolvePreflightAction(true, "error")).toBe("proceed");
	});
});

describe("isAlreadyExistsError", () => {
	it("detects already-exists phrasings", () => {
		expect(isAlreadyExistsError("object already exists")).toBe(true);
		expect(isAlreadyExistsError("Error 409: conflict")).toBe(true);
		expect(isAlreadyExistsError("duplicate key value")).toBe(true);
		expect(isAlreadyExistsError("An object with this name already exists")).toBe(true);
	});

	it("does not false-positive on unrelated errors", () => {
		expect(isAlreadyExistsError("Field Reference is required")).toBe(false);
		expect(isAlreadyExistsError("Maximum value is 900")).toBe(false);
		expect(isAlreadyExistsError(null)).toBe(false);
		expect(isAlreadyExistsError("")).toBe(false);
	});
});

describe("isTrustedApiUrl (SSRF / credential-leak guard)", () => {
	const expected = "https://nferreira.staging.volterra.us";

	it("allows the configured tenant host over https", () => {
		expect(isTrustedApiUrl("https://nferreira.staging.volterra.us", expected)).toBe(true);
		expect(isTrustedApiUrl("https://nferreira.staging.volterra.us/", expected)).toBe(true);
	});

	it("rejects a mismatched host (credential exfil target)", () => {
		expect(isTrustedApiUrl("https://evil.example.com", expected)).toBe(false);
	});

	it("rejects non-https schemes", () => {
		expect(isTrustedApiUrl("http://nferreira.staging.volterra.us", expected)).toBe(false);
		expect(isTrustedApiUrl("file:///etc/passwd", expected)).toBe(false);
	});

	it("rejects loopback / private / link-local hosts (SSRF)", () => {
		expect(isTrustedApiUrl("https://localhost")).toBe(false);
		expect(isTrustedApiUrl("https://127.0.0.1")).toBe(false);
		expect(isTrustedApiUrl("https://10.0.0.5")).toBe(false);
		expect(isTrustedApiUrl("https://192.168.1.1")).toBe(false);
		expect(isTrustedApiUrl("https://172.16.0.1")).toBe(false);
		expect(isTrustedApiUrl("https://169.254.169.254")).toBe(false);
		expect(isTrustedApiUrl("https://[::1]")).toBe(false);
	});

	it("rejects malformed URLs", () => {
		expect(isTrustedApiUrl("not a url", expected)).toBe(false);
		expect(isTrustedApiUrl("", expected)).toBe(false);
	});

	it("allows any public https host when no expected host is configured", () => {
		expect(isTrustedApiUrl("https://some-tenant.console.ves.volterra.io")).toBe(true);
	});
});
