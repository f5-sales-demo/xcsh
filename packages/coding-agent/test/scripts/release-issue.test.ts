import { describe, expect, it } from "bun:test";
import { ensureReleaseIssue, releasePRBody } from "../../../../scripts/release";

describe("release preparation issue", () => {
	it("reuses only the exact open version issue and keeps other releases separate", async () => {
		const calls: string[][] = [];
		const issue = await ensureReleaseIssue("23.10.16", [], async args => {
			calls.push(args);
			return JSON.stringify([
				{ number: 42, title: "Release preparation v23.10.16" },
				{ number: 43, title: "Release preparation v23.10.160" },
			]);
		});
		expect(issue).toBe(42);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("open");
	});

	it("creates a detailed preparation issue before producing a closing reference", async () => {
		const calls: string[][] = [];
		let body = "";
		const issue = await ensureReleaseIssue("23.10.16", ["fix: restore installed SDK"], async args => {
			calls.push(args);
			if (calls.length === 1) return "[]";
			body = await Bun.file(args[args.indexOf("--body-file") + 1]!).text();
			return "https://github.com/example/project/issues/44\n";
		});
		expect(issue).toBe(44);
		expect(calls[1]?.slice(0, 2)).toEqual(["issue", "create"]);
		expect(body).toContain("fix: restore installed SDK");
		expect(body).toContain("Acceptance Criteria");
		expect(body).toContain("Publication, installed behavior and CE UAT acceptance remain separate");
		expect(releasePRBody("23.10.16", [], issue)).toContain("Closes #44");
	});

	it("reuses its existing issue after a retry instead of creating another", async () => {
		let created = false;
		let creations = 0;
		const run = async (args: string[]) => {
			if (args[1] === "list") {
				return JSON.stringify(created ? [{ number: 44, title: "Release preparation v23.10.16" }] : []);
			}
			created = true;
			creations++;
			return "https://github.com/example/project/issues/44";
		};
		expect(await ensureReleaseIssue("23.10.16", [], run)).toBe(44);
		expect(await ensureReleaseIssue("23.10.16", [], run)).toBe(44);
		expect(creations).toBe(1);
	});

	it("rejects ambiguous exact issues before mutation", async () => {
		let calls = 0;
		await expect(
			ensureReleaseIssue("23.10.16", [], async () => {
				calls++;
				return JSON.stringify([
					{ number: 42, title: "Release preparation v23.10.16" },
					{ number: 43, title: "Release preparation v23.10.16" },
				]);
			}),
		).rejects.toThrow("Ambiguous");
		expect(calls).toBe(1);
	});

	for (const response of ["not json", "{}", "null", '[{"title":"Release preparation v23.10.16","number":"42"}]']) {
		it(`rejects malformed issue discovery ${response}`, async () => {
			await expect(ensureReleaseIssue("23.10.16", [], async () => response)).rejects.toThrow();
		});
	}

	it("preserves issue-service failure without attempting issue creation", async () => {
		let calls = 0;
		await expect(
			ensureReleaseIssue("23.10.16", [], async () => {
				calls++;
				throw new Error("issue service unavailable");
			}),
		).rejects.toThrow("issue service unavailable");
		expect(calls).toBe(1);
	});

	for (const response of [
		"",
		"https://github.com/example/project/pull/44",
		"https://github.com/example/project/issues/0",
	]) {
		it(`rejects malformed issue creation ${response}`, async () => {
			await expect(
				ensureReleaseIssue("23.10.16", [], async args => (args[1] === "list" ? "[]" : response)),
			).rejects.toThrow();
		});
	}

	it("cannot format an unlinked release PR", () => {
		for (const number of [0, -1, NaN, 1.5]) {
			expect(() => releasePRBody("23.10.16", [], number)).toThrow();
		}
	});

	it("rejects an invalid version before contacting GitHub", async () => {
		let calls = 0;
		await expect(
			ensureReleaseIssue("23.10.16 trailing", [], async () => {
				calls++;
				return "[]";
			}),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
});
