/** Native port of the pinned Codex clients.rs contract. See NOTICE.md and LICENSE. */
import type { SubscriptionAuth } from "./enrollment";
export interface ClientManagementDependencies {
	authenticate(previous?: SubscriptionAuth): Promise<SubscriptionAuth>;
	send?(request: Request): Promise<Response>;
}
export interface ClientListOptions {
	cursor?: string;
	limit?: number;
	order?: "asc" | "desc";
}
export interface RemoteClient {
	clientId: string;
	displayName: string | null;
	deviceType: string | null;
	platform: string | null;
	osVersion: string | null;
	deviceModel: string | null;
	appVersion: string | null;
	lastSeenAt: number | null;
}
function identity(value: string): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > 1024 ||
		[".", ".."].includes(value) ||
		/[\x00-\x1f]/.test(value)
	)
		throw new Error("Invalid remote client identity");
	return encodeURIComponent(value);
}
function clientsUrl(environmentId: string): URL {
	return new URL(
		`https://chatgpt.com/backend-api/wham/remote/control/environments/${identity(environmentId)}/clients`,
	);
}
async function request(url: URL, method: "GET" | "DELETE", deps: ClientManagementDependencies): Promise<Response> {
	let auth: SubscriptionAuth | undefined;
	const signal = AbortSignal.timeout(30_000);
	for (let attempt = 0; attempt < 2; attempt++) {
		let next: SubscriptionAuth;
		try {
			next = await deps.authenticate(auth);
		} catch {
			throw new Error("Remote client subscription authentication unavailable");
		}
		if (!next.accessToken || !next.accountId || (auth && auth.accountId !== next.accountId))
			throw new Error("Remote client subscription account changed");
		auth = next;
		let response: Response;
		try {
			response = await (deps.send ?? fetch)(
				new Request(url.toString(), {
					method,
					redirect: "error",
					signal,
					headers: {
						authorization: `Bearer ${auth.accessToken}`,
						"chatgpt-account-id": auth.accountId,
						originator: "xcsh",
					},
				}),
			);
		} catch {
			throw new Error("Remote client management transport failed");
		}
		if (response.ok) return response;
		await response.body?.cancel().catch(() => {});
		if (response.status === 401 && attempt === 0) continue;
		throw new Error(`Remote client management rejected: HTTP ${response.status}`);
	}
	throw new Error("Remote client management failed");
}
async function readList(response: Response): Promise<{ data: RemoteClient[]; nextCursor: string | null }> {
	try {
		const reader = response.body?.getReader();
		if (!reader) throw new Error();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 1_048_576) throw new Error();
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (
			!Array.isArray(body.items) ||
			body.items.length > 100 ||
			(body.cursor != null && (typeof body.cursor !== "string" || body.cursor.length > 2048))
		)
			throw new Error();
		const text = (value: unknown): string | null => {
			if (value == null) return null;
			if (typeof value !== "string" || value.length > 1024) throw new Error();
			return value;
		};
		const data = body.items.map((item: Record<string, unknown>): RemoteClient => {
			if (!item || typeof item !== "object" || typeof item.client_id !== "string") throw new Error();
			identity(item.client_id);
			const seen = text(item.last_seen_at);
			const timestamp = seen == null ? null : Date.parse(seen);
			if (timestamp != null && !Number.isFinite(timestamp)) throw new Error();
			return {
				clientId: item.client_id,
				displayName: text(item.display_name),
				deviceType: text(item.device_type),
				platform: text(item.platform),
				osVersion: text(item.os_version),
				deviceModel: text(item.device_model),
				appVersion: text(item.app_version),
				lastSeenAt: timestamp == null ? null : Math.floor(timestamp / 1000),
			};
		});
		return { data, nextCursor: body.cursor ?? null };
	} catch {
		throw new Error("Invalid remote client response");
	}
}
export async function listRemoteClients(
	environmentId: string,
	options: ClientListOptions,
	deps: ClientManagementDependencies,
) {
	const url = clientsUrl(environmentId);
	if (options.limit != null && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
		throw new Error("Remote client list limit must be between 1 and 100");
	if (options.cursor != null && (typeof options.cursor !== "string" || options.cursor.length > 2048))
		throw new Error("Invalid remote client cursor");
	if (options.order != null && !["asc", "desc"].includes(options.order))
		throw new Error("Invalid remote client order");
	if (options.limit != null) url.searchParams.set("limit", String(options.limit));
	if (options.cursor != null) url.searchParams.set("cursor", options.cursor);
	if (options.order != null) url.searchParams.set("order", options.order);
	return readList(await request(url, "GET", deps));
}
export async function revokeRemoteClient(
	environmentId: string,
	clientId: string,
	deps: ClientManagementDependencies,
): Promise<Record<string, never>> {
	const url = clientsUrl(environmentId);
	url.pathname += `/${identity(clientId)}`;
	const response = await request(url, "DELETE", deps);
	await response.body?.cancel().catch(() => {});
	return {};
}
