import type { MediaDescriptorV1 } from "./types";
import { validateMediaDescriptorV1 } from "./types";

export const MEDIA_TOOL_RESULT_V1 = "xcsh.media/v1" as const;

export interface MediaToolResultV1 {
	mediaResult: typeof MEDIA_TOOL_RESULT_V1;
	descriptor: MediaDescriptorV1;
	displayMethod: "inline" | "poster" | "text";
}

export function validateMediaToolResultV1(value: unknown): MediaToolResultV1 {
	if (!value || typeof value !== "object") throw new Error("media tool result must be an object");
	const result = value as Partial<MediaToolResultV1>;
	if (result.mediaResult !== MEDIA_TOOL_RESULT_V1) throw new Error("unsupported media tool result version");
	if (!result.descriptor) throw new Error("media tool result requires a descriptor");
	const descriptor = validateMediaDescriptorV1(result.descriptor);
	if (!(["inline", "poster", "text"] as const).includes(result.displayMethod as never)) {
		throw new Error("invalid media display method");
	}
	return { mediaResult: MEDIA_TOOL_RESULT_V1, descriptor, displayMethod: result.displayMethod! };
}
