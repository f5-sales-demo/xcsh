import { describe, expect, it } from "bun:test";
import { resolvePublishedNpmVersion } from "../../../../scripts/resolve-published-npm-version";

describe("published ARC package selection", () => {
	it("resolves latest independently of an unpublished source version", async () => {
		const calls: string[] = [];
		expect(
			await resolvePublishedNpmVersion("", async input => {
				calls.push(String(input));
				return Response.json({ version: "22.4.2" });
			}),
		).toBe("22.4.2");
		expect(calls).toEqual(["https://registry.npmjs.org/@f5-sales-demo%2Fxcsh/latest"]);
	});
	it("validates explicit versions and fails clearly for unavailable selections", async () => {
		expect(await resolvePublishedNpmVersion("v22.4.2", async () => Response.json({ version: "22.4.2" }))).toBe(
			"22.4.2",
		);
		await expect(
			resolvePublishedNpmVersion("22.4.99", async () => new Response(null, { status: 404 })),
		).rejects.toThrow("not published");
		await expect(
			resolvePublishedNpmVersion("22.4.2", async () => Response.json({ version: "22.4.1" })),
		).rejects.toThrow("does not match");
		await expect(
			resolvePublishedNpmVersion("latest", async () => Response.json({ version: "broken" })),
		).rejects.toThrow("invalid version");
		await expect(
			resolvePublishedNpmVersion("22.4.2; command", async () => {
				throw new Error("must not request");
			}),
		).rejects.toThrow("Select latest or an exact");
	});
});
