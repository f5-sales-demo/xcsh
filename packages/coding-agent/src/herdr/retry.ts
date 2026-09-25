import { isRetryableHerdrTransportError } from "./client";

export const HERDR_REPORT_RETRY_DELAY_MS = 250;

interface HerdrRequestClient {
	request<T extends Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
}

/**
 * Retry exactly once after an ambiguous transport failure. The client assigns a
 * fresh request id; callers retain the original method, payload and sequence.
 */
export async function requestHerdrIdempotent<T extends Record<string, unknown>>(
	client: HerdrRequestClient,
	method: string,
	params: Record<string, unknown>,
): Promise<T> {
	try {
		return await client.request<T>(method, params);
	} catch (error) {
		if (!isRetryableHerdrTransportError(error)) throw error;
		await new Promise(resolve => setTimeout(resolve, HERDR_REPORT_RETRY_DELAY_MS));
		return client.request<T>(method, params);
	}
}
