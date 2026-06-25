import { ContextService, type TokenHealth } from "./xcsh-context";
import { formatContextLabel, truncateContextLabel } from "./xcsh-context-display";

export interface RenderedSegment {
	content: string;
	visible: boolean;
	tokenHealth?: TokenHealth;
}

export function renderXCShContextSegment(): RenderedSegment {
	try {
		const service = ContextService.instance;
		const status = service.getStatus();

		if (!status.isConfigured) {
			return { content: "", visible: false };
		}

		return { content: formatContextLabel(status), visible: true, tokenHealth: status.tokenHealth };
	} catch {
		return { content: "", visible: false };
	}
}

export function truncateXCShContextSegment(maxWidth: number): RenderedSegment | null {
	try {
		const service = ContextService.instance;
		const status = service.getStatus();

		if (!status.isConfigured) return null;

		const truncated = truncateContextLabel(status, maxWidth);
		if (truncated === null) return null;

		return { content: truncated, visible: true, tokenHealth: status.tokenHealth };
	} catch {
		return null;
	}
}
