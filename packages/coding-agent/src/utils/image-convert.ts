import { imagePipeline } from "./image-pipeline";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	try {
		if (mimeType === "image/svg+xml") {
			const { renderSvg } = await import("./svg-convert");
			return {
				data: Buffer.from(await renderSvg(base64Data)).toBase64(),
				mimeType: "image/png",
			};
		}
		const pngBuffer = await imagePipeline(Buffer.from(base64Data, "base64")).png().bytes();
		return {
			data: Buffer.from(pngBuffer).toBase64(),
			mimeType: "image/png",
		};
	} catch {
		// Conversion failed
		return null;
	}
}
