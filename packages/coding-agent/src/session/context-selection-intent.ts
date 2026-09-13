const ACTIVATION_PATTERNS = [
	/\b(?:apply|load|select|use)\s+(?:the\s+)?(?:(?:xcsh|tenant)\s+)?(?!(?:a|active|an|current|that|the|this)\b)[a-z0-9][a-z0-9_-]*\s+context\b/giu,
	/\b(?:apply|load|select|use)\s+(?:the\s+)?(?:xcsh\s+)?context(?:\s+(?:called|named))?\s+(?!(?:for|in|to|with)\b)[a-z0-9][a-z0-9_-]*\b/giu,
	/\bswitch\s+(?:the\s+)?(?:(?:xcsh|tenant)\s+)?context\s+to\s+[a-z0-9][a-z0-9_-]*\b/giu,
	/\bswitch\s+to\s+(?:the\s+)?[a-z0-9][a-z0-9_-]*\s+context\b/giu,
];

function delegatedInput(value: string): string {
	if (!value.includes("<realtime_delegation>")) return value;
	const input = value.match(/<input>([\s\S]*?)<\/input>/u)?.[1];
	if (input == null) return value;
	return input.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** True only for an explicit request to change the active saved tenant context. */
export function requestsContextActivation(value: string): boolean {
	const text = delegatedInput(value);
	for (const pattern of ACTIVATION_PATTERNS) {
		pattern.lastIndex = 0;
		for (const match of text.matchAll(pattern)) {
			const prefix = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index).toLowerCase();
			if (/(?:do\s+not|don't|dont|never|avoid|without)\s*$/u.test(prefix)) continue;
			if (/(?:how\s+to|how\s+(?:can|could|do|would)\s+i|explain\s+how\s+to)\s*$/u.test(prefix)) continue;
			return true;
		}
	}
	return false;
}
