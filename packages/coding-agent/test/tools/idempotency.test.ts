import { describe, expect, it } from "bun:test";
import { isAlreadyExistsError, resolvePreflightAction } from "../../src/tools/idempotency";

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
