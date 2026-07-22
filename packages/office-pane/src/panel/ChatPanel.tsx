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
	Composer,
	type ComposerHandle,
	EmptyState,
	F5Logo,
	type SkillPill,
	Transcript,
} from "@f5-sales-demo/xcsh-chat-ui";
import { useMemo, useRef, useState } from "react";

import type { InteractionMode, Transport } from "../core";
import { MODE_OPTIONS, turnsToMessages } from "./adapt";
import { DEFAULT_INTERACTION_MODE, useChatSession } from "./useChatSession";

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

/** The F5-branded terminal header, shared by the chat and config-error views. */
function Header() {
	return (
		<div className="header">
			<F5Logo variant="mark" size={20} />
			<span className="header-title">xcsh</span>
		</div>
	);
}

/** Composer placeholder while the gateway connection is being established. */
const PROVISIONING_PLACEHOLDER: Record<string, string> = {
	connecting: "Connecting to xcsh…",
	configuring: "Configuring gateway…",
};

export function ChatPanel({ transport, provision, onConnected, onReconfigure }: ChatPanelProps) {
	const { turns, send, stop, retry, status, reason, error, provisioning, provisionError } = useChatSession(transport, {
		provision,
		onConnected,
	});
	const [mode, setMode] = useState<string>(DEFAULT_INTERACTION_MODE);
	const composerRef = useRef<ComposerHandle>(null);

	const messages = useMemo(() => turnsToMessages({ turns, status, reason, error }), [turns, status, reason, error]);
	const streaming = status === "streaming";

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
		/>
	);

	return (
		<>
			<Header />
			<Transcript messages={messages} streaming={streaming} onRetry={() => retry()} emptyState={emptyState} />
			<Composer
				ref={composerRef}
				streaming={streaming}
				disabled={!ready}
				placeholder={ready ? undefined : PROVISIONING_PLACEHOLDER[provisioning]}
				onSend={text => send(text, mode as InteractionMode)}
				onStop={stop}
				modes={MODE_OPTIONS}
				mode={mode}
				onModeChange={setMode}
			/>
		</>
	);
}
