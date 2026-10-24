import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type KiroCredentials, normalizeKiroCredentials } from "./kiro-credentials";

export interface KiroSource {
	kind: "cli" | "desktop";
	path: string;
	credentials?: KiroCredentials;
	reason?: string;
}
export async function readKiroSources(home = homedir(), platform = process.platform): Promise<KiroSource[]> {
	const sources: KiroSource[] = [];
	const path =
		platform === "darwin"
			? join(home, "Library/Application Support/kiro-cli/data.sqlite3")
			: join(home, ".local/share/kiro-cli/data.sqlite3");
	try {
		const db = new Database(path, { readonly: true, create: false });
		try {
			const rows = db.query<{ key: string; value: string }, []>("SELECT key,value FROM auth_kv").all();
			const token = rows.find(r => r.key === "kirocli:odic:token");
			const registration = rows.find(r => r.key === "kirocli:odic:device-registration");
			if (token) {
				const credentials = normalizeKiroCredentials(
					JSON.parse(token.value),
					registration ? JSON.parse(registration.value) : {},
				);
				sources.push({
					kind: "cli",
					path,
					...(credentials
						? { credentials: { ...credentials, source: { kind: "cli", path } } }
						: { reason: "Incomplete, unsupported or expired CLI registration. Choose fresh login." }),
				});
			}
		} finally {
			db.close();
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (await Bun.file(path).exists()))
			sources.push({ kind: "cli", path, reason: "Cannot read CLI credentials. Choose fresh login." });
	}
	const cache = join(home, ".aws/sso/cache");
	const desktopPath = join(cache, "kiro-auth-token.json");
	try {
		let token = JSON.parse(await readFile(desktopPath, "utf8"));
		let registration = token;
		if (token.authMethod === "IdC" && /^[a-f0-9]{40}$/.test(token.clientIdHash ?? "")) {
			registration = JSON.parse(await readFile(join(cache, `${token.clientIdHash}.json`), "utf8"));
			const startUrl = token.provider === "BuilderId" ? "https://view.awsapps.com/start" : token.startUrl;
			if (startUrl && createHash("sha1").update(JSON.stringify({ startUrl })).digest("hex") !== token.clientIdHash)
				throw new Error("Desktop registration mismatch");
			token = { ...token, startUrl: startUrl ?? "", startUrlHash: token.clientIdHash };
			registration = { ...registration, registrationExpiresAt: registration.expiresAt };
		}
		if (!token.clientSecret && token.clientId) {
			for (const file of await readdir(cache)) {
				if (!file.endsWith(".json")) continue;
				try {
					const candidate = JSON.parse(await readFile(join(cache, file), "utf8"));
					if (candidate.clientId === token.clientId && candidate.clientSecret) {
						registration = candidate;
						break;
					}
				} catch {
					/* Unrelated AWS cache entries are not credential candidates. */
				}
			}
		}
		const credentials = normalizeKiroCredentials(token, registration);
		sources.push({
			kind: "desktop",
			path: desktopPath,
			...(credentials
				? { credentials: { ...credentials, source: { kind: "desktop", path: desktopPath } } }
				: { reason: "Desktop account is unsupported or incomplete. Choose AWS Builder ID or Company SSO." }),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			sources.push({
				kind: "desktop",
				path: desktopPath,
				reason: "Cannot read Desktop credentials. Choose fresh login.",
			});
	}
	return sources;
}
