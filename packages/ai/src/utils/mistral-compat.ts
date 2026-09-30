import type { Context, DeveloperMessage, Tool } from "../types";
import { adaptSchemaForStrict } from "./schema";
export function shortHash(value: string): string {
	return Bun.hash(value).toString(36);
}
export function getPiUserAgent(): string {
	return "xcsh";
}
export function getSystemMessageText(message: DeveloperMessage): string {
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter(item => item.type === "text")
				.map(item => item.text)
				.join("\n");
}
export const renderSystemMessageUpdate = getSystemMessageText;
export function resolveTranscript(context: Context, _supported?: boolean): Context {
	return {
		...context,
		messages: context.systemPrompt
			? [{ role: "developer", content: context.systemPrompt, timestamp: 0 }, ...context.messages]
			: context.messages,
	};
}
export function getJsonSchemaToolParameters(tool: Tool, strict?: boolean): Tool["parameters"] {
	return adaptSchemaForStrict(tool.parameters, strict ?? false).schema as Tool["parameters"];
}
export function resolveJsonSchemaStrictSampling(tool: Tool, supported: boolean): boolean | undefined {
	const config = tool.constrainedSampling || undefined;
	if (config?.type !== "json_schema") return undefined;
	if (!supported && config.strict === "require") throw new Error("Strict tools unsupported");
	return supported ? true : undefined;
}
