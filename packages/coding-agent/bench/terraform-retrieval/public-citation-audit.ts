import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import {
	normalizeAssistantDocumentationCitations,
	publicCitationForInternalUri,
	SessionCitationRegistry,
} from "../../src/internal-urls/public-citations";
import { extractReferences } from "../../src/references";

export function auditPublicCitations(messages: readonly AgentMessage[], required: readonly string[]) {
	const registry = new SessionCitationRegistry(messages);
	const assistants = messages.filter((message): message is AssistantMessage => message.role === "assistant");
	const citations = [
		...new Set(
			assistants.flatMap(message =>
				extractReferences({
					...message,
					content: message.content.map(block =>
						block.type === "text"
							? {
									...block,
									text: block.text
										.replace(/^\s*`{3,}[^\n]*\n[\s\S]*?^\s*`{3,}\s*$/gm, "")
										.replace(/`[^`\n]*`/g, ""),
								}
							: block,
					),
				}).map(reference => reference.url),
			),
		),
	];
	const internal = assistants.some(message =>
		message.content.some(
			block =>
				block.type === "text" &&
				(normalizeAssistantDocumentationCitations(block.text, uri => {
					const result = publicCitationForInternalUri(uri);
					return result ? { readUri: uri, reason: "missing-public-mapping" } : null;
				}) !== block.text ||
					block.citations?.some(citation => publicCitationForInternalUri(citation.url) !== null)),
		),
	);
	const destinations = required.map(registry.resolve);
	const failures = destinations.filter(destination => !destination || "reason" in destination);
	return {
		citations,
		internal_documentation_citations: internal,
		required_public_citations_verified:
			!internal &&
			failures.length === 0 &&
			destinations.every(
				destination => destination && "publicUrl" in destination && citations.includes(destination.publicUrl),
			),
		mappings: destinations,
	};
}
if (import.meta.main) {
	const input = (await Bun.stdin.json()) as { messages: AgentMessage[]; required: string[] };
	console.log(JSON.stringify(auditPublicCitations(input.messages, input.required)));
}
