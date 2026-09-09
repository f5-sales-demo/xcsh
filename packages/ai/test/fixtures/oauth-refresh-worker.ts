import { AuthStorage } from "../../src/auth-storage";
import { registerOAuthProvider } from "../../src/utils/oauth";

const [dbPath, endpoint] = process.argv.slice(2);
if (!dbPath || !endpoint) throw new Error("usage: oauth-refresh-worker.ts <db-path> <endpoint>");

const storage = await AuthStorage.create(dbPath);
try {
	await storage.reload();
	registerOAuthProvider({
		id: "synthetic-subprocess",
		name: "Synthetic subprocess OAuth",
		sourceId: `oauth-refresh-worker-${process.pid}`,
		login: async () => "unused",
		refreshToken: async (credential, signal) => {
			const response = await fetch(`${endpoint}/token`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refresh: credential.refresh }),
				signal,
			});
			const payload = (await response.json()) as {
				access?: string;
				refresh?: string;
				expires?: number;
				error?: string;
			};
			if (!response.ok) throw new Error(`OAuth refresh failed: ${payload.error ?? `HTTP ${response.status}`}`);
			return { access: payload.access!, refresh: payload.refresh!, expires: payload.expires! };
		},
	});

	await fetch(`${endpoint}/ready`, { method: "POST" });
	const access = await storage.getApiKey("synthetic-subprocess", `worker-${process.pid}`);
	process.stdout.write(JSON.stringify({ access }));
} finally {
	storage.close();
}
