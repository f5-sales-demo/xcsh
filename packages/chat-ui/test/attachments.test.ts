import { describe, expect, test } from "bun:test";
import {
	type Attachment,
	addAttachment,
	byteLength,
	type ImageAttachment,
	isImageAttachment,
	MAX_ATTACHMENT_BYTES,
	MAX_IMAGE_BYTES,
	serializeAttachment,
	serializeAttachments,
} from "../src/attachments/model";

function file(id: string, over: Partial<Attachment> = {}): Attachment {
	return {
		id,
		kind: "file",
		label: `f${id}.ts`,
		dedupKey: `file:${id}`,
		content: "x",
		...over,
	} as Attachment;
}

function image(id: string, over: Partial<ImageAttachment> = {}): ImageAttachment {
	return {
		id,
		kind: "image",
		label: `img${id}.png`,
		dedupKey: `image:${id}`,
		content: "",
		mimeType: "image/png",
		data: "AAAA",
		...over,
	};
}

describe("byteLength", () => {
	test("counts UTF-8 bytes, not code units", () => {
		expect(byteLength("abc")).toBe(3);
		expect(byteLength("€")).toBe(3); // 3-byte UTF-8
		expect(byteLength("🚀")).toBe(4);
	});
});

describe("serializeAttachment(s)", () => {
	test("renders one attachment as a labelled text block", () => {
		const a = file("1", { label: "lb.ts", content: 'name: "my-lb"' });
		expect(serializeAttachment(a)).toBe('[File: lb.ts]\n\nname: "my-lb"');
	});

	test("joins multiple attachments with a blank line", () => {
		const out = serializeAttachments([file("1", { content: "A" }), file("2", { content: "B" })]);
		expect(out).toBe("[File: f1.ts]\n\nA\n\n[File: f2.ts]\n\nB");
	});

	test("labels each kind with its human name", () => {
		const folder = {
			id: "d",
			kind: "folder",
			label: "src",
			dedupKey: "folder:src",
			content: "…",
			path: "src",
		} as Attachment;
		expect(serializeAttachment(folder)).toStartWith("[Folder: src]");
	});

	test("empty list serializes to empty string", () => {
		expect(serializeAttachments([])).toBe("");
	});
});

describe("addAttachment", () => {
	test("appends a new attachment", () => {
		const r = addAttachment([], file("1"));
		expect(r.added).toBe(true);
		expect(r.list).toHaveLength(1);
	});

	test("rejects a duplicate dedupKey (returns the same list ref, reason=duplicate)", () => {
		const list = [file("1")];
		const r = addAttachment(list, file("1"));
		expect(r.added).toBe(false);
		expect(r.reason).toBe("duplicate");
		expect(r.list).toBe(list);
	});

	test("rejects when the combined content would exceed MAX_ATTACHMENT_BYTES (reason=budget)", () => {
		const big = file("1", { dedupKey: "file:big", content: "a".repeat(MAX_ATTACHMENT_BYTES - 1) });
		const r1 = addAttachment([], big);
		expect(r1.added).toBe(true);
		const more = file("2", { dedupKey: "file:more", content: "bb" });
		const r2 = addAttachment(r1.list, more);
		expect(r2.added).toBe(false);
		expect(r2.reason).toBe("budget");
		expect(r2.list).toBe(r1.list);
	});

	test("allows filling exactly up to the budget", () => {
		const exact = file("1", { dedupKey: "file:exact", content: "a".repeat(MAX_ATTACHMENT_BYTES) });
		expect(addAttachment([], exact).added).toBe(true);
	});
});

describe("image attachments", () => {
	test("isImageAttachment narrows the union", () => {
		expect(isImageAttachment(image("1"))).toBe(true);
		expect(isImageAttachment(file("1"))).toBe(false);
	});

	test("an image serializes to empty string (rides the wire images field, never the prompt text)", () => {
		expect(serializeAttachment(image("1"))).toBe("");
	});

	test("serializeAttachments drops image blocks so no blank separators leak into text", () => {
		// A text file between two images must not gain empty neighbours.
		const out = serializeAttachments([image("a"), file("1", { content: "A" }), image("b")]);
		expect(out).toBe("[File: f1.ts]\n\nA");
	});

	test("images-only list serializes to empty string", () => {
		expect(serializeAttachments([image("a"), image("b")])).toBe("");
	});

	test("images are budgeted against MAX_IMAGE_BYTES, not the text budget", () => {
		// A file that fills the TEXT budget does not block an image, and vice-versa.
		const bigText = file("1", { dedupKey: "file:big", content: "a".repeat(MAX_ATTACHMENT_BYTES) });
		const r1 = addAttachment([], bigText);
		expect(r1.added).toBe(true);
		// The image rides its own budget, so it still fits despite the full text budget.
		const r2 = addAttachment(r1.list, image("1", { data: "a".repeat(1024) }));
		expect(r2.added).toBe(true);
	});

	test("rejects images past MAX_IMAGE_BYTES (reason=budget)", () => {
		const big = image("1", { dedupKey: "image:big", data: "a".repeat(MAX_IMAGE_BYTES - 1) });
		const r1 = addAttachment([], big);
		expect(r1.added).toBe(true);
		const more = image("2", { dedupKey: "image:more", data: "bb" });
		const r2 = addAttachment(r1.list, more);
		expect(r2.added).toBe(false);
		expect(r2.reason).toBe("budget");
		expect(r2.list).toBe(r1.list);
	});
});
