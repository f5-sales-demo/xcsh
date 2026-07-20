/**
 * MessageList — renders an ordered list of user and assistant turns.
 *
 * Browser-safe: no node:* imports, no Office.js.
 */
import { Text } from "@fluentui/react-components";

import type { Turn } from "./useChatSession";

export interface MessageListProps {
	turns: Turn[];
}

export function MessageList({ turns }: MessageListProps) {
	if (turns.length === 0) {
		return (
			<section aria-label="empty state">
				<Text italic>Start a conversation or bind a context to get started.</Text>
			</section>
		);
	}

	return (
		<div>
			{turns.map(turn => {
				if (turn.kind === "user") {
					return (
						<article key={turn.id} aria-label="user message">
							<Text weight="semibold">{turn.text}</Text>
						</article>
					);
				}
				return (
					<article key={turn.state.id} aria-label="assistant message">
						<Text>{turn.state.text}</Text>
					</article>
				);
			})}
		</div>
	);
}
