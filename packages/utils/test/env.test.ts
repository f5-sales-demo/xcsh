import { describe, expect, it } from "bun:test";
import { $envExact } from "../src/env";

/** Model Windows environment semantics: case-insensitive reads, case-preserving enumeration. */
function windowsLikeEnv(backing: Record<string, string>): Record<string, string | undefined> {
	return new Proxy(backing, {
		get(target, prop) {
			if (typeof prop !== "string") return Reflect.get(target, prop);
			for (const key in target) {
				if (key.toLowerCase() === prop.toLowerCase()) return target[key];
			}
			return undefined;
		},
	}) as Record<string, string | undefined>;
}

describe("$envExact", () => {
	it("returns the value for an exact-case key", () => {
		expect($envExact("OPENCODE_API_KEY", { OPENCODE_API_KEY: "sk-live", PATH: "/usr/bin" })).toBe("sk-live");
	});

	it("returns undefined for an absent name", () => {
		expect($envExact("MISSING_VAR", { PATH: "/usr/bin" })).toBeUndefined();
	});

	it("does not hijack a literal via a case-differing Windows system variable", () => {
		const env = windowsLikeEnv({ PUBLIC: "C:\\SyntheticData\\Public" });
		expect(env.public).toBe("C:\\SyntheticData\\Public");
		expect($envExact("public", env)).toBeUndefined();
	});

	it("still resolves a genuine exact-case reference on a case-insensitive environment", () => {
		const env = windowsLikeEnv({ MY_KEY: "secret" });
		expect($envExact("MY_KEY", env)).toBe("secret");
		expect($envExact("my_key", env)).toBeUndefined();
	});

	it("reads process.env by default", () => {
		const name = `XCSH_ENVEXACT_TEST_${Date.now()}`;
		process.env[name] = "value";
		try {
			expect($envExact(name)).toBe("value");
		} finally {
			delete process.env[name];
		}
		expect($envExact(name)).toBeUndefined();
	});
});
