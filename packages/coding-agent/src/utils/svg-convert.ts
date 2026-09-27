import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasmPath from "@resvg/resvg-wasm/index_bg.wasm" with { type: "file" };

let resvgReady: Promise<void> | undefined;

export async function renderSvg(base64Data: string): Promise<Uint8Array> {
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
