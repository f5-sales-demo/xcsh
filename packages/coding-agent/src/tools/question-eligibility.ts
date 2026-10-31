import type { Model } from "@f5-sales-demo/pi-ai";

export function asyncQuestionsSupported(model: Model | undefined, taskDepth = 0): boolean {
	// xcsh owns question lifecycles and queues accepted replies at model boundaries.
	// Ordinary provider APIs do not need a native experimental-tool declaration.
	return (
		taskDepth === 0 &&
		Boolean(
			model?.api ||
				model?.experimentalSupportedTools?.some(
					name => name === "request_user_input_async" || name === "send_user_message_async",
				),
		)
	);
}
