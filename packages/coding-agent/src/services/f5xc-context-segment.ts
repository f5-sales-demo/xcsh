import { ContextService, type TokenHealth } from "./f5xc-context";
import { formatContextLabel } from "./f5xc-context-display";

export interface RenderedSegment {
	content: string;
	visible: boolean;
	tokenHealth?: TokenHealth;
}

export function renderF5XCContextSegment(): RenderedSegment {
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
