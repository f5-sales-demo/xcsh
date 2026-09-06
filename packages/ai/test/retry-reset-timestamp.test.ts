import { afterEach, describe, expect, test, vi } from "bun:test";
import { getRetryAfterMsFromErrorText } from "../src/utils/retry-after";

const HOUR_MS = 60 * 60 * 1000;

describe("retry reset timestamp parsing", () => {
	const now = Date.UTC(2026, 8, 6, 12, 0, 0);

	afterEach(() => vi.restoreAllMocks());

	test("parses retry-after-ms and absolute English and Chinese reset timestamps", () => {
		vi.spyOn(Date, "now").mockReturnValue(now);

		expect(getRetryAfterMsFromErrorText("rate limited retry-after-ms=98497000")).toBe(98_497_000);
		expect(getRetryAfterMsFromErrorText("Your limit will reset at 2026-09-06 13:00:00")).toBe(HOUR_MS);
		expect(getRetryAfterMsFromErrorText("您的限额将在 2026-09-06 13:30:00 重置。")).toBe(90 * 60_000);
	});

	test("ignores invalid and expired absolute timestamps", () => {
		vi.spyOn(Date, "now").mockReturnValue(now);

		expect(getRetryAfterMsFromErrorText("Your limit will reset at 2026-09-06 11:59:59")).toBeUndefined();
		expect(getRetryAfterMsFromErrorText("Your limit will reset at never")).toBeUndefined();
	});
});
