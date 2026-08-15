import { describe, expect, test } from "bun:test";
import { sniffMedia } from "../src/media/sniff";

describe("sniffMedia", () => {
	test("recognizes PNG and MP4 by content instead of extension", () => {
		const png = Buffer.alloc(24);
		png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		png.writeUInt32BE(320, 16);
		png.writeUInt32BE(200, 20);
		expect(sniffMedia(png)).toEqual({ mimeType: "image/png", kind: "image", width: 320, height: 200 });

		const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
		expect(sniffMedia(mp4)).toMatchObject({ mimeType: "video/mp4", kind: "video" });
	});

	test("recognizes GIF and animated WebP", () => {
		const gif = Buffer.alloc(10);
		gif.write("GIF89a", 0, "ascii");
		gif.writeUInt16LE(40, 6);
		gif.writeUInt16LE(30, 8);
		expect(sniffMedia(gif)).toEqual({ mimeType: "image/gif", kind: "animation", width: 40, height: 30 });

		const webp = Buffer.alloc(30);
		webp.write("RIFF", 0, "ascii");
		webp.write("WEBP", 8, "ascii");
		webp.write("VP8X", 12, "ascii");
		webp[20] = 0x02;
		webp[24] = 19;
		webp[27] = 9;
		expect(sniffMedia(webp)).toEqual({ mimeType: "image/webp", kind: "animation", width: 20, height: 10 });
	});

	test("rejects unknown input", () => {
		expect(sniffMedia(Buffer.from("not media"))).toBeNull();
	});
});
