import { describe, expect, test } from "bun:test";
import { downloadMediaUrl } from "../src/media/network";

type Reply = {
	status: number;
	headers: Record<string, string>;
	data: Buffer;
};

describe("downloadMediaUrl redirect security", () => {
	test("revalidates DNS and pins the selected address on every HTTPS redirect", async () => {
		const lookups: string[] = [];
		const requests: Array<{ host: string; address: string }> = [];
		const replies: Reply[] = [
			{ status: 302, headers: { location: "https://cdn.example/final.png" }, data: Buffer.alloc(0) },
			{ status: 200, headers: { "content-type": "image/png" }, data: Buffer.from("png") },
		];
		const result = await downloadMediaUrl("https://origin.example/start", {
			lookup: async host => {
				lookups.push(host);
				return [{ address: host === "origin.example" ? "203.0.113.10" : "203.0.113.11", family: 4 }];
			},
			request: async (url, address) => {
				requests.push({ host: url.hostname, address });
				return replies.shift()!;
			},
		});

		expect(lookups).toEqual(["origin.example", "cdn.example"]);
		expect(requests).toEqual([
			{ host: "origin.example", address: "203.0.113.10" },
			{ host: "cdn.example", address: "203.0.113.11" },
		]);
		expect(result.finalUrl).toBe("https://cdn.example/final.png");
	});

	test("rejects credentials, non-HTTPS redirects, DNS rebinding, TLS errors, and total timeout", async () => {
		await expect(downloadMediaUrl("https://user:secret@example.test/a")).rejects.toThrow("credentials");
		await expect(
			downloadMediaUrl("https://example.test/a", {
				lookup: async () => [{ address: "203.0.113.10", family: 4 }],
				request: async () => ({
					status: 302,
					headers: { location: "http://example.test/plain" },
					data: Buffer.alloc(0),
				}),
			}),
		).rejects.toThrow("HTTPS");

		let lookupCount = 0;
		await expect(
			downloadMediaUrl("https://example.test/a", {
				lookup: async () => [{ address: ++lookupCount === 1 ? "203.0.113.10" : "127.0.0.1", family: 4 }],
				request: async () => ({
					status: 302,
					headers: { location: "https://example.test/b" },
					data: Buffer.alloc(0),
				}),
			}),
		).rejects.toThrow("prohibited");

		await expect(
			downloadMediaUrl("https://example.test/a", {
				lookup: async () => [{ address: "203.0.113.10", family: 4 }],
				request: async () => {
					throw new Error("certificate verify failed");
				},
			}),
		).rejects.toThrow("certificate verify failed");

		await expect(
			downloadMediaUrl("https://example.test/a", {
				totalTimeoutMs: 5,
				lookup: async () => await new Promise(() => {}),
				request: async () => {
					throw new Error("request must not run after a DNS timeout");
				},
			}),
		).rejects.toThrow("timed out");

		await expect(
			downloadMediaUrl("https://example.test/a", {
				totalTimeoutMs: 5,
				lookup: async () => [{ address: "203.0.113.10", family: 4 }],
				request: async (_url, _address, _options, signal) =>
					await new Promise((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(signal.reason), { once: true });
					}),
			}),
		).rejects.toThrow("timed out");
	});
});
