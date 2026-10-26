import { useEffect, useRef, useState } from "react";
import type { VoiceTransport } from "./browser-client";
import { isVoiceFrame, type VoiceRequest } from "./contract";

/** Panels retain execution and host tools while audio runs in an activated HTTPS companion. */
export function VoiceCompanionControl({ transport, ready = true }: { transport: VoiceTransport; ready?: boolean }) {
	const clientId = useRef(crypto.randomUUID());
	const [chatId, setChatId] = useState<string>();
	const [url, setUrl] = useState<string>();
	const [error, setError] = useState(false);
	useEffect(() => {
		if (!ready) return;
		const unsubscribe = transport.onMessage(message => {
			if (!isVoiceFrame(message) || (message.clientId !== undefined && message.clientId !== clientId.current))
				return;
			if (message.method === "xcsh/voice/capabilities" && message.params.model === "gpt-live-1")
				setChatId(message.chatId);
			if (message.method === "xcsh/voice/error") setError(true);
			if (message.method === "xcsh/voice/companion" && typeof message.params.url === "string") {
				const link = new URL(message.params.url);
				if (
					link.protocol === "https:" &&
					!link.username &&
					!link.password &&
					/^[A-Za-z0-9_-]{43}$/.test(link.hash.slice(1))
				) {
					setUrl(link.href);
					setError(false);
				}
			}
		});
		transport.send({
			type: "voice_request",
			clientId: clientId.current,
			action: "capabilities",
			requestId: crypto.randomUUID(),
		});
		return unsubscribe;
	}, [transport, ready]);
	if (!ready || !chatId) return null;
	const request = (action: VoiceRequest["action"]) =>
		transport.send({
			type: "voice_request",
			clientId: clientId.current,
			action,
			requestId: crypto.randomUUID(),
			chatId,
		});
	return (
		<fieldset className="voice-controls">
			<legend>Voice</legend>
			<button type="button" onClick={() => request("companion")}>
				Use voice companion
			</button>
			{url && (
				<>
					<a href={url} target="_blank" rel="noreferrer">
						Open voice companion
					</a>
					<button type="button" onClick={() => request("stop")}>
						End voice
					</button>
				</>
			)}
			{error && <p role="status">Voice unavailable. Check the selected chat and current call.</p>}
		</fieldset>
	);
}
