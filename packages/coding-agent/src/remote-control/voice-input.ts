/** Pinned session/turn.rs and protocol/request_user_input.rs; see NOTICE.md. */
import { prompt } from "@f5-sales-demo/pi-utils";
import template from "../prompts/system/remote-voice-input.md" with { type: "text" };
import type { InteractionRequest } from "./interactions";

/** Convert the App Server request to the backing core event used as realtime context. */
export function voiceInputText(request: InteractionRequest, callId: string): string {
	const params = request.params;
	const questions = params.questions as Array<{
		id: string;
		header: string;
		question: string;
		isOther?: boolean;
		isSecret?: boolean;
		options?: unknown;
	}>;
	return prompt
		.render(template, {
			request: JSON.stringify({
				type: "request_user_input",
				call_id: callId,
				turn_id: params.turnId,
				questions: questions.map(question => ({
					id: question.id,
					header: question.header,
					question: question.question,
					isOther: question.isOther ?? false,
					isSecret: question.isSecret ?? false,
					...(question.options != null ? { options: question.options } : {}),
				})),
				isBlocking: params.isBlocking,
				...(params.autoResolutionMs != null ? { autoResolutionMs: params.autoResolutionMs } : {}),
			}),
		})
		.trimEnd();
}
