import { useReducer, useState } from "react";
import { INPUT_COPY, type InputQuestion, type InputResponse } from "./contract";
import { QuestionForm } from "./question-form";

export interface QuestionCardProps {
	requestId: string;
	questions: readonly InputQuestion[];
	onRespond: (response: InputResponse) => Promise<{ accepted: boolean }>;
	onInterrupt: () => void;
}

/** Drafts remain within this component until the user explicitly submits. */
export function QuestionCard({ requestId, questions, onRespond, onInterrupt }: QuestionCardProps) {
	// A replayed snapshot has fresh object references; retain local drafts for this request.
	const [form] = useState(() => new QuestionForm(questions));
	const [, render] = useReducer((value: number, _action: null) => value + 1, 0);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const send = async (response: InputResponse) => {
		setSending(true);
		setError("");
		try {
			const receipt = await onRespond(response);
			if (!receipt.accepted) setError("This request is no longer available.");
		} catch {
			setError("Unable to send your answer. Try again.");
		} finally {
			setSending(false);
		}
	};
	const submit = () => {
		const result = form.submit();
		if (result.kind === "submitted") void send(result.response);
		render(null);
	};
	return (
		<section aria-label="User input" data-request-id={requestId}>
			{form.confirming ? (
				<>
					<h3>{INPUT_COPY.confirm}</h3>
					<button type="button" disabled={sending} onClick={() => void send(form.finish())}>
						{INPUT_COPY.proceed}
					</button>
					<button
						type="button"
						onClick={() => {
							form.goBack();
							render(null);
						}}
					>
						{INPUT_COPY.back}
					</button>
				</>
			) : (
				<>
					<header>
						{form.question.header} · {form.index + 1}/{questions.length}
					</header>
					<p>{form.question.question}</p>
					{form.options.map((option, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: Choices retain their source order and position for the lifetime of a request.
						<label key={`${index}:${option.label}`} style={{ display: "block" }}>
							<input
								type="radio"
								name={requestId}
								checked={form.draft.highlighted === index}
								onChange={() => {
									form.moveOption(index - form.draft.highlighted);
									render(null);
								}}
							/>
							{option.label}
							<small style={{ display: "block" }}>{option.description}</small>
						</label>
					))}
					<label>
						{form.options.length ? INPUT_COPY.notes : INPUT_COPY.answer}
						<textarea
							value={form.draft.notes}
							onChange={event => {
								form.editNotes(event.currentTarget.value);
								render(null);
							}}
						/>
					</label>
					{questions.length > 1 ? (
						<>
							<button
								type="button"
								onClick={() => {
									form.moveQuestion(-1);
									render(null);
								}}
							>
								Previous question
							</button>
							<button
								type="button"
								onClick={() => {
									form.moveQuestion(1);
									render(null);
								}}
							>
								Next question
							</button>
						</>
					) : null}
					<button type="button" disabled={sending} onClick={submit}>
						{sending
							? "Sending…"
							: form.index === questions.length - 1 && questions.length > 1
								? "Submit all"
								: "Submit answer"}
					</button>
					<button type="button" disabled={sending} onClick={onInterrupt}>
						Interrupt
					</button>
				</>
			)}
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
}

export function AsyncQuestionCard({
	title,
	options,
	onRespond,
}: {
	title: string;
	options?: readonly string[];
	onRespond: (answer: string) => Promise<{ accepted: boolean }>;
}) {
	const [choice, setChoice] = useState(options?.[0] ?? "");
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const submit = async () => {
		setSending(true);
		try {
			if (!(await onRespond(text || choice)).accepted) setError("This question is no longer available.");
		} catch {
			setError("Unable to send your answer. Try again.");
		} finally {
			setSending(false);
		}
	};
	return (
		<section aria-label="Pending question">
			<p>{title}</p>
			{options?.map((option, index) => (
				<button
					type="button"
					// biome-ignore lint/suspicious/noArrayIndexKey: Choices retain their source order and position for the lifetime of a request.
					key={`${index}:${option}`}
					aria-pressed={choice === option && !text}
					onClick={() => {
						setChoice(option);
						setText("");
					}}
				>
					{option}
				</button>
			))}
			<textarea aria-label="Your answer" value={text} onChange={event => setText(event.currentTarget.value)} />
			<button type="button" disabled={sending || !(text || choice).trim()} onClick={() => void submit()}>
				Submit answer
			</button>
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
}
