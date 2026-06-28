import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { StringEnum } from "@f5-sales-demo/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { isProfileName } from "../browser/presentation-profile";
import type { ToolSession } from "./index";
import { ToolError } from "./tool-errors";

const setPresentationProfileSchema = Type.Object(
	{
		profile: StringEnum(["fast", "guided", "instructor", "capture"], {
			description: "Presentation profile to apply for this session: fast | guided | instructor | capture",
		}),
	},
	{ additionalProperties: false },
);

type SetPresentationProfileParams = Static<typeof setPresentationProfileSchema>;

export class SetPresentationProfileTool implements AgentTool<typeof setPresentationProfileSchema, { profile: string }> {
	readonly name = "set_presentation_profile";
	readonly label = "SetPresentationProfile";
	readonly description =
		"Set the browser presentation profile for this session (fast, guided, instructor, or capture). Controls pacing, annotations, narration, and capture behaviour.";
	readonly parameters = setPresentationProfileSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		{ profile }: SetPresentationProfileParams,
	): Promise<AgentToolResult<{ profile: string }>> {
		if (!isProfileName(profile)) {
			throw new ToolError(`Invalid profile "${profile}". Must be one of: fast, guided, instructor, capture.`);
		}
		this.session.settings.set("browser.presentation", profile);
		return {
			content: [{ type: "text", text: `Presentation profile set to "${profile}".` }],
			details: { profile },
		};
	}
}
