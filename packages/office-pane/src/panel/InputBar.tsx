/**
 * InputBar — Fluent textarea + Send/Stop controls.
 *
 * - Send calls onSend(text) and clears the input.
 * - While status === 'streaming': Send is disabled, Stop button is shown.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { Button, Textarea } from "@fluentui/react-components";
import { useState } from "react";

import type { ChatSessionResult } from "./useChatSession";

export interface InputBarProps {
	onSend: (text: string) => void;
	onStop: () => void;
	status: ChatSessionResult["status"];
}

export function InputBar({ onSend, onStop, status }: InputBarProps) {
	const [text, setText] = useState("");
	const isStreaming = status === "streaming";

	function handleSend() {
		const trimmed = text.trim();
		if (trimmed) {
			onSend(trimmed);
			setText("");
		}
	}

	return (
		<div>
			<Textarea
				aria-label="message input"
				value={text}
				onChange={e => setText(e.target.value)}
				onKeyDown={e => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						handleSend();
					}
				}}
			/>
			<Button onClick={handleSend} disabled={isStreaming}>
				Send
			</Button>
			{isStreaming && <Button onClick={onStop}>Stop</Button>}
		</div>
	);
}
