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
	/** Fired once after the transport connects — e.g. to advertise host tools. */
	onConnected?: () => void;
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

export function ChatPanel({ transport, onConnected }: ChatPanelProps) {
	const { turns, send, stop, retry, status, reason, error } = useChatSession(transport, onConnected);
	const [mode, setMode] = useState<string>(DEFAULT_INTERACTION_MODE);
	const composerRef = useRef<ComposerHandle>(null);

	const messages = useMemo(() => turnsToMessages({ turns, status, reason, error }), [turns, status, reason, error]);
	const streaming = status === "streaming";

	const emptyState = (
		<EmptyState
			pills={STARTERS.map(({ id, label, hint }) => ({ id, label, hint }))}
			onPick={id => composerRef.current?.setText(STARTERS.find(s => s.id === id)?.text ?? "")}
		/>
	);

	return (
		<>
			<div className="header">
				<F5Logo variant="mark" size={20} />
				<span className="header-title">xcsh</span>
			</div>
			<Transcript messages={messages} streaming={streaming} onRetry={() => retry()} emptyState={emptyState} />
			<Composer
				ref={composerRef}
				streaming={streaming}
				onSend={text => send(text, mode as InteractionMode)}
				onStop={stop}
				modes={MODE_OPTIONS}
				mode={mode}
				onModeChange={setMode}
			/>
		</>
	);
}
