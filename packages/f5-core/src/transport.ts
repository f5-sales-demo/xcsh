import type { HttpTransport, HttpTransportRequest, HttpTransportResponse } from "@f5-sales-demo/pi-resource-management";

/** Every HTTP request gets one attempt. A mutation failure must be reconciled, never replayed. */
export class SingleAttemptTransport implements HttpTransport {
	constructor(
		private readonly token: string,
		private readonly signal?: AbortSignal,
	) {}
	async request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
		const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(this.signal ? [this.signal] : [])]);
		signal.throwIfAborted();
		const headers = new Headers(request.headers);
		headers.set("Authorization", `APIToken ${this.token}`);
		headers.set("Accept", "application/json");
		if (request.body) headers.set("Content-Type", "application/json");
		const response = await fetch(request.url, {
			method: request.method,
			redirect: "error",
			signal,
			headers,
			body: request.body ? JSON.stringify(request.body) : undefined,
		});
		if (response.status === 401 || response.status === 403) {
			await response.body?.cancel();
			return { httpStatus: response.status, body: {} };
		}
		const text = await response.text();
		const body: unknown = text ? JSON.parse(text) : {};
		if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid API response");
		return { httpStatus: response.status, body: body as Record<string, unknown> };
	}
}
