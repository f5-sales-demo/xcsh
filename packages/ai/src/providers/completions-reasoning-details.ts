import type { ThinkingContent } from "../types";
export type ReasoningDetail = Record<string, unknown> & {
	type: "reasoning.text" | "reasoning.summary" | "reasoning.encrypted";
};
export function isReasoningDetail(value: unknown): value is ReasoningDetail {
	if (!value || typeof value !== "object") return false;
	const detail = value as Record<string, unknown>;
	return detail.type === "reasoning.encrypted"
		? typeof detail.data === "string"
		: detail.type === "reasoning.text"
			? typeof detail.text === "string"
			: detail.type === "reasoning.summary" && typeof detail.summary === "string";
}
export function parseReasoningDetails(signature?: string): ReasoningDetail[] | undefined {
	if (!signature) return undefined;
	try {
		const parsed = JSON.parse(signature);
		return Array.isArray(parsed) && parsed.length && parsed.every(isReasoningDetail) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
export function appendReasoningDetail(details: ReasoningDetail[], detail: ReasoningDetail): void {
	const last = details.at(-1);
	if (
		last?.type === detail.type &&
		(detail.type === "reasoning.text" || detail.type === "reasoning.summary") &&
		(last.index === undefined || detail.index === undefined || last.index === detail.index) &&
		(last.id === undefined || detail.id === undefined || last.id === detail.id)
	) {
		const field = detail.type === "reasoning.text" ? "text" : "summary";
		last[field] = String(last[field]) + String(detail[field]);
		for (const [key, value] of Object.entries(detail)) if (last[key] === undefined) last[key] = value;
	} else details.push({ ...detail });
}
export function applyReasoningDetails(block: ThinkingContent, details: ReasoningDetail[]): void {
	if (details.length) block.thinkingSignature = JSON.stringify(details);
}
