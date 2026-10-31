import { expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { AnswerRecapView } from "../src/interactions/AnswerRecapView";
import { questionToolRecap, recapText } from "../src/interactions/answer-recap";

test("a rejected question request does not imply a failed answer delivery", () => {
	const args = { questions: [{ title: "What notes should be preserved?", options: [] }] };
	const rejected = questionToolRecap(
		"request_user_input_async",
		args,
		'Validation failed for tool "request_user_input_async": options must not be empty',
		false,
		false,
	)!;
	const text = recapText(rejected.recap);
	expect(text).toContain("Question request failed");
	expect(text).toContain("What notes should be preserved?");
	expect(text).not.toContain("Delivery failed");
	expect(text).not.toContain("No answer provided");
	const retry = questionToolRecap(
		"request_user_input_async",
		{ questions: [{ title: "What notes should be preserved?" }] },
		'{"accepted":true}',
	)!;
	render(
		<>
			<AnswerRecapView {...rejected} />
			<AnswerRecapView {...retry} />
		</>,
	);
	expect(screen.getByText("Question request failed")).toBeTruthy();
	expect(screen.getByText("Questions asked")).toBeTruthy();
	expect(screen.getAllByText("What notes should be preserved?")).toHaveLength(2);
	expect(screen.queryByText(/No answer provided/)).toBeNull();
});

test("rejected secret questions retain safe expansion without raw validation payloads", () => {
	const rejected = questionToolRecap(
		"request_user_input",
		{ questions: [{ id: "secret", header: "Token", question: "Which token?", isSecret: true, options: [{ label: "private-option", description: "private-description" }] }] },
		'Validation failed for tool "request_user_input": received private-token-value',
		false,
		false,
	)!;
	render(<AnswerRecapView {...rejected} />);
	const details = screen.getByText("Details").parentElement as HTMLDetailsElement;
	details.open = true;
	fireEvent(details, new Event("toggle"));
	expect(screen.getByText("Which token?")).toBeTruthy();
	expect(document.body.textContent).not.toContain("private-");
	expect(rejected.evidence).toContain("Which token?");
	expect(rejected.evidence).not.toContain("private-");
});
