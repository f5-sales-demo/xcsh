import { beforeAll, expect, test } from "bun:test";
import { visibleWidth } from "@f5-sales-demo/pi-tui";
import { PlanPreviewComponent } from "../src/modes/components/plan-preview";
import { QuestionTranscriptComponent } from "../src/modes/components/question-transcript";
import { TranscriptNoticeComponent } from "../src/modes/components/transcript-notice";
import { setTheme } from "../src/modes/theme/theme";

beforeAll(async () => setTheme("xcsh-dark"));
const prose = `${Array.from({ length: 60 }, (_, i) => `word${i} café 東京`).join(" ")} PROSE-END`;
const inspect = (lines: string[]) => {
	expect(lines.every(line => visibleWidth(line) <= 40)).toBe(true);
	const plain = Bun.stripANSI(lines.join("\n"));
	for (let i = 0; i < 60; i++) expect(plain).toContain(`word${i}`);
	expect(plain).toContain("PROSE-END");
};
test("retains complete static notices and plan prose in the scrollable transcript", () => {
	inspect(new TranscriptNoticeComponent("Notice", "Context", prose).render(40));
	inspect(new PlanPreviewComponent(prose).render(40));
});
test("retains complete pending questions and recorded answers", () => {
	inspect(
		QuestionTranscriptComponent.pending({
			id: "synthetic",
			type: "agentMessage",
			text: prose,
			phase: "final_answer",
			delivery: "async",
			questions: [{ title: prose }],
		}).render(40),
	);
	inspect(
		QuestionTranscriptComponent.answered({
			question: { title: prose },
			reply: { type: "user_input_reply", itemId: "synthetic", questionId: "q", answer: prose },
			position: 0,
			total: 1,
		}).render(40),
	);
});
