export function encodeNm(msg: unknown): Uint8Array {
	const json = new TextEncoder().encode(JSON.stringify(msg));
	const out = new Uint8Array(4 + json.length);
	new DataView(out.buffer).setUint32(0, json.length, true); // little-endian
	out.set(json, 4);
	return out;
}

export function decodeNm(buf: Uint8Array): { messages: unknown[]; rest: Uint8Array } {
	const messages: unknown[] = [];
	let offset = 0;
	while (buf.length - offset >= 4) {
		const len = new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, true);
		if (buf.length - offset - 4 < len) break;
		const json = new TextDecoder().decode(buf.subarray(offset + 4, offset + 4 + len));
		messages.push(JSON.parse(json));
		offset += 4 + len;
	}
	return { messages, rest: buf.subarray(offset) };
}
