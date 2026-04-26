// biome-ignore lint/correctness/noUnusedImports: used in Task 2 (fetchWithRetry logging)
import { logger } from "@f5xc-salesdemos/pi-utils";

export type ApiErrorKind = "auth" | "network" | "server";

export class F5XCApiError extends Error {
	constructor(
		message: string,
		readonly kind: ApiErrorKind,
		readonly status?: number,
	) {
		super(message);
		this.name = "F5XCApiError";
	}
}

export interface F5XCNamespace {
	name: string;
}

export interface F5XCNamespaceStatus {
	name: string;
	phase: string;
}

export interface F5XCObject {
	name: string;
	namespace: string;
	kind: string;
}

export interface F5XCApiClientOptions {
	apiUrl: string;
	apiToken: string;
	timeoutMs?: number;
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

export class F5XCApiClient {
	#apiUrl: string;
	#apiToken: string;
	#timeoutMs: number;
	#maxRetries: number;
	#baseDelayMs: number;
	#maxDelayMs: number;

	constructor(opts: F5XCApiClientOptions) {
		this.#apiUrl = opts.apiUrl.replace(/\/+$/, "");
		this.#apiToken = opts.apiToken;
		this.#timeoutMs = opts.timeoutMs ?? 10_000;
		this.#maxRetries = opts.maxRetries ?? 3;
		this.#baseDelayMs = opts.baseDelayMs ?? 500;
		this.#maxDelayMs = opts.maxDelayMs ?? 10_000;
	}
}
