import { describe, expect, test } from "bun:test";
import { officeHelloFrame, waitForOfficeApplicationReady } from "../scripts/uat/bridge-client";

describe("Office UAT bridge handshake", () => {
	test("announces the required contract version and Excel host", () => {
		expect(officeHelloFrame()).toEqual({ type: "hello", version: "1", host: "excel" });
	});

	test("retries an application-level probe until ChatHandler is attached", async () => {
		let attempts = 0;
		const requests: Array<{ message: unknown; accept: unknown }> = [];
		const client = {
			request: async (message: unknown, accept: unknown) => {
				requests.push({ message, accept });
				attempts++;
				if (attempts < 3) throw new Error("Timed out waiting for a frame");
				return { type: "skills" };
			},
		};

		await waitForOfficeApplicationReady(client, {
			timeoutMs: 100,
			attemptTimeoutMs: 10,
			retryDelayMs: 0,
		});
		expect(attempts).toBe(3);
		expect(requests).toEqual([
			{ message: { type: "list_skills" }, accept: "skills" },
			{ message: { type: "list_skills" }, accept: "skills" },
			{ message: { type: "list_skills" }, accept: "skills" },
		]);
	});
});
