/** Ported from the pinned Codex protocol.rs/enroll.rs; see NOTICE.md. */
import { type Enrollment, RemoteControlError } from "./enrollment";
export interface Pairing {
	pairing_code: string;
	manual_pairing_code: string | null;
	server_id: string;
	environment_id: string;
	expires_at: string;
}
export async function startPairing(
	enrollment: Enrollment,
	send: (request: Request) => Promise<Response> = request => fetch(request),
): Promise<Pairing> {
	if (!(Date.parse(enrollment.expires_at) > Date.now())) {
		throw new RemoteControlError("Host credential expired", { stage: "pairing" });
	}
	let response: Response;
	try {
		response = await send(
			new Request("https://chatgpt.com/backend-api/wham/remote/control/server/pair", {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(30_000),
				headers: {
					authorization: `Bearer ${enrollment.remote_control_token}`,
					"content-type": "application/json",
					originator: "xcsh",
				},
				body: JSON.stringify({ manual_code: true }),
			}),
		);
	} catch {
		throw new RemoteControlError("Remote pairing transport failed", { stage: "pairing" });
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new RemoteControlError(`Remote pairing rejected: HTTP ${response.status}`, {
			stage: "pairing",
			status: response.status,
		});
	}
	try {
		const reader = response.body?.getReader();
		if (!reader) throw new Error();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 64 * 1024) throw new Error();
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Pairing;
		if (
			body.server_id !== enrollment.server_id ||
			body.environment_id !== enrollment.environment_id ||
			typeof body.pairing_code !== "string" ||
			!body.pairing_code ||
			!(Date.parse(body.expires_at) > Date.now()) ||
			(body.manual_pairing_code != null && typeof body.manual_pairing_code !== "string")
		)
			throw new Error();
		return {
			pairing_code: body.pairing_code,
			manual_pairing_code: body.manual_pairing_code ?? null,
			server_id: body.server_id,
			environment_id: body.environment_id,
			expires_at: body.expires_at,
		};
	} catch {
		throw new RemoteControlError("Invalid pairing response", { stage: "pairing", status: response.status });
	}
}
