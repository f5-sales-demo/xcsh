import { requestHerdrIdempotent } from "./retry";

export const HERDR_SEMANTIC_REPORT_TIMEOUT_MS = 5_000;

/** Retry one semantically idempotent journal write only when its admission is ambiguous. */
export async function requestSemanticReport(
	client: { request<T extends Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T> },
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return requestHerdrIdempotent(client, method, params);
}
