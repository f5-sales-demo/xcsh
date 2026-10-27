import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../../components/Composer";
import { Transcript } from "../../components/Transcript";
import { InteractionPanel } from "../../interactions/InteractionPanel";
import type { InteractionCommand } from "../../interactions/transport";
import { PANEL_CSS } from "../../theme/panel.css";
import type { ChatMessage } from "../../types";
import { isVoiceFrame, type VoiceFrame, type VoiceRequest } from "../contract";
import { VoiceControls } from "../VoiceControls";

const connectionKey = "xcsh.voice.connection";
function App() {
	const [token, setToken] = useState(() => location.hash.slice(1) || localStorage.getItem(connectionKey) || "");
	const [link, setLink] = useState("");
	const [reconnect, setReconnect] = useState(0);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [busy, setBusy] = useState(false);
	const clientId = useRef(crypto.randomUUID()),
		chatId = useRef<string | undefined>(undefined),
		turnId = useRef<string | undefined>(undefined);
	const socket = useRef<WebSocket | undefined>(undefined),
		queued = useRef<VoiceRequest[]>([]);
	const pendingUi = useRef<InteractionCommand[]>([]);
	const reconnectEpoch = useRef(0);
	const listeners = useRef(new Set<(message: unknown) => void>());
	const send = useCallback((message: VoiceRequest) => {
		const frame = { ...message, clientId: message.clientId ?? clientId.current };
		if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(frame));
		else if (
			message.action === "capabilities" ||
			message.action === "history" ||
			(message.action === "interaction" && message.command?.type === "interaction_snapshot")
		)
			queued.current.push(frame);
		else {
			setError("Connection is not ready. Check the current request before sending again.");
			if (message.action === "start")
				queueMicrotask(() => {
					for (const listener of listeners.current)
						listener({
							type: "voice_event",
							clientId: frame.clientId,
							chatId: frame.chatId ?? "",
							method: "xcsh/voice/error",
							params: { message: "Voice was not started" },
						});
				});
		}
	}, []);
	const transport = useMemo(
		() => ({
			send,
			onMessage: (listener: (message: unknown) => void) => {
				listeners.current.add(listener);
				return () => {
					listeners.current.delete(listener);
				};
			},
		}),
		[send],
	);
	const interactionTransport = useMemo(
		() => ({
			onMessage: transport.onMessage,
			send: (command: InteractionCommand) => {
				if (!chatId.current) {
					pendingUi.current.push(command);
					return;
				}
				send({
					type: "voice_request",
					action: "interaction",
					requestId: crypto.randomUUID(),
					chatId: chatId.current,
					command,
				});
			},
		}),
		[transport, send],
	);
	useEffect(() => {
		history.replaceState(null, "", location.pathname);
		reconnectEpoch.current = reconnect;
		const epoch = reconnect;
		if (!token) return;
		localStorage.setItem(connectionKey, token);
		const channel = new WebSocket(`${location.origin.replace(/^https:/, "wss:")}/events`);
		socket.current = channel;
		let retired = false;
		const publish = (value: unknown) => {
			for (const listener of listeners.current) listener(value);
		};
		const refresh = () => {
			if (chatId.current)
				send({ type: "voice_request", action: "history", requestId: crypto.randomUUID(), chatId: chatId.current });
		};
		channel.addEventListener("open", () => {
			channel.send(JSON.stringify({ type: "voice_hello", token }));
			channel.send(
				JSON.stringify({
					type: "voice_request",
					action: "capabilities",
					requestId: crypto.randomUUID(),
					clientId: clientId.current,
				}),
			);
			for (const message of queued.current.splice(0)) channel.send(JSON.stringify(message));
			setConnected(true);
			setError("");
		});
		channel.addEventListener("message", event => {
			if (epoch !== reconnectEpoch.current) return;
			try {
				const frame = JSON.parse(String(event.data));
				if (!isVoiceFrame(frame)) return;
				publish(frame);
				if (frame.method === "xcsh/voice/ui") publish(frame.params.frame);
				if (frame.method === "xcsh/interaction/event") {
					const value = frame.params.event as { revision: number; type: string; interaction: unknown };
					publish({ type: "interaction_event", revision: value.revision, event: value });
				}
				if (frame.method === "xcsh/interaction/plan") publish(frame.params.event);
				if (frame.method === "xcsh/voice/capabilities" && frame.clientId === clientId.current) {
					chatId.current = frame.chatId;
					refresh();
					for (const command of pendingUi.current.splice(0)) interactionTransport.send(command);
				}
				if (frame.method === "turn/started") {
					setBusy(true);
					turnId.current = String((frame.params.turn as { id?: unknown })?.id ?? "");
				}
				if (frame.method === "turn/completed") {
					setBusy(false);
					refresh();
				}
				if (frame.method === "item/agentMessage/delta") {
					const id = String(frame.params.itemId),
						delta = String(frame.params.delta ?? "");
					setMessages(current => {
						const existing = current.find(item => item.id === id);
						return existing
							? current.map(item => (item.id === id ? { ...item, text: item.text + delta } : item))
							: [...current, { id, role: "assistant", text: delta }];
					});
				}
				if (frame.method === "thread/realtime/closed" || frame.method === "thread/realtime/transcript/done")
					refresh();
				if (frame.method === "xcsh/voice/history" && frame.clientId === clientId.current) {
					const result = frame.params.result as { thread?: { turns?: { items?: Record<string, unknown>[] }[] } };
					const transcript: ChatMessage[] = [];
					for (const turn of result.thread?.turns ?? [])
						for (const item of turn.items ?? []) {
							if (item.type === "agentMessage" && typeof item.text === "string")
								transcript.push({ id: String(item.id), role: "assistant", text: item.text });
							if (item.type === "userMessage" && Array.isArray(item.content))
								transcript.push({
									id: String(item.id),
									role: "user",
									text: item.content
										.filter(part => part.type === "text")
										.map(part => part.text)
										.join("\n"),
								});
						}
					setMessages(transcript);
				}
			} catch {
				setError("Connection data could not be read.");
			}
		});
		channel.addEventListener("close", () => {
			if (retired) return;
			publish({
				type: "voice_event",
				chatId: chatId.current ?? "",
				method: "xcsh/voice/error",
				params: { message: "Connection ended. Activate again to reconnect." },
			} satisfies VoiceFrame);
			setConnected(false);
			setError("Connection ended. Reconnect deliberately; audio stays off.");
		});
		const hide = () => {
			channel.close();
		};
		window.addEventListener("pagehide", hide);
		return () => {
			retired = true;
			window.removeEventListener("pagehide", hide);
			channel.close();
		};
	}, [token, reconnect, send, interactionTransport.send]);
	const recover = () => {
		try {
			const value = new URL(link);
			if (value.origin !== location.origin || !/^[A-Za-z0-9_-]{43}$/.test(value.hash.slice(1)))
				throw new Error("Wrong connection");
			setToken(value.hash.slice(1));
			setLink("");
		} catch {
			setError("Use the connection link for this selected chat.");
		}
	};
	return (
		<>
			<h1>xcsh</h1>
			<p>Keep the parent chat open. Voice and typing use its selected workspace and tools.</p>
			{!connected && (
				<>
					<label>
						Connection recovery link{" "}
						<input type="password" value={link} onChange={event => setLink(event.currentTarget.value)} />
					</label>
					<button type="button" onClick={recover}>
						Connect
					</button>
					<button
						type="button"
						onClick={() => {
							setReconnect(value => value + 1);
						}}
					>
						Reconnect
					</button>
				</>
			)}
			{error && <p role="status">{error}</p>}
			<VoiceControls transport={transport} ready={connected} />
			<Transcript messages={messages} streaming={busy} />
			<InteractionPanel transport={interactionTransport} />
			<Composer
				streaming={busy}
				disabled={!connected}
				onSend={text => {
					if (chatId.current)
						send({
							type: "voice_request",
							action: "text",
							requestId: crypto.randomUUID(),
							chatId: chatId.current,
							text,
						});
				}}
				onStop={() => {
					if (chatId.current && turnId.current)
						send({
							type: "voice_request",
							action: "cancel",
							requestId: crypto.randomUUID(),
							chatId: chatId.current,
							turnId: turnId.current,
						});
				}}
			/>
		</>
	);
}
const css = document.createElement("style");
css.textContent = PANEL_CSS;
document.head.append(css);
createRoot(document.querySelector("#app")!).render(<App />);
