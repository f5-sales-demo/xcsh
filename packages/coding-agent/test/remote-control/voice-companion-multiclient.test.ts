import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { SessionTarget } from "../../src/remote-control/session";
import { startVoiceCompanion } from "../../src/remote-control/voice-companion";
import { voiceCoordinatorFor } from "../../src/remote-control/voice-coordinator";

test("authenticated companion observers discover one audio owner without sharing client frames", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-companion-clients-"));
	const keys = [
		"XCSH_VOICE_COMPANION_CERT",
		"XCSH_VOICE_COMPANION_KEY",
		"XCSH_VOICE_COMPANION_BIND",
		"XCSH_VOICE_COMPANION_PUBLIC_HOST",
	] as const;
	const previous = keys.map(key => process.env[key]);
	const sockets: WebSocket[] = [];
	let companion: Awaited<ReturnType<typeof startVoiceCompanion>> | undefined;
	const target = { sessionId: "chat-fixture" } as SessionTarget;
	const coordinator = voiceCoordinatorFor(target, target.sessionId);
	const lease = await coordinator.acquire("first-client", async () => {});
	try {
		const cert = join(root, "cert.pem"),
			key = join(root, "key.pem");
		const child = Bun.spawn(
			[
				"openssl",
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-days",
				"1",
				"-subj",
				"/CN=localhost",
				"-addext",
				"subjectAltName=IP:127.0.0.1",
				"-keyout",
				key,
				"-out",
				cert,
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		expect(await child.exited).toBe(0);
		process.env.XCSH_VOICE_COMPANION_CERT = cert;
		process.env.XCSH_VOICE_COMPANION_KEY = key;
		process.env.XCSH_VOICE_COMPANION_BIND = "127.0.0.1";
		process.env.XCSH_VOICE_COMPANION_PUBLIC_HOST = "127.0.0.1";
		companion = await startVoiceCompanion(target, () => {});
		const url = new URL(companion.url),
			ca = await readFile(cert);
		async function connect(authenticate = true) {
			const options = { ca, tls: { ca }, headers: { Origin: url.origin } };
			const socket = new WebSocket(`${url.origin.replace("https:", "wss:")}/events`, options);
			sockets.push(socket);
			const frames: Record<string, unknown>[] = [];
			let closeCode: number | undefined;
			socket.on("message", data => frames.push(JSON.parse(String(data))));
			socket.on("close", code => {
				closeCode = code;
			});
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("Companion connection deadline")), 2000);
				socket.once("open", () => {
					clearTimeout(timer);
					resolve();
				});
				socket.on("error", error => {
					clearTimeout(timer);
					reject(error);
				});
			});
			if (authenticate) socket.send(JSON.stringify({ type: "voice_hello", token: url.hash.slice(1) }));
			return { socket, frames, code: () => closeCode };
		}
		async function waitFor(condition: () => boolean) {
			const deadline = Date.now() + 2000;
			while (!condition() && Date.now() < deadline) await Bun.sleep(10);
			expect(condition()).toBe(true);
		}
		async function discover(client: Awaited<ReturnType<typeof connect>>, clientId: string, requestId: string) {
			client.socket.send(JSON.stringify({ type: "voice_request", action: "capabilities", clientId, requestId }));
			await waitFor(() => client.frames.some(frame => frame.requestId === requestId));
			return client.frames.find(frame => frame.requestId === requestId)!;
		}
		const first = await connect(),
			second = await connect(),
			unauthenticated = await connect(false);
		const one = await discover(first, "first-client", "first-discovery");
		const two = await discover(second, "second-client", "second-discovery");
		expect(one.params).toMatchObject({ owner: lease });
		expect(two.params).toMatchObject({ owner: lease });
		expect(first.frames.some(frame => frame.requestId === "second-discovery")).toBe(false);
		expect(second.frames.some(frame => frame.requestId === "first-discovery")).toBe(false);
		expect(unauthenticated.frames).toEqual([]);
		second.socket.close();
		await waitFor(() => second.socket.readyState === WebSocket.CLOSED);
		await discover(first, "first-client", "after-observer-close");
		expect(coordinator.snapshot).toBe(lease);
		const duplicate = await connect();
		duplicate.socket.send(
			JSON.stringify({
				type: "voice_request",
				action: "capabilities",
				clientId: "first-client",
				requestId: "duplicate-discovery",
			}),
		);
		await waitFor(() => duplicate.socket.readyState === WebSocket.CLOSED);
		expect(duplicate.code()).toBe(1008);
		await discover(first, "first-client", "after-duplicate-close");
		const malformed = await connect();
		malformed.socket.send(
			JSON.stringify({
				type: "voice_request",
				action: "capabilities",
				clientId: {},
				requestId: "malformed-discovery",
			}),
		);
		await waitFor(() => malformed.socket.readyState === WebSocket.CLOSED);
		expect(malformed.code()).toBe(1008);
		await discover(first, "first-client", "after-malformed-close");
		expect(unauthenticated.frames).toEqual([]);
	} finally {
		for (const socket of sockets) socket.close();
		await companion?.close();
		coordinator.release(lease);
		keys.forEach((key, index) => {
			if (previous[index] === undefined) delete process.env[key];
			else process.env[key] = previous[index];
		});
		await rm(root, { recursive: true, force: true });
	}
}, 15000);
