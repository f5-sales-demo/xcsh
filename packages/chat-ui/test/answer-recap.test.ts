import { expect, test } from "bun:test";
import {
	answerRecap,
	asyncReplyRecap,
	recapText,
	safeQuestionEvidence,
	unseenAnswerRecap,
} from "../src/interactions/answer-recap";

const questions = [
	{
		id: "audience",
		header: "Audience",
		question: "Who is this for?",
		options: [
			{ label: "Developers (Recommended)", description: "Prioritizes compatibility; requires more detail." },
			{ label: "Leaders", description: "Focuses on decisions." },
		],
	},
	{
		id: "format",
		header: "Format",
		question: "What format?",
		options: [{ label: "Email", description: "Brief; limited technical depth." }],
	},
];

test("recaps match original labels before cleanup and separate notes in question order", () => {
	const response = {
		answers: {
			format: { answers: ["Email"] },
			audience: { answers: ["Developers (Recommended)", "user_note: Keep **literal** punctuation."] },
		},
	};
	const recap = answerRecap(questions, response, "recorded");
	expect(recap.rows.map(row => row.topic)).toEqual(["Audience", "Format"]);
	expect(recap.rows[0]).toMatchObject({
		answer: "Developers",
		description: questions[0].options[0].description,
		notes: "Keep **literal** punctuation.",
	});
	expect(JSON.stringify(response)).toContain("Developers (Recommended)");
	expect(recapText(recap)).not.toContain("answers.audience");
});

test("custom text remains exact, with no inferred tradeoff or stripped note-like literal", () => {
	const text = "user_note: 東京 — 'quoted' `code` $(touch nope)\n  indented\nlast";
	const recap = answerRecap(questions, { answers: { audience: { answers: ["user_note: " + text] } } }, "queued");
	expect(recap.rows[0]).toMatchObject({ topic: "Who is this for?", answer: text });
	expect(recap.rows[0].description).toBeUndefined();
	expect(recap.rows[1].answer).toBe("No answer provided");
	expect(recapText(recap)).toContain("Queued for the next model response");
});

test("secret answers and notes are masked in both recap and expanded payload", () => {
	const secret = [{ ...questions[0], isSecret: true }];
	const response = { answers: { audience: { answers: ["private-secret", "user_note: private-note"] } } };
	expect(JSON.stringify(answerRecap(secret, response, "failed"))).not.toContain("private");
	expect(safeQuestionEvidence(secret, response)).not.toContain("private");
	expect(recapText(answerRecap(secret, response, "failed"))).toContain("Delivery failed");
});

test("multi-answer async envelopes preserve all framing, exact text and original order", () => {
	const raw =
		"<send_user_message_question_reply>\n" +
		JSON.stringify([
			{ questionItemId: "b", question: "Second?", answer: "東京\n  details" },
			{ questionItemId: "a", question: "First?", answer: "Developers (Recommended)" },
		]) +
		"\n</send_user_message_question_reply>";
	const recap = asyncReplyRecap(
		raw,
		[
			{ id: "a", header: "Audience", question: "First?", options: questions[0].options },
			{ id: "b", header: "Details", question: "Second?" },
		],
		"queued",
	);
	expect(recap?.rows.map(row => row.answer)).toEqual(["Developers", "東京\n  details"]);
	expect(recap?.rows[0].description).toBe(questions[0].options[0].description);
	expect(recapText(recap!)).not.toContain("send_user_message_question_reply");
});

test("submission retries deduplicate by question identity without dropping other answers in the batch", () => {
	const first = { state: "recorded" as const, rows: [{ id: "one", topic: "A", question: "A?", answer: "First" }] };
	const seen = new Set<string>();
	expect(unseenAnswerRecap(first, seen)).toEqual(first);
	expect(unseenAnswerRecap(first, seen)).toBeUndefined();
	const second = { ...first, rows: [...first.rows, { id: "two", topic: "B", question: "B?", answer: "Second" }] };
	expect(unseenAnswerRecap(second, seen)?.rows.map(row => row.id)).toEqual(["two"]);
});

test("None of the above presents exact custom answer against the full question", () => {
	const text = "東京\n  $(printf noop)";
	const recap = answerRecap(
		[{ ...questions[0], isOther: true }],
		{
			answers: { audience: { answers: ["None of the above", "user_note: " + text] } },
		},
		"recorded",
	);
	expect(recap.rows[0]).toMatchObject({ topic: "Who is this for?", answer: text });
	expect(recap.rows[0].notes).toBeUndefined();
	expect(recap.rows[0].description).toBeUndefined();
});

test("legacy history replies have readable presentation with known secret masking", () => {
	const raw = JSON.stringify({ type: "user_input_reply", itemId: "call", questionId: "audience", answer: "private" });
	const recap = asyncReplyRecap(raw, [{ ...questions[0], isSecret: true }]);
	expect(recap?.rows[0].answer).toBe("Answer hidden");
	expect(JSON.stringify(recap)).not.toContain("private");
});

test("question delivery failures stay distinct from interruptions and unknown context hides payload", async () => {
	const { questionToolRecap } = await import("../src/interactions/answer-recap");
	const args = { questions };
	expect(questionToolRecap("request_user_input", args, "Transport disconnected", false, false)?.recap.state).toBe(
		"failed",
	);
	expect(questionToolRecap("request_user_input", args, "Interrupted", false, false)?.recap.state).toBe("interrupted");
	const unknown = questionToolRecap(
		"request_user_input",
		undefined,
		'{"answers":{"password":{"answers":["private"]}}}',
	);
	expect(JSON.stringify(unknown)).not.toContain("private");
	expect(unknown?.evidence).toContain("payload hidden");
});

test("duplicate identities within a submitted envelope render once", () => {
	const value = { id: "one", topic: "Topic", question: "Question?", answer: "Answer" };
	const recap = { state: "recorded" as const, rows: [value, value] };
	expect(unseenAnswerRecap(recap, new Set())?.rows).toHaveLength(1);
});
