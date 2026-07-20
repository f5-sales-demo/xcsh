/**
 * Persistent gateway-config store for the Office add-in.
 *
 * Backs the {@link GatewayConfigStore} seam with the task pane's `localStorage`,
 * so the gateway connection (base URL + token + model) survives pane reloads —
 * matching Claude for Office's persisted config. The concrete `Storage` is
 * injected so the store is unit-testable with no DOM.
 *
 * Fault-tolerant by design: this add-in runs in a WebKit/Safari Office task-pane
 * WebView where `localStorage` can be **partitioned or blocked** and every access
 * (even reading the global, or `getItem`) can throw `SecurityError`. So the store
 * degrades gracefully — `load()` returns `null`, and `save()`/`clear()` are
 * best-effort no-ops — rather than crashing the pane. When storage is
 * unavailable the config simply isn't persisted across reloads; the session
 * still works (GatewayGate holds the config in React state).
 *
 * Security note: the token lives in the pane's own storage (this is an internal
 * SE tool). Values are re-normalized on load via {@link normalizeGatewayConfig},
 * so a tampered/partial entry is treated as "no config" rather than trusted
 * blindly.
 */
import { type GatewayConfig, type GatewayConfigStore, normalizeGatewayConfig } from "../core";

/** localStorage key under which the gateway config is persisted. */
export const GATEWAY_STORE_KEY = "xcsh-office-pane.gateway";

/** Resolve the page-global `localStorage`, or `null` if it's absent/blocked. */
function safeLocalStorage(): Storage | null {
	try {
		return (globalThis as { localStorage?: Storage }).localStorage ?? null;
	} catch {
		// WebKit partitioned/blocked storage throws SecurityError on access.
		return null;
	}
}

/**
 * Create a {@link GatewayConfigStore} backed by a `Storage` (defaults to the
 * page-global `localStorage`, resolved safely). Every method degrades to a
 * no-op / `null` when storage is unavailable or throws — it never propagates a
 * storage exception to the caller.
 */
export function createLocalStorageGatewayStore(
	storage: Storage | null = safeLocalStorage(),
	key: string = GATEWAY_STORE_KEY,
): GatewayConfigStore {
	return {
		load(): GatewayConfig | null {
			if (!storage) return null;
			try {
				const raw = storage.getItem(key);
				if (!raw) return null;
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				// Re-normalize so a partial/tampered entry can't yield a bad config.
				return normalizeGatewayConfig({
					baseUrl: String(parsed.baseUrl ?? ""),
					token: String(parsed.token ?? ""),
					model: typeof parsed.model === "string" ? parsed.model : undefined,
				});
			} catch {
				// Unparseable, invalid, or a storage read error → treat as no config.
				return null;
			}
		},
		save(config: GatewayConfig): void {
			if (!storage) return;
			try {
				storage.setItem(key, JSON.stringify(config));
			} catch {
				// Best-effort: a blocked/full store shouldn't break the session.
			}
		},
		clear(): void {
			if (!storage) return;
			try {
				storage.removeItem(key);
			} catch {
				// Best-effort.
			}
		},
	};
}
