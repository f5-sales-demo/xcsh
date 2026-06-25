import { describe, expect, it } from "bun:test";
import {
	AUTH_ENV_KEYS,
	isSensitiveEnvKey,
	RESERVED_ENV_KEYS,
	SECRET_ENV_PATTERNS,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_CONSOLE_PASSWORD,
	XCSH_CONTEXT_NAME,
	XCSH_NAMESPACE,
	XCSH_TENANT,
	XCSH_USERNAME,
} from "../src/xcsh-env-names";

describe("env name constants", () => {
	it("expose the canonical XCSH_ names", () => {
		expect(XCSH_API_URL).toBe("XCSH_API_URL");
		expect(XCSH_API_TOKEN).toBe("XCSH_API_TOKEN");
		expect(XCSH_NAMESPACE).toBe("XCSH_NAMESPACE");
		expect(XCSH_TENANT).toBe("XCSH_TENANT");
		expect(XCSH_USERNAME).toBe("XCSH_USERNAME");
		expect(XCSH_CONSOLE_PASSWORD).toBe("XCSH_CONSOLE_PASSWORD");
		expect(XCSH_CONTEXT_NAME).toBe("XCSH_CONTEXT_NAME");
	});
});

describe("RESERVED_ENV_KEYS", () => {
	it("contains the five control keys and excludes the auth keys", () => {
		expect(RESERVED_ENV_KEYS.has(XCSH_API_URL)).toBe(true);
		expect(RESERVED_ENV_KEYS.has(XCSH_API_TOKEN)).toBe(true);
		expect(RESERVED_ENV_KEYS.has(XCSH_NAMESPACE)).toBe(true);
		expect(RESERVED_ENV_KEYS.has(XCSH_TENANT)).toBe(true);
		expect(RESERVED_ENV_KEYS.has(XCSH_CONTEXT_NAME)).toBe(true);
		// Auth credentials are generic env entries, NOT reserved.
		expect(RESERVED_ENV_KEYS.has(XCSH_USERNAME)).toBe(false);
		expect(RESERVED_ENV_KEYS.has(XCSH_CONSOLE_PASSWORD)).toBe(false);
	});
});

describe("AUTH_ENV_KEYS", () => {
	it("lists username then console password in display order", () => {
		expect([...AUTH_ENV_KEYS]).toEqual([XCSH_USERNAME, XCSH_CONSOLE_PASSWORD]);
	});
});

describe("isSensitiveEnvKey", () => {
	it("treats the console password as sensitive but the username as not", () => {
		expect(isSensitiveEnvKey(XCSH_CONSOLE_PASSWORD)).toBe(true);
		expect(isSensitiveEnvKey(XCSH_USERNAME)).toBe(false);
	});

	it("matches the documented secret name patterns", () => {
		expect(isSensitiveEnvKey("XCSH_API_TOKEN")).toBe(true);
		expect(isSensitiveEnvKey("MY_SECRET")).toBe(true);
		expect(isSensitiveEnvKey("DB_PASSWORD")).toBe(true);
		expect(isSensitiveEnvKey("PRIVATE_KEY")).toBe(true);
		expect(isSensitiveEnvKey("XCSH_EMAIL")).toBe(false);
		expect(isSensitiveEnvKey("XCSH_LB_NAME")).toBe(false);
	});

	it("delegates to SECRET_ENV_PATTERNS", () => {
		expect(isSensitiveEnvKey("FOO_TOKEN")).toBe(SECRET_ENV_PATTERNS.test("FOO_TOKEN"));
	});
});
