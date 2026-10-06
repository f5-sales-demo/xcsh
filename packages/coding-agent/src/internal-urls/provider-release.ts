import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { untilAborted, withTimeout } from "@f5-sales-demo/pi-utils";
import type { RegistryFetch } from "./registry-resolve";
import { EMBEDDED_PROVIDER_VERSION } from "./terraform-provider-pin.generated";

export { EMBEDDED_PROVIDER_VERSION };
export const XCSH_REGISTRY_SOURCE_URL = "https://registry.terraform.io/v1/providers/f5-sales-demo/xcsh/versions";
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface ProviderReleaseMetadata {
	readonly latestVersion: string;
	readonly embeddedDocumentationVersion: string;
	/** Time of the last successful Registry verification, not the fallback attempt. */
	readonly lookedUpAt: string | null;
	readonly attemptedAt: string;
	readonly sourceUrl: string;
	readonly freshness: "fresh" | "cached" | "embedded";
	readonly lookupFailure: string | null;
}

export function compareStableVersions(left: string, right: string): number {
	const a = STABLE.exec(left);
	const b = STABLE.exec(right);
	if (!a || !b) throw new Error("Expected stable semantic versions");
	for (let i = 1; i <= 3; i++) {
		const x = BigInt(a[i]);
		const y = BigInt(b[i]);
		if (x !== y) return x > y ? 1 : -1;
	}
	return 0;
}

export function selectLatestStable(value: unknown): string {
	if (!value || typeof value !== "object" || !Array.isArray((value as { versions?: unknown }).versions)) {
		throw new Error("Registry response omitted versions");
	}
	const entries = (value as { versions: unknown[] }).versions;
	const stable: string[] = [];
	for (const entry of entries) {
		const version = entry && typeof entry === "object" ? (entry as { version?: unknown }).version : undefined;
		if (typeof version !== "string" || !SEMVER.test(version)) throw new Error("Registry returned malformed versions");
		if (STABLE.test(version)) stable.push(version);
	}
	if (!stable.length) throw new Error("Registry returned no stable provider releases");
	return stable.sort(compareStableVersions).at(-1)!;
}

interface VerifiedRelease {
	readonly latestVersion: string;
	readonly lookedUpAt: string;
	readonly sourceUrl: string;
}

interface LookupDeps {
	readonly embeddedVersion: string;
	readonly fetch?: RegistryFetch;
	readonly sourceUrl?: string;
	readonly timeoutMs?: number;
	readonly cachePath?: string | null;
}

interface Flight {
	readonly controller: AbortController;
	promise: Promise<ProviderReleaseMetadata>;
	waiters: number;
}

/** One shared request per overlapping turn; completed turns always refresh. */
export class ProviderReleaseLookup {
	readonly #deps: LookupDeps;
	#verified: VerifiedRelease | undefined;
	#lastResult: ProviderReleaseMetadata | undefined;
	#flight: Flight | undefined;
	#cacheLoaded = false;

	constructor(deps: LookupDeps) {
		if (!STABLE.test(deps.embeddedVersion)) throw new Error("Invalid embedded provider version");
		this.#deps = deps;
	}

	latest(signal?: AbortSignal): Promise<ProviderReleaseMetadata> {
		return this.#lastResult ? untilAborted(signal, Promise.resolve(this.#lastResult)) : this.refresh(signal);
	}

	async refresh(signal?: AbortSignal): Promise<ProviderReleaseMetadata> {
		if (signal?.aborted) signal.throwIfAborted();
		let flight = this.#flight;
		if (!flight) {
			flight = { controller: new AbortController(), promise: undefined!, waiters: 0 };
			this.#flight = flight;
			flight.promise = this.#lookup(flight.controller.signal).finally(() => {
				if (this.#flight === flight) this.#flight = undefined;
			});
		}
		flight.waiters++;
		try {
			return await untilAborted(signal, flight.promise);
		} finally {
			flight.waiters--;
			if (!flight.waiters && this.#flight === flight) {
				this.#flight = undefined;
				flight.controller.abort();
			}
		}
	}

	async #lookup(signal: AbortSignal): Promise<ProviderReleaseMetadata> {
		const sourceUrl = this.#deps.sourceUrl ?? XCSH_REGISTRY_SOURCE_URL;
		const attemptedAt = new Date().toISOString();
		const timeoutMs = this.#deps.timeoutMs ?? 10_000;
		const controller = new AbortController();
		const requestSignal = AbortSignal.any([signal, controller.signal]);
		const timedOut = `Registry lookup timed out after ${timeoutMs} ms`;
		const timer = setTimeout(() => controller.abort(new Error(timedOut)), timeoutMs);
		let lookupFailure: string | null = null;
		try {
			const verified = await withTimeout(
				(async () => {
					const response = await (this.#deps.fetch ?? globalThis.fetch)(sourceUrl, {
						headers: { Accept: "application/json" },
						signal: requestSignal,
					});
					if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
					return {
						latestVersion: selectLatestStable(await response.json()),
						lookedUpAt: new Date().toISOString(),
						sourceUrl,
					};
				})(),
				timeoutMs,
				timedOut,
				requestSignal,
			);
			signal.throwIfAborted();
			this.#verified = verified;
			if (this.#deps.cachePath) {
				const temporary = `${this.#deps.cachePath}.${crypto.randomUUID()}.tmp`;
				try {
					await mkdir(path.dirname(temporary), { recursive: true, mode: 0o700 });
					await writeFile(temporary, JSON.stringify(verified), { mode: 0o600 });
					await rename(temporary, this.#deps.cachePath);
				} catch {
					// A read-only cache must not invalidate a successful Registry lookup.
					await rm(temporary, { force: true }).catch(() => undefined);
				}
			}
		} catch (error) {
			signal.throwIfAborted();
			lookupFailure = error instanceof Error ? error.message : String(error);
			if (!this.#cacheLoaded && this.#deps.cachePath && !this.#verified) {
				this.#cacheLoaded = true;
				try {
					const value = JSON.parse(await readFile(this.#deps.cachePath, "utf8")) as Partial<VerifiedRelease>;
					if (
						typeof value.latestVersion === "string" &&
						STABLE.test(value.latestVersion) &&
						value.sourceUrl === sourceUrl &&
						typeof value.lookedUpAt === "string" &&
						Number.isFinite(Date.parse(value.lookedUpAt)) &&
						Date.parse(value.lookedUpAt) <= Date.now()
					) {
						this.#verified = value as VerifiedRelease;
					}
				} catch {
					/* Missing or malformed caches provide no verified fallback. */
				}
			}
		} finally {
			clearTimeout(timer);
			controller.abort();
		}
		signal.throwIfAborted();
		const result: ProviderReleaseMetadata = {
			latestVersion: this.#verified?.latestVersion ?? this.#deps.embeddedVersion,
			embeddedDocumentationVersion: this.#deps.embeddedVersion,
			lookedUpAt: this.#verified?.lookedUpAt ?? null,
			attemptedAt,
			sourceUrl,
			freshness: lookupFailure ? (this.#verified ? "cached" : "embedded") : "fresh",
			lookupFailure,
		};
		this.#lastResult = result;
		return result;
	}
}

let defaultLookup: ProviderReleaseLookup | undefined;
export function getProviderReleaseLookup(): ProviderReleaseLookup {
	if (!defaultLookup) {
		defaultLookup = new ProviderReleaseLookup({
			embeddedVersion: EMBEDDED_PROVIDER_VERSION,
			cachePath: path.join(os.homedir(), ".xcsh", "cache", "provider-release", "latest.json"),
		});
	}
	return defaultLookup;
}
