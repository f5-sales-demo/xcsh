import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };
import { imagePipeline } from "./image-pipeline";

let resvgReady: Promise<void> | undefined;

async function renderSvg(base64Data: string): Promise<Uint8Array> {
	resvgReady ??= Bun.file(resvgWasmPath)
		.arrayBuffer()
		.then(bytes => initWasm(bytes));
	await resvgReady;
	const renderer = new Resvg(Buffer.from(base64Data, "base64"), {
		fitTo: { mode: "width", value: 1600 },
		font: { loadSystemFonts: false },
	});
	try {
		const rendered = renderer.render();
		try {
			return rendered.asPng();
		} finally {
			rendered.free();
		}
	} finally {
		renderer.free();
	}
}

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
