import { describe, expect, it } from "bun:test";
import { validateContextWithStartupRetry } from "../src/modes/components/welcome-checks";
import type { AuthStatus } from "../src/services/xcsh-context";

type ValidateResult = { status: AuthStatus; latencyMs?: number };
type Validator = (opts: { timeoutMs: number }) => Promise<ValidateResult>;

function recordingValidator(results: ValidateResult[]): {
	fn: Validator;
	calls: Array<{ timeoutMs: number }>;
} {
	const calls: Array<{ timeoutMs: number }> = [];
	const fn: Validator = async opts => {
		calls.push(opts);
		const r = results.shift();
		if (!r) throw new Error("validator called more times than expected");
		return r;
	};
	return { fn, calls };
}

describe("validateContextWithStartupRetry", () => {
	it("uses a startup timeout larger than the 3000ms default on the first attempt", async () => {
		const { fn, calls } = recordingValidator([{ status: "connected", latencyMs: 120 }]);
		await validateContextWithStartupRetry(fn);
		expect(calls.length).toBe(1);
		expect(calls[0].timeoutMs).toBeGreaterThan(3000);
	});

	it("does not retry when the first attempt succeeds", async () => {
		const { fn, calls } = recordingValidator([{ status: "connected", latencyMs: 200 }]);
		const r = await validateContextWithStartupRetry(fn);
		expect(calls.length).toBe(1);
		expect(r.status).toBe("connected");
		expect(r.latencyMs).toBe(200);
	});

	it("does not retry on auth_error (the error is definitive, not transient)", async () => {
		const { fn, calls } = recordingValidator([{ status: "auth_error" }]);
		const r = await validateContextWithStartupRetry(fn);
		expect(calls.length).toBe(1);
		expect(r.status).toBe("auth_error");
	});

	it("retries once with a longer timeout if the first attempt is offline", async () => {
		const { fn, calls } = recordingValidator([{ status: "offline" }, { status: "connected", latencyMs: 900 }]);
		const r = await validateContextWithStartupRetry(fn, { retryDelayMs: 0 });
		expect(calls.length).toBe(2);
		expect(calls[1].timeoutMs).toBeGreaterThanOrEqual(calls[0].timeoutMs);
		expect(r.status).toBe("connected");
		expect(r.latencyMs).toBe(900);
	});

	it("reports offline only after both attempts fail", async () => {
		const { fn, calls } = recordingValidator([{ status: "offline" }, { status: "offline" }]);
		const r = await validateContextWithStartupRetry(fn, { retryDelayMs: 0 });
		expect(calls.length).toBe(2);
		expect(r.status).toBe("offline");
	});

	it("respects a custom firstTimeoutMs override", async () => {
		const { fn, calls } = recordingValidator([{ status: "connected", latencyMs: 10 }]);
		await validateContextWithStartupRetry(fn, { firstTimeoutMs: 7000 });
		expect(calls[0].timeoutMs).toBe(7000);
	});

	it("waits for retryDelayMs between attempts", async () => {
		const { fn } = recordingValidator([{ status: "offline" }, { status: "connected", latencyMs: 5 }]);
		const start = performance.now();
		await validateContextWithStartupRetry(fn, { retryDelayMs: 50 });
		const elapsed = performance.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(40); // allow for scheduler slop
	});
});
