import { expect, test } from "bun:test";
import { fetchLatestGitHubRelease, fetchLatestNpmVersion, type VersionFetch } from "./check-spoofed-versions";

test("GitHub release lookup uses the read token and a bounded request", async () => {
	const fetcher = (async (url, init) => {
		expect(String(url)).toBe("https://api.github.com/repos/fixture/repo/releases/latest");
		expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		return new Response(JSON.stringify({ tag_name: "v1.2.3" }));
	}) as VersionFetch;
	expect(await fetchLatestGitHubRelease("fixture/repo", tag => tag.slice(1), fetcher, "fixture-token")).toBe("1.2.3");
});

test("anonymous lookup is explicit and npm never receives the GitHub token", async () => {
	const fetcher = (async (_url, init) => {
		expect(new Headers(init?.headers).has("Authorization")).toBe(false);
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		return new Response(JSON.stringify({ tag_name: "v1.2.3", version: "1.2.3" }));
	}) as VersionFetch;
	expect(await fetchLatestGitHubRelease("fixture/repo", tag => tag.slice(1), fetcher, "")).toBe("1.2.3");
	expect(await fetchLatestNpmVersion("fixture-package", fetcher)).toBe("1.2.3");
});

test("HTTP failure preserves status without exposing response bodies or credentials", async () => {
	const diagnostics: string[] = [];
	const previous = console.error;
	console.error = value => {
		diagnostics.push(String(value));
	};
	try {
		const fetcher = (async () => new Response("fixture-private-body", { status: 429 })) as VersionFetch;
		expect(await fetchLatestGitHubRelease("fixture/repo", tag => tag, fetcher, "fixture-token")).toBeNull();
		expect(await fetchLatestNpmVersion("fixture-package", fetcher)).toBeNull();
		expect(diagnostics).toEqual(["GitHub release lookup failed (HTTP 429)", "npm version lookup failed (HTTP 429)"]);
		expect(diagnostics.join(" ")).not.toContain("fixture-token");
		expect(diagnostics.join(" ")).not.toContain("fixture-private-body");
	} finally {
		console.error = previous;
	}
});
