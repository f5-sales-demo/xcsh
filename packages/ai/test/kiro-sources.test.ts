import { Database } from "bun:sqlite";
import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKiroSources } from "../src/utils/oauth/kiro-sources";

it("reads Desktop and CLI independently without altering either source", async () => {
	const home = await mkdtemp(join(tmpdir(), "kiro-sources-"));
	const cache = join(home, ".aws/sso/cache");
	const cliDir = join(home, "Library/Application Support/kiro-cli");
	try {
		await mkdir(cache, { recursive: true });
		await mkdir(cliDir, { recursive: true });
		const token = {
			accessToken: "desktop-fake",
			refreshToken: "desktop-refresh",
			region: "us-east-1",
			startUrl: "https://view.awsapps.com/start",
			expiresAt: "2030-01-01",
			clientId: "desktop-client",
		};
		const path = join(cache, "kiro-auth-token.json");
		await writeFile(path, JSON.stringify(token));
		await writeFile(
			join(cache, "desktop.json"),
			JSON.stringify({
				clientId: "desktop-client",
				clientSecret: "desktop-secret",
				region: "us-east-1",
				client_secret_expires_at: 2200000000,
			}),
		);
		const db = new Database(join(cliDir, "data.sqlite3"));
		db.exec("CREATE TABLE auth_kv(key TEXT PRIMARY KEY,value TEXT)");
		const insert = db.query("INSERT INTO auth_kv VALUES (?,?)");
		insert.run(
			"kirocli:odic:token",
			JSON.stringify({
				access_token: "cli-fake",
				refresh_token: "cli-refresh",
				region: "us-east-1",
				start_url: "https://view.awsapps.com/start",
				expires_at: "2030-01-01",
			}),
		);
		insert.run(
			"kirocli:odic:device-registration",
			JSON.stringify({
				client_id: "cli-client",
				client_secret: "cli-secret",
				region: "us-east-1",
				client_secret_expires_at: 2200000000,
			}),
		);
		db.close();
		const before = await readFile(path, "utf8");
		const sources = await readKiroSources(home, "darwin");
		expect(sources).toHaveLength(2);
		expect(sources.find(s => s.kind === "desktop")?.credentials?.access).toBe("desktop-fake");
		expect(sources.find(s => s.kind === "cli")?.credentials?.access).toBe("cli-fake");
		expect(sources[0].credentials?.accountId).not.toBe(sources[1].credentials?.accountId);
		expect(await readFile(path, "utf8")).toBe(before);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
it("reports unsupported Desktop social credentials with a fresh login option", async () => {
	const home = await mkdtemp(join(tmpdir(), "kiro-social-"));
	try {
		const cache = join(home, ".aws/sso/cache");
		await mkdir(cache, { recursive: true });
		await writeFile(
			join(cache, "kiro-auth-token.json"),
			JSON.stringify({ authMethod: "social", provider: "Google", accessToken: "fake" }),
		);
		const s = await readKiroSources(home, "linux");
		expect(s).toHaveLength(1);
		expect(s[0].credentials).toBeUndefined();
		expect(s[0].reason).toContain("AWS Builder ID");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
it("imports Desktop 1.4.26 IdC Builder and corporate tokens by exact clientIdHash", async () => {
	const home = await mkdtemp(join(tmpdir(), "kiro-desktop-idc-"));
	try {
		const cache = join(home, ".aws/sso/cache");
		await mkdir(cache, { recursive: true });
		const { createHash } = await import("node:crypto");
		for (const provider of ["BuilderId", "Enterprise"]) {
			const startUrl =
				provider === "BuilderId" ? "https://view.awsapps.com/start" : "https://company.awsapps.com/start";
			const hash = createHash("sha1").update(JSON.stringify({ startUrl })).digest("hex");
			const token = {
				accessToken: "desktop-fake",
				refreshToken: "desktop-refresh",
				region: "us-east-1",
				expiresAt: "2030-01-01",
				clientIdHash: hash,
				authMethod: "IdC",
				provider,
				...(provider === "Enterprise" ? { startUrl } : {}),
			};
			await writeFile(join(cache, "kiro-auth-token.json"), JSON.stringify(token));
			await writeFile(
				join(cache, `${hash}.json`),
				JSON.stringify({ clientId: "desktop-client", clientSecret: "desktop-secret", expiresAt: "2031-01-01" }),
			);
			const sources = await readKiroSources(home, "darwin");
			expect(sources[0].credentials?.authMethod).toBe(provider === "BuilderId" ? "builder-id" : "idc");
			expect(sources[0].credentials?.startUrl).toBe(startUrl);
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
