import { ContextService } from "./f5xc-context";
import { formatContextLabel } from "./f5xc-context-display";

export interface RenderedSegment {
	content: string;
	visible: boolean;
}

export function renderF5XCContextSegment(): RenderedSegment {
	try {
		const service = ContextService.instance;
		const status = service.getStatus();

		if (!status.isConfigured) {
			return { content: "", visible: false };
		}

		return { content: formatContextLabel(status), visible: true };
	} catch {
		// ContextService not initialized — silently hide segment
		return { content: "", visible: false };
	}
}
