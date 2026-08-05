import { describe, expect, test } from "bun:test";
import { officeHelloFrame, UatBridgeClient, waitForOfficeApplicationReady } from "../scripts/uat/bridge-client";

class FakeWebSocket extends EventTarget {
	readonly readyState = WebSocket.OPEN;
	readonly sent: string[] = [];

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {}

	emit(frame: unknown): void {
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
	}
}

describe("Office UAT bridge handshake", () => {
	test("announces the required contract version and Excel host", () => {
		expect(officeHelloFrame()).toEqual({ type: "hello", version: "1", host: "excel" });
	});

	test("retries an application-level probe until ChatHandler is attached", async () => {
		let attempts = 0;
		const requests: Array<{ message: unknown; accept: unknown }> = [];
		const client = {
			request: async (message: unknown, accept: unknown) => {
				requests.push({ message, accept });
				attempts++;
				if (attempts < 3) throw new Error("Timed out waiting for a frame");
				return { type: "skills" };
			},
		};

		await waitForOfficeApplicationReady(client, {
			timeoutMs: 100,
			attemptTimeoutMs: 10,
			retryDelayMs: 0,
		});
		expect(attempts).toBe(3);
		expect(requests).toEqual([
			{ message: { type: "list_skills" }, accept: "skills" },
			{ message: { type: "list_skills" }, accept: "skills" },
			{ message: { type: "list_skills" }, accept: "skills" },
		]);
	});

	test("forwards optional synthetic image input on a UAT turn", async () => {
		const ws = new FakeWebSocket();
		const client = new UatBridgeClient(ws as unknown as WebSocket, {
			port: 19242,
			ack: { type: "hello_ack", serveKind: "office" },
		});
		const images = [{ data: "c3ludGhldGljLXBuZw==", mimeType: "image/png" }];

		const pending = client.turn("Read the code in the attached synthetic image.", "c-image", images);
		ws.emit({ type: "chat_done", id: "c-image" });
		await pending;

		expect(JSON.parse(ws.sent[0] ?? "{}")).toEqual({
			type: "chat_request",
			id: "c-image",
			text: "Read the code in the attached synthetic image.",
			mode: "educational",
			context: null,
			images,
		});
	});

	test("keeps an image-free UAT turn free of an empty images field", async () => {
		const ws = new FakeWebSocket();
		const client = new UatBridgeClient(ws as unknown as WebSocket, {
			port: 19242,
			ack: { type: "hello_ack", serveKind: "office" },
		});

		const pending = client.turn("Text only", "c-text");
		ws.emit({ type: "chat_done", id: "c-text" });
		await pending;

		expect(JSON.parse(ws.sent[0] ?? "{}")).not.toHaveProperty("images");
	});

	test("omits an explicitly empty image list from a UAT turn", async () => {
		const ws = new FakeWebSocket();
		const client = new UatBridgeClient(ws as unknown as WebSocket, {
			port: 19242,
			ack: { type: "hello_ack", serveKind: "office" },
		});

		const pending = client.turn("No image payload", "c-empty-images", []);
		ws.emit({ type: "chat_done", id: "c-empty-images" });
		await pending;

		expect(JSON.parse(ws.sent[0] ?? "{}")).not.toHaveProperty("images");
	});
});
