import { expect } from "bun:test";
import { resolveKind } from "../../../src/resource-management/kind-resolver";
import { parseManifests } from "../../../src/resource-management/manifest-parser";
import { ResourceClient } from "../../../src/resource-management/resource-client";
import type { OperationResult, ResolvedKind, ResourceManifest } from "../../../src/resource-management/types";

export const LIVE = !!process.env.LIVE_API_TEST;
export const API_URL = process.env.F5XC_API_URL ?? "";
export const API_TOKEN = process.env.F5XC_API_TOKEN ?? "";
export const NAMESPACE = "default";

const counter = { value: 0 };

export function uniqueName(prefix: string): string {
	counter.value++;
	return `xcsh-test-${prefix}-${process.pid}-${counter.value}`;
}

export function makeClient(): ResourceClient {
	return new ResourceClient({
		apiUrl: API_URL,
		apiToken: API_TOKEN,
		namespace: NAMESPACE,
	});
}

export function makeClientWithToken(token: string): ResourceClient {
	return new ResourceClient({
		apiUrl: API_URL,
		apiToken: token,
		namespace: NAMESPACE,
	});
}

export function makeClientWithUrl(url: string): ResourceClient {
	return new ResourceClient({
		apiUrl: url,
		apiToken: API_TOKEN,
		namespace: NAMESPACE,
	});
}

export function buildManifest(
	kind: string,
	name: string,
	spec: Record<string, unknown> = {},
	metaOverrides: Record<string, unknown> = {},
): ResourceManifest {
	const raw = {
		kind,
		metadata: { name, namespace: NAMESPACE, ...metaOverrides },
		spec,
	};
	return parseManifests([raw], "integration-test")[0];
}

export function assertCreated(result: OperationResult): void {
	expect(result.status).toBe("created");
	if (result.status === "created") {
		expect(result.durationMs).toBeGreaterThan(0);
		expect(result.resource).toBeDefined();
	}
}

export function assertUpdated(result: OperationResult): void {
	expect(result.status).toBe("updated");
	if (result.status === "updated") {
		expect(result.durationMs).toBeGreaterThan(0);
		expect(result.diff.hasDifferences).toBe(true);
	}
}

export function assertUnchanged(result: OperationResult): void {
	expect(result.status).toBe("unchanged");
}

export function assertDeleted(result: OperationResult): void {
	expect(result.status).toBe("deleted");
	if (result.status === "deleted") {
		expect(result.durationMs).toBeGreaterThan(0);
	}
}

export function assertDryRun(result: OperationResult, action: "create" | "update"): void {
	expect(result.status).toBe("dry-run");
	if (result.status === "dry-run") {
		expect(result.action).toBe(action);
	}
}

export class CleanupRegistry {
	#entries: Array<{ kind: string; name: string; resolved: ResolvedKind }> = [];
	#client: ResourceClient;

	constructor(client: ResourceClient) {
		this.#client = client;
	}

	track(kind: string, name: string): void {
		const resolved = resolveKind(kind);
		this.#entries.push({ kind, name, resolved });
	}

	async cleanupAll(): Promise<void> {
		for (let i = this.#entries.length - 1; i >= 0; i--) {
			const entry = this.#entries[i];
			try {
				await this.#client.delete(entry.kind, entry.name, entry.resolved, NAMESPACE);
			} catch {
				// Best-effort cleanup
			}
		}
		this.#entries = [];
	}
}

let _cachedTenant: string | undefined;

export async function getTenant(): Promise<string> {
	if (_cachedTenant) return _cachedTenant;
	if (!API_URL || !API_TOKEN) return "unknown";
	const res = await fetch(`${API_URL}/api/web/namespaces/default`, {
		headers: { Authorization: `APIToken ${API_TOKEN}`, Accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	const data = (await res.json()) as Record<string, unknown>;
	const sysMeta = data.system_metadata as Record<string, unknown> | undefined;
	_cachedTenant = (sysMeta?.tenant as string) ?? "unknown";
	return _cachedTenant;
}

export { parseManifests, resolveKind };
