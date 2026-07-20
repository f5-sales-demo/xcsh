/**
 * ChatPanel — streaming chat shell component.
 *
 * Browser-safe: no node:* imports, no Office.js.
 * Concrete transports are injected via props — not imported here.
 */

import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import type { Transport } from "../core";
import { ErrorBanner } from "./ErrorBanner";
import { InputBar } from "./InputBar";
import { MessageList } from "./MessageList";
import { useChatSession } from "./useChatSession";

export interface ChatPanelProps {
	transport: Transport;
	/** Fired once after the transport connects — e.g. to advertise host tools. */
	onConnected?: () => void;
}

export function ChatPanel({ transport, onConnected }: ChatPanelProps) {
	const { turns, send, stop, retry, status, reason, error } = useChatSession(transport, onConnected);

	return (
		<FluentProvider theme={webLightTheme}>
			<div role="log" aria-label="conversation" aria-live="polite">
				<MessageList turns={turns} />
			</div>
			{/* Render on any error — ErrorBanner falls back to raw text / a generic
          message when no reason is classified, so the state is never silent. */}
			{status === "error" && <ErrorBanner reason={reason} error={error} onRetry={retry} />}
			<InputBar onSend={send} onStop={stop} status={status} />
		</FluentProvider>
	);
}
