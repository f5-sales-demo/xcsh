export function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}
export function providerHeadersToRecord(
	...sets: (Record<string, string | null> | undefined)[]
): Record<string, string> {
	const headers = new Map<string, string>();
	for (const set of sets)
		for (const [name, value] of Object.entries(set ?? {})) {
			if (value === null) headers.delete(name.toLowerCase());
			else headers.set(name.toLowerCase(), value);
		}
	return Object.fromEntries(headers);
}
export interface OperationError {
	message: string;
	status?: number;
}
export function normalizeProviderError(error: unknown): OperationError {
	let message = error instanceof Error ? error.message : String(error);
	const body = (error as { body?: unknown })?.body;
	if (typeof body === "string") {
		try {
			const detail = JSON.parse(body)?.error?.message;
			if (typeof detail === "string") message = `${message}: ${detail.slice(0, 1000)}`;
		} catch {
			/* Non-JSON service bodies are not echoed. */
		}
	}
	message = message.replace(/Bearer\s+\S+|sk-[A-Za-z0-9_-]+/gi, "[REDACTED]");
	return { message, status: (error as { status?: number })?.status };
}
export function formatProviderError(error: OperationError, label = "Provider error"): string {
	if (/timed out/i.test(error.message)) return error.message;
	return `${label}${error.status ? ` (${error.status})` : ""}: ${error.message}`;
}
export function sanitizeSurrogates(text: string): string {
	return text.toWellFormed();
}
