import { describe, expect, it } from "bun:test";
import { F5XCApiError } from "@f5xc-salesdemos/xcsh/services/f5xc-api-client";

describe("F5XCApiError", () => {
	it("carries kind and status", () => {
		const err = new F5XCApiError("unauthorized", "auth", 401);
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(F5XCApiError);
		expect(err.message).toBe("unauthorized");
		expect(err.name).toBe("F5XCApiError");
		expect(err.kind).toBe("auth");
		expect(err.status).toBe(401);
	});

	it("status is optional", () => {
		const err = new F5XCApiError("timeout", "network");
		expect(err.kind).toBe("network");
		expect(err.status).toBeUndefined();
	});
});
