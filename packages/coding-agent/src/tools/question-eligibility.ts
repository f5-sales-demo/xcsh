import type { Model } from "@f5-sales-demo/pi-ai";

export function asyncQuestionsSupported(model: Model | undefined, taskDepth = 0): boolean {
	return (
		taskDepth === 0 &&
		(model?.experimentalSupportedTools?.some(
			name => name === "request_user_input_async" || name === "send_user_message_async",
		) ??
			false)
	);
}
