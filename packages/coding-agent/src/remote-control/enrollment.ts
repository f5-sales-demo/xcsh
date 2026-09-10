/**
 * Native TypeScript port of Codex remote-control enrollment (Apache-2.0).
 * Baseline: 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a, protocol.rs/server_api.rs/auth.rs.
 * See NOTICE.md and LICENSE in this directory. xcsh identifies itself as xcsh.
 */
export const CODEX_PROTOCOL_COMMIT = "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a";
export const ENROLLMENT_URL = "https://chatgpt.com/backend-api/wham/remote/control/server/enroll";

export interface HostIdentity {
	name: string;
	version: string;
	installationId: string;
	os: string;
	arch: string;
}
export interface SubscriptionAuth {
	accessToken: string;
	accountId: string;
}
export interface Enrollment {
	server_id: string;
	environment_id: string;
	remote_control_token: string;
	expires_at: string;
}
export interface EnrollmentEvidence {
	stage: "enrollment" | "pairing";
	status?: number;
	requestId?: string;
	challenge?: boolean;
}
export class RemoteControlError extends Error {
	constructor(
		message: string,
		readonly evidence: EnrollmentEvidence,
	) {
		super(message);
		this.name = "RemoteControlError";
	}
}

/** This gate never follows redirects, retries enrollment, or includes server bodies in diagnostics. */
async function requestHostCredential(
	identity: HostIdentity,
	auth: SubscriptionAuth,
	send: (request: Request) => Promise<Response> = request => fetch(request),
	previous?: Enrollment,
): Promise<Enrollment> {
	if (!auth.accessToken || !auth.accountId) {
		throw new RemoteControlError("Remote enrollment requires ChatGPT subscription authentication", {
			stage: "enrollment",
		});
	}
	let response: Response;
	try {
		response = await send(
			new Request(previous ? ENROLLMENT_URL.replace("/enroll", "/refresh") : ENROLLMENT_URL, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(30_000),
				headers: {
					authorization: `Bearer ${auth.accessToken}`,
					"chatgpt-account-id": auth.accountId,
					"x-codex-installation-id": identity.installationId,
					originator: "xcsh",
					"user-agent": `xcsh/${identity.version} (${identity.os}; ${identity.arch})`,
					"content-type": "application/json",
				},
				body: JSON.stringify(
					previous
						? { server_id: previous.server_id, installation_id: identity.installationId }
						: {
								name: identity.name,
								os: identity.os,
								arch: identity.arch,
								app_server_version: identity.version,
								installation_id: identity.installationId,
							},
				),
			}),
		);
	} catch {
		throw new RemoteControlError("Remote enrollment transport failed", { stage: "enrollment" });
	}
	const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-oai-request-id");
	const evidence: EnrollmentEvidence = {
		stage: "enrollment",
		status: response.status,
		...(requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? { requestId } : {}),
		challenge: response.headers.get("cf-mitigated") === "challenge",
	};
	if (!response.ok) {
		await response.body?.cancel();
		throw new RemoteControlError(`Remote enrollment rejected: HTTP ${response.status}`, evidence);
	}
	try {
		// Bound both streamed and fixed-length bodies, including malformed service responses.
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
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<Enrollment>;
		for (const field of ["server_id", "environment_id", "remote_control_token", "expires_at"] as const) {
			if (typeof body[field] !== "string" || !body[field]?.trim()) throw new Error();
		}
		const expiry = Date.parse(body.expires_at!);
		if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error();
		return {
			server_id: body.server_id!,
			environment_id: body.environment_id!,
			remote_control_token: body.remote_control_token!,
			expires_at: body.expires_at!,
		};
	} catch {
		throw new RemoteControlError("Invalid enrollment response", evidence);
	}
}

export async function enrollRemoteHost(
	identity: HostIdentity,
	auth: SubscriptionAuth,
	send?: (request: Request) => Promise<Response>,
): Promise<Enrollment> {
	return requestHostCredential(identity, auth, send);
}
export async function refreshRemoteHost(
	identity: HostIdentity,
	auth: SubscriptionAuth,
	previous: Enrollment,
	send?: (request: Request) => Promise<Response>,
): Promise<Enrollment> {
	const next = await requestHostCredential(identity, auth, send, previous);
	if (next.server_id !== previous.server_id || next.environment_id !== previous.environment_id)
		throw new RemoteControlError("Mismatched host refresh", { stage: "enrollment" });
	return next;
}
