import { describe, expect, it } from "bun:test";
import { convertToPng } from "../../src/utils/image-convert";
import { resizeImage } from "../../src/utils/image-resize";

const red = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

describe("image conversion", () => {
	it("preserves PNG bytes", async () => {
		expect(await convertToPng(red, "image/png")).toEqual({ data: red, mimeType: "image/png" });
	});

	it("converts JPEG and WebP to decodable PNG", async () => {
		for (const format of ["jpeg", "webp"] as const) {
			const input = await new Bun.Image(Buffer.from(red, "base64"))[format]().toBase64();
			const result = await convertToPng(input, `image/${format}`);
			expect(result?.mimeType).toBe("image/png");
			expect(await new Bun.Image(Buffer.from(result!.data, "base64")).metadata()).toEqual({
				width: 1,
				height: 1,
				format: "png",
			});
		}
	});

	it("returns null for an invalid encoded image", async () => {
		expect(await convertToPng(Buffer.from("invalid image").toString("base64"), "image/jpeg")).toBeNull();
	});

	it("preserves bytes and MIME on resize decode failure", async () => {
		const data = Buffer.from("invalid image").toString("base64");
		const result = await resizeImage({ type: "image", data, mimeType: "image/jpeg" });
		expect(result.data).toBe(data);
		expect(result.mimeType).toBe("image/jpeg");
		expect(result.wasResized).toBe(false);
		expect(result.width).toBe(0);
	});

	it("rejects oversized BMP dimensions before allocating pixels", async () => {
		const bmp = Buffer.alloc(54);
		bmp.write("BM");
		bmp.writeUInt32LE(54, 2);
		bmp.writeUInt32LE(54, 10);
		bmp.writeUInt32LE(40, 14);
		bmp.writeInt32LE(100000, 18);
		bmp.writeInt32LE(100000, 22);
		bmp.writeUInt16LE(1, 26);
		bmp.writeUInt16LE(24, 28);
		expect(await convertToPng(bmp.toString("base64"), "image/bmp")).toBeNull();
	});
});
