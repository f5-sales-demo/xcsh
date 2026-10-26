import { createHash } from "node:crypto";
import type { SubscriptionAuth } from "./enrollment";
import { type VoiceClosureReceipt, VoiceFinalization } from "./voice-finalization";
import { CODEX_LIVE_VERSION, existingCallConfig } from "./voice-protocol";
import { openVoiceSocket, type VoiceHandlers, type VoiceSocket } from "./voice-socket";

/** Application-owned identity observed during creation; never a provider schema extension. */
export interface OwnedVoiceCallIdentity {
	callId: string;
	realtimeSessionId: string | null;
	/** Empty only for a durable identity that is bound by accountIdSha256. */
	accountId: string;
	accountIdSha256?: string;
}
interface RecoveryDependencies {
	authenticate(): Promise<SubscriptionAuth>;
	open?(
		url: string,
		headers: Record<string, string>,
		handlers: VoiceHandlers,
		signal?: AbortSignal,
	): Promise<VoiceSocket>;
}
/** Attach to the known call with the same subscription, then drain its final close event. */
export async function reconcileVoiceCall(
	identity: OwnedVoiceCallIdentity,
	dependencies: RecoveryDependencies,
	timeoutMs = 15_000,
): Promise<VoiceClosureReceipt> {
	const controller = new AbortController();
	const finalization = new VoiceFinalization();
	let socket: VoiceSocket | undefined;
	let observedClosed = false;
	let transportLost = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error("Call reconciliation timed out"));
		}, timeoutMs);
	});
	try {
		const config = existingCallConfig({
			version: CODEX_LIVE_VERSION,
			outputModality: "audio",
			realtimeSessionId: identity.realtimeSessionId,
			transport: { type: "existingCall", callId: identity.callId },
		});
		const auth = await Promise.race([dependencies.authenticate(), expired]);
		if (
			controller.signal.aborted ||
			(!identity.accountId && !identity.accountIdSha256) ||
			(identity.accountId && auth.accountId !== identity.accountId) ||
			(identity.accountIdSha256 &&
				identity.accountIdSha256 !== "sha256:" + createHash("sha256").update(auth.accountId).digest("hex"))
		)
			throw new Error("Original subscription is required for call reconciliation");
		const headers = {
			Authorization: `Bearer ${auth.accessToken}`,
			"ChatGPT-Account-Id": auth.accountId,
			originator: "xcsh",
			"openai-alpha": "quicksilver=v2",
			...(identity.realtimeSessionId ? { "x-session-id": identity.realtimeSessionId } : {}),
		};
		const open =
			dependencies.open ??
			((url, headers, handlers, signal) => openVoiceSocket(url, headers, handlers, undefined, signal));
		const opening = open(
			config.url,
			headers,
			{
				message: data => {
					if (controller.signal.aborted || data.length > 1_048_576) return;
					try {
						observedClosed = finalization.observe(JSON.parse(data)) || observedClosed;
					} catch {}
				},
				closed: () => {
					transportLost = true;
					finalization.lost();
				},
			},
			controller.signal,
		);
		// An injected or delayed transport must not leave a handle after the bounded attempt.
		void opening.then(
			value => {
				if (controller.signal.aborted) value.close();
			},
			() => {},
		);
		socket = await Promise.race([opening, expired]);
		if (controller.signal.aborted || (transportLost && !observedClosed)) return { confirmed: false };
		return await Promise.race([
			finalization.close(
				() => {
					if (!observedClosed) socket!.send(JSON.stringify({ type: "session.close" }));
				},
				() => {},
				timeoutMs,
			),
			expired,
		]);
	} catch {
		return { confirmed: false };
	} finally {
		clearTimeout(timer);
		finalization.lost();
		controller.abort();
		socket?.close();
	}
}
