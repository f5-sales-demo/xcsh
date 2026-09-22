import { HerdrProtocolError } from "./client";

export const HERDR_SEMANTIC_REPORT_TIMEOUT_MS = 5_000;

interface SemanticRequestClient {
	request<T extends Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
}

function isAmbiguousSemanticFailure(error: unknown): boolean {
	return (
		error instanceof HerdrProtocolError &&
		(error.code === "timeout" || error.code === "eof" || error.code === "transport_error")
	);
}

/** Retry one semantically idempotent journal write only when its admission is ambiguous. */
export async function requestSemanticReport(
	client: SemanticRequestClient,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	try {
		return await client.request<Record<string, unknown>>(method, params);
	} catch (error) {
		if (!isAmbiguousSemanticFailure(error)) throw error;
		return client.request<Record<string, unknown>>(method, params);
	}
}
