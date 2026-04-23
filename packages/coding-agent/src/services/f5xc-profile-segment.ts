import { ProfileService } from "./f5xc-profile";
import { formatProfileLabel } from "./f5xc-profile-display";

export interface RenderedSegment {
	content: string;
	visible: boolean;
}

export function renderF5XCProfileSegment(): RenderedSegment {
	try {
		const service = ProfileService.instance;
		const status = service.getStatus();

		if (!status.isConfigured) {
			return { content: "", visible: false };
		}

		return { content: formatProfileLabel(status), visible: true };
	} catch {
		// ProfileService not initialized — silently hide segment
		return { content: "", visible: false };
	}
}
