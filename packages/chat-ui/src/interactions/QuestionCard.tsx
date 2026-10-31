import { useCallback, useEffect, useReducer, useState } from "react";
import { INPUT_COPY, type InputQuestion, type InputResponse } from "./contract";
import { QuestionForm } from "./question-form";

export interface QuestionCardProps {
	requestId: string;
	questions: readonly InputQuestion[];
	isBlocking?: boolean;
	onRespond: (response: InputResponse) => Promise<{ accepted: boolean }>;
	onInterrupt: () => void;
}

/** Drafts remain within this component until the user explicitly submits. */
export function QuestionCard({ requestId, questions, onRespond, onInterrupt, isBlocking = true }: QuestionCardProps) {
	// A replayed snapshot has fresh object references; retain local drafts for this request.
	const [form] = useState(() => new QuestionForm(questions, isBlocking));
	const [, render] = useReducer((value: number, _action: null) => value + 1, 0);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const send = useCallback(
		async (response: InputResponse) => {
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
		},
		[onRespond],
	);
	const submit = () => {
		const result = form.submit();
		if (result.kind === "submitted") void send(result.response);
		render(null);
	};
	useEffect(() => {
		if (isBlocking) return;
		let settled = false;
		const timer = setInterval(() => {
			const response = form.tick(Date.now());
			if (response && !settled) {
				settled = true;
				void send(response);
			} else render(null);
		}, 1000);
		return () => clearInterval(timer);
	}, [form, isBlocking, send]);
	return (
		<section className="question-card" aria-label="User input" data-request-id={requestId}>
			{form.countdown(Date.now()) !== undefined ? (
				<p>Continuing automatically in {form.countdown(Date.now())}s</p>
			) : null}
			{form.confirming ? (
				<>
					<h3 className="question-title">{INPUT_COPY.confirm}</h3>
					<div className="question-actions">
						<button
							className="question-primary"
							type="button"
							disabled={sending}
							onClick={() => void send(form.finish())}
						>
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
					</div>
				</>
			) : (
				<>
					<div className="question-content">
						<header className="question-meta">
							<strong>{form.question.header}</strong>
							<span>
								{form.index + 1}/{questions.length}
							</span>
						</header>
						<p className="question-title" id={`${requestId}-question`}>
							{form.question.question}
						</p>
						<div className="question-options" role="radiogroup" aria-labelledby={`${requestId}-question`}>
							{form.options.map((option, index) => (
								<label
									// biome-ignore lint/suspicious/noArrayIndexKey: Choices retain their source order and position for the lifetime of a request.
									key={`${index}:${option.label}`}
									className={`question-option${form.draft.highlighted === index ? " selected" : ""}`}
								>
									<input
										type="radio"
										name={requestId}
										aria-labelledby={`${requestId}-option-${index}`}
										aria-describedby={`${requestId}-description-${index}`}
										checked={form.draft.highlighted === index}
										onChange={() => {
											form.selectOption(index);
											render(null);
										}}
									/>
									<span className="question-option-copy">
										<span id={`${requestId}-option-${index}`}>{option.label}</span>
										<small id={`${requestId}-description-${index}`}>{option.description}</small>
									</span>
								</label>
							))}
						</div>
						<label className="question-notes" htmlFor={`${requestId}-notes-${form.index}`}>
							<span>{form.options.length ? INPUT_COPY.notes : INPUT_COPY.answer}</span>
							{form.question.isSecret ? (
								<input
									id={`${requestId}-notes-${form.index}`}
									type="password"
									disabled={sending}
									value={form.draft.notes}
									onChange={event => {
										form.editNotes(event.currentTarget.value);
										render(null);
									}}
								/>
							) : (
								<textarea
									id={`${requestId}-notes-${form.index}`}
									rows={3}
									disabled={sending}
									value={form.draft.notes}
									onChange={event => {
										form.editNotes(event.currentTarget.value);
										render(null);
									}}
								/>
							)}
						</label>
					</div>
					<div className="question-footer">
						{questions.length > 1 ? (
							<div className="question-navigation">
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
							</div>
						) : null}
						<div className="question-actions">
							<button className="question-primary" type="button" disabled={sending} onClick={submit}>
								{sending
									? "Sending…"
									: form.index === questions.length - 1 && questions.length > 1
										? "Submit all"
										: "Submit answer"}
							</button>
							<button type="button" disabled={sending} onClick={onInterrupt}>
								Interrupt
							</button>
						</div>
					</div>
				</>
			)}
			{error ? (
				<p className="question-error" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}

export function AsyncQuestionCard({
	title,
	options,
	onRespond,
	onDismiss,
}: {
	title: string;
	options?: readonly string[];
	onRespond: (answer: string) => Promise<{ accepted: boolean }>;
	onDismiss?: () => void;
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
		<section className="question-card" aria-label="Pending question">
			<div className="question-content">
				<p className="question-title">{title}</p>
				<div className="question-options">
					{options?.map((option, index) => (
						<button
							className={`question-option${choice === option && !text ? " selected" : ""}`}
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
				</div>
				<label className="question-notes">
					<span>{options?.length ? "Custom answer (optional)" : "Your answer"}</span>
					<textarea
						aria-label="Your answer"
						rows={3}
						disabled={sending}
						value={text}
						onChange={event => setText(event.currentTarget.value)}
					/>
				</label>
			</div>
			<div className="question-actions">
				<button
					className="question-primary"
					type="button"
					disabled={sending || !(text || choice).trim()}
					onClick={() => void submit()}
				>
					Submit answer
				</button>
				{onDismiss ? (
					<button type="button" disabled={sending} onClick={onDismiss}>
						Answer later
					</button>
				) : null}
			</div>
			{error ? (
				<p className="question-error" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
