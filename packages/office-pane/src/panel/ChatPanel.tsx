/**
 * ChatPanel — the streaming chat shell, rendered entirely with the shared
 * `@f5-sales-demo/xcsh-chat-ui` terminal components (Fluent is gone).
 *
 * It owns no transport/protocol logic: {@link useChatSession} folds the injected
 * transport's stream into turns, {@link turnsToMessages} projects those onto the
 * shared `ChatMessage[]`, and the shared `Transcript`/`Composer` render them. A
 * clicked starter pill PREFILLS the composer (via the Phase-2 `ComposerHandle`
 * seam) for the user to edit and send — matching Claude-for-Office, not
 * send-immediately.
 *
 * Browser-safe: no node:* imports, no Office.js. The transport is injected.
 */
import {
	type AttachCategory,
	type Attachment,
	addAttachment,
	Composer,
	type ComposerHandle,
	EmptyState,
	F5Logo,
	type ImageAttachment,
	isImageAttachment,
	type SkillPill,
	Transcript,
} from "@f5-sales-demo/xcsh-chat-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatImageMsg, Transport } from "../core";
import { turnsToMessages } from "./adapt";
import { useChatSession } from "./useChatSession";

/** The composer `+` menu categories. Today: photos/images (Add files or photos). */
const ATTACH_CATEGORIES: readonly AttachCategory[] = [
	{ id: "image", label: "Add files or photos", description: "Attach a photo or image" },
];

/** Image types the vision model accepts (Anthropic: png/jpeg/gif/webp). */
const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** Read a picked file into an {@link ImageAttachment} (base64, no data-URL prefix).
 *  Resolves null on read error or empty data so a bad file is skipped, not crashed. */
function readImageAttachment(file: File): Promise<ImageAttachment | null> {
	return new Promise(resolve => {
		const reader = new FileReader();
		reader.onerror = () => resolve(null);
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			const data = comma >= 0 ? result.slice(comma + 1) : "";
			if (!data) {
				resolve(null);
				return;
			}
			const dedupKey = `image:${file.name}:${file.size}`;
			resolve({
				id: dedupKey,
				kind: "image",
				label: file.name,
				dedupKey,
				content: "", // images ride chat_request.images, never the prompt text
				mimeType: file.type || "image/png",
				data,
			});
		};
		reader.readAsDataURL(file);
	});
}

export interface ChatPanelProps {
	transport: Transport;
	/**
	 * Point xcsh's provider at the saved gateway before chat is enabled. Runs after
	 * connect(); a rejection gates chat and shows the config-error recovery view.
	 */
	provision?: () => Promise<void>;
	/** Fired once after provisioning succeeds — e.g. to advertise host tools. */
	onConnected?: () => void;
	/** Recovery action for a configure failure — reopens the gateway config form. */
	onReconfigure?: () => void;
	/**
	 * Fired once per error episode when a chat turn fails because the configured
	 * provider rejected the request (`provider-4xx` — a bad/absent gateway token),
	 * so the host can auto-open the gateway config. Distinct from `onReconfigure`
	 * (a connect-time `configure` rejection).
	 */
	onProviderConfigError?: () => void;
}

/** Host-agnostic starter prompts; picking one prefills (not sends) the composer. */
const STARTERS: readonly (SkillPill & { text: string })[] = [
	{ id: "explain", label: "Explain the selection", hint: "Prefill a prompt", text: "Explain the current selection." },
	{
		id: "improve",
		label: "Improve the wording",
		hint: "Prefill a prompt",
		text: "Improve the wording of the selected text.",
	},
	{ id: "summarize", label: "Summarize", hint: "Prefill a prompt", text: "Summarize this document." },
];

/** The F5-branded terminal header, shared by the chat and config-error views.
 *  When `onNewChat` is supplied, a "New chat" affordance resets the conversation. */
function Header({ onNewChat, canNewChat }: { onNewChat?: () => void; canNewChat?: boolean } = {}) {
	return (
		<div className="header">
			<F5Logo variant="mark" size={20} />
			<span className="header-title">xcsh</span>
			{onNewChat ? (
				<button
					type="button"
					className="header-new-chat"
					onClick={onNewChat}
					disabled={!canNewChat}
					title="Start a new chat"
					aria-label="New chat"
				>
					New chat
				</button>
			) : null}
		</div>
	);
}

/** Composer placeholder while the gateway connection is being established. */
const PROVISIONING_PLACEHOLDER: Record<string, string> = {
	connecting: "Connecting to xcsh…",
	configuring: "Configuring gateway…",
};

export function ChatPanel({ transport, provision, onConnected, onReconfigure, onProviderConfigError }: ChatPanelProps) {
	const { turns, send, stop, retry, newChat, status, reason, error, provisioning, provisionError } = useChatSession(
		transport,
		{ provision, onConnected },
	);
	const composerRef = useRef<ComposerHandle>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// Photo/image attachments staged for the next send. The host owns this state and
	// clears it in onSend (per the shared Composer's host-maps-its-own-state contract).
	const [attachments, setAttachments] = useState<Attachment[]>([]);

	const messages = useMemo(() => turnsToMessages({ turns, status, reason, error }), [turns, status, reason, error]);
	const streaming = status === "streaming";

	// `+` category pick: "image" opens the hidden file input; the browser file picker
	// is the only way to attach a local file from an Office task-pane WebView.
	const handleRequestAttachment = useCallback((categoryId: string) => {
		if (categoryId === "image") fileInputRef.current?.click();
	}, []);

	const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		// Allow re-picking the same file later by clearing the input value.
		e.target.value = "";
		const read = await Promise.all(files.map(readImageAttachment));
		setAttachments(prev => {
			let next = prev;
			for (const img of read) {
				if (img) next = addAttachment(next, img).list;
			}
			return next;
		});
	}, []);

	const handleRemoveAttachment = useCallback((id: string) => {
		setAttachments(prev => prev.filter(a => a.id !== id));
	}, []);

	const handleSend = useCallback(
		(text: string) => {
			const images: ChatImageMsg[] = attachments
				.filter(isImageAttachment)
				.map(a => ({ data: a.data, mimeType: a.mimeType }));
			send(text, images.length > 0 ? { images } : undefined);
			setAttachments([]);
		},
		[attachments, send],
	);

	// Auto-open the gateway config when a turn fails because the configured provider
	// rejected us (provider-4xx = bad/absent gateway token). Fire once per episode;
	// a subsequent retry (status leaves 'error') re-arms it.
	const providerRejected = status === "error" && reason === "provider-4xx";
	const promptedRef = useRef(false);
	useEffect(() => {
		if (providerRejected && !promptedRef.current) {
			promptedRef.current = true;
			onProviderConfigError?.();
		} else if (!providerRejected) {
			promptedRef.current = false;
		}
	}, [providerRejected, onProviderConfigError]);

	// A rejected provider `configure` is a non-silent, recoverable state: show the
	// reason and a Reconfigure action instead of a chat that would silently talk to
	// xcsh's baked-in default provider. #2134.
	if (provisioning === "error") {
		return (
			<>
				<Header />
				<div className="gateway-config-error" role="alert">
					<p className="gateway-config-error-title">Couldn't configure the gateway.</p>
					<p className="gateway-config-error-detail">
						{provisionError ?? "The provider configuration was rejected."}
					</p>
					<button type="button" className="msg-retry" onClick={() => onReconfigure?.()}>
						Reconfigure
					</button>
				</div>
			</>
		);
	}

	// Chat is gated until provisioning resolves so a turn can't race `configure_ack`.
	const ready = provisioning === "ready";

	const emptyState = (
		<EmptyState
			pills={STARTERS.map(({ id, label, hint }) => ({ id, label, hint }))}
			onPick={id => composerRef.current?.setText(STARTERS.find(s => s.id === id)?.text ?? "")}
			// The persistent Header already shows the F5 brand — don't duplicate it here.
			logo={false}
		/>
	);

	return (
		<>
			{/* New chat stays available WHILE streaming — it aborts the in-flight turn
			    (chat_stop) and resets, so a wedged turn is recoverable without a restart. */}
			<Header onNewChat={newChat} canNewChat={ready && turns.length > 0} />
			<Transcript messages={messages} streaming={streaming} onRetry={() => retry()} emptyState={emptyState} />
			{/* Hidden file input backing the "+" → "Add files or photos" category —
			    Office.js exposes no native picker, so a task-pane WebView uses this. */}
			<input
				ref={fileInputRef}
				type="file"
				accept={IMAGE_ACCEPT}
				multiple
				style={{ display: "none" }}
				aria-hidden="true"
				tabIndex={-1}
				onChange={handleFiles}
			/>
			{/* No interaction-mode toggle: those modes are Chrome browser-automation
			    only. The Office pane fixes the mode to `educational` (see useChatSession). */}
			<Composer
				ref={composerRef}
				streaming={streaming}
				disabled={!ready}
				placeholder={ready ? undefined : PROVISIONING_PLACEHOLDER[provisioning]}
				onSend={handleSend}
				onStop={stop}
				attachCategories={[...ATTACH_CATEGORIES]}
				attachments={attachments}
				onRequestAttachment={handleRequestAttachment}
				onRemoveAttachment={handleRemoveAttachment}
			/>
		</>
	);
}
