import type { InternalResource } from "../internal-urls/types";
import { toolResult } from "./tool-result";

/** Reserve transport fields while measuring escaped content and source metadata. */
export async function terraformReadEnvelope(request: string, resolve: (uri: string) => Promise<InternalResource>) {
	const url = new URL(request);
	const discovery = ["", "/"].includes(url.pathname);
	const view = url.searchParams.get("view");
	const budget = discovery || view === "hint" ? 4096 : view === "context" ? 16384 : null;
	const makeResult = (content: string, source: string) => toolResult().text(content).sourceInternal(source).done();
	const fits = (result: ReturnType<typeof makeResult>) =>
		!budget || Buffer.byteLength(JSON.stringify(result)) <= budget - 512;
	const attempt = new URL(url);
	let originalRequest = true;
	for (;;) {
		const resource = await resolve(originalRequest ? request : attempt.toString());
		originalRequest = false;
		const result = makeResult(resource.content, attempt.toString());
		if (fits(result)) return result;
		if (discovery) {
			const limit = Number(attempt.searchParams.get("limit") ?? "5");
			if (Number.isSafeInteger(limit) && limit > 1) {
				attempt.searchParams.set("limit", String(Math.max(1, Math.floor(limit / 2))));
				continue;
			}
		}
		// Preserve provenance, but never split a section, fence or candidate record.
		const provenance = resource.content
			.split("\n")
			.filter(line => /^(?:Provider|Snapshot|Commit|Receipt SHA-256):/.test(line))
			.join("\n");
		const full = new URL(url);
		full.search = "?view=full";
		const notice = discovery
			? `${provenance}\n\nDiscovery response exceeds the complete tool envelope budget. Refine the query or follow a more specific documented node. Request: ${attempt}`
			: `${provenance}\n\nOversized section: complete response exceeds the tool envelope budget. Complete section: ${full}`;
		const bounded = makeResult(notice, attempt.toString());
		if (!fits(bounded)) throw new Error("Terraform response envelope cannot fit its provenance and destination");
		return bounded;
	}
}
