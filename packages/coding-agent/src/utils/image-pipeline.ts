// Bound decoded RGBA data to the previous decoder's 512 MiB allocation limit.
const MAX_IMAGE_PIXELS = (512 * 1024 * 1024) / 4;

export function imagePipeline(bytes: Uint8Array): Bun.Image {
	// Preserve the existing raw-pixel coordinate system for tool screenshots.
	return new Bun.Image(bytes, { maxPixels: MAX_IMAGE_PIXELS, autoOrient: false });
}
