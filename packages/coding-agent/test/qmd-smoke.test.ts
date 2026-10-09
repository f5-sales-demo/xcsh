import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DocumentationRepository } from "../src/internal-urls/documentation-resolve";
import {
	DOCUMENTATION_TOOLS_DISABLED_MESSAGE,
	parseQmdSmokeOutput,
	QMD_SMOKE_SUCCESS,
	runQmdSmoke,
} from "../src/qmd-smoke";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("QMD compiled-binary smoke", () => {
	it("emits an ordered offline documentation trace and opens the agent database afterward", async () => {
		const home = await mkdtemp(path.join(os.tmpdir(), "xcsh-qmd-smoke-"));
		tempDirectories.push(home);
		const agentDatabasePath = path.join(home, ".xcsh", "agent", "agent.db");
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
		).toString("base64");
		const documentationRepository: DocumentationRepository = {
			provenance: {
				releaseTag: "content-test",
				sourceCommit: "1".repeat(40),
				archiveSha256: "2".repeat(64),
				indexSha256: "3".repeat(64),
				fingerprint: "4".repeat(64),
				documentCount: 3,
				assetCount: 1,
			},
			async search(query) {
				if (query === "configure web application firewall") {
					return [
						{
							title: "Create Web Application Firewall",
							source: "docs-cloud-f5-com",
							originalUrl: "https://example.invalid/waf",
							stablePath: "web-app-and-api-protection/how-to/app-security/application-firewall",
							snippet: "WAF",
							score: 9,
						},
					];
				}
				if (query === "what is client side defense") {
					return [
						{
							title: "F5 Distributed Cloud Client-Side Defense",
							source: "www-f5-com",
							originalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
							stablePath: "products/distributed-cloud-services/client-side-defense",
							snippet: "Client-Side Defense",
							score: 10,
						},
					];
				}
				if (query === "set up DNS load balancer") {
					return [
						{
							title: "Set Up DNS Load Balancer",
							source: "docs-cloud-f5-com",
							originalUrl: "https://example.invalid/dns",
							stablePath: "dns-management/how-to/configure-dns-load-balancer",
							snippet: "DNS",
							score: 8,
						},
					];
				}
				return [];
			},
			async readDocument(source, stablePath) {
				if (source === "www-f5-com" && stablePath === "products/distributed-cloud-services/client-side-defense") {
					return {
						markdown: "# F5 Client-Side Defense",
						title: "F5 Distributed Cloud Client-Side Defense",
						originalUrl: "https://www.f5.com/products/distributed-cloud-services/client-side-defense",
					};
				}
				if (source !== "docs-cloud-f5-com") return null;
				if (stablePath === "web-app-and-api-protection/how-to/app-security/application-firewall") {
					return {
						markdown: "# Create Web Application Firewall",
						title: "Create Web Application Firewall",
						originalUrl: "https://example.invalid/waf",
					};
				}
				if (stablePath === "dns-management/how-to/configure-dns-load-balancer") {
					return {
						markdown: "# Set Up DNS Load Balancer",
						title: "Set Up DNS Load Balancer",
						originalUrl: "https://example.invalid/dns",
					};
				}
				return null;
			},
			async readAsset(source, stablePath, filename) {
				return source === "docs-cloud-f5-com" && stablePath === "administration" && filename.endsWith(".svg")
					? { data: svg, mimeType: "image/svg+xml" }
					: null;
			},
		};

		let fetchCalls = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => {
			fetchCalls++;
			throw new Error("QMD smoke attempted a live fetch");
		}) as unknown as typeof fetch;
		let output: string;
		try {
			output = await runQmdSmoke({
				cacheRoot: path.join(home, ".xcsh", "cache", "qmd-api-catalog"),
				agentDatabasePath,
				documentationRepository,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(fetchCalls).toBe(0);
		const trace = parseQmdSmokeOutput(output);
		expect(output.endsWith(QMD_SMOKE_SUCCESS)).toBe(true);
		expect(trace.map(entry => entry.event)).toEqual([
			"api-catalog-rank",
			"documentation-search",
			"documentation-read",
			"documentation-marketing-search",
			"documentation-marketing-read",
			"documentation-search",
			"documentation-read",
			"documentation-follow-up-read",
			"documentation-missing",
			"documentation-tools-disabled",
			"documentation-svg-convert",
			"sqlite-open",
		]);
		expect(
			trace.every(entry => entry.resource === undefined || entry.resource.startsWith("xcsh://documentation")),
		).toBe(true);
		expect(trace[1]).toMatchObject({ title: "Create Web Application Firewall", source: "docs-cloud-f5-com" });
		expect(trace[3]).toMatchObject({
			resource: "xcsh://documentation/?search=what%20is%20client%20side%20defense&source=www-f5-com&limit=1",
			title: "F5 Distributed Cloud Client-Side Defense",
			source: "www-f5-com",
		});
		expect(trace[7]).toMatchObject({
			resource: "xcsh://documentation/docs-cloud-f5-com/dns-management/how-to/configure-dns-load-balancer/index.md",
			title: "Set Up DNS Load Balancer",
			source: "docs-cloud-f5-com",
		});
		expect(trace[9]).toMatchObject({
			event: "documentation-tools-disabled",
			outcome: DOCUMENTATION_TOOLS_DISABLED_MESSAGE,
		});
		expect(() => parseQmdSmokeOutput(output.replace('"sequence":8', '"sequence":9'))).toThrow("out of order");

		const database = new Database(agentDatabasePath, { readonly: true });
		try {
			const settings = database
				.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
				.get() as { name?: string } | null;
			expect(settings?.name).toBe("settings");
		} finally {
			database.close();
		}
	}, 30_000);
});
