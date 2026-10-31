import { useEffect, useRef, useState } from "react";
import { AnswerRecapView } from "./AnswerRecapView";
import type { AnswerRecap, AnswerRecapRecord } from "./answer-recap";
import type { ConversationPlan } from "./conversation-plan";
import { PlanDecision } from "./PlanDecision";
import { AsyncQuestionCard, QuestionCard } from "./QuestionCard";
import { type InteractionCommand, isInteractionFrame, type PendingInteraction } from "./transport";

export interface InteractionTransport {
	send(message: InteractionCommand): void;
	onMessage(callback: (message: unknown) => void): () => void;
}
export function InteractionPanel({
	transport,
	onFollowTranscript,
	onPresentation,
}: {
	transport: InteractionTransport;
	onFollowTranscript?: () => void;
	onPresentation?: (record: AnswerRecapRecord, fromSnapshot: boolean) => void;
}) {
	const [pending, setPending] = useState<PendingInteraction[]>([]);
	const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
	const [presented, setPresented] = useState<Set<string>>(() => new Set());
	const [plan, setPlan] = useState<ConversationPlan>();
	const [failures, setFailures] = useState<Map<string, string>>(() => new Map());
	const [recaps, setRecaps] = useState<Map<string, { recap: AnswerRecap; evidence?: string }>>(() => new Map());
	const presentationReceiver = useRef(onPresentation);
	presentationReceiver.current = onPresentation;
	const revision = useRef(-1);
	const sessionId = useRef<string | undefined>(undefined);
	const attempts = useRef(new Map<string, { serialized: string; responseId: string }>());
	const receipts = useRef(
		new Map<
			string,
			{
				resolve: (result: { accepted: boolean }) => void;
				reject: (error: Error) => void;
				timer: ReturnType<typeof setTimeout>;
			}
		>(),
	);
	useEffect(() => {
		revision.current = -1;
		sessionId.current = undefined;
		setPending([]);
		setDismissed(new Set());
		setPresented(new Set());
		setPlan(undefined);
		setFailures(new Map());
		setRecaps(new Map());
		attempts.current.clear();
		const unsubscribe = transport.onMessage(message => {
			if (!isInteractionFrame(message)) return;
			if (message.type === "interaction_snapshot") {
				if (sessionId.current !== message.sessionId) {
					sessionId.current = message.sessionId;
					setDismissed(new Set());
					setPresented(new Set());
					setFailures(new Map());
					setRecaps(new Map());
					revision.current = -1;
					attempts.current.clear();
					for (const receipt of receipts.current.values()) {
						clearTimeout(receipt.timer);
						receipt.reject(new Error("Conversation changed"));
					}
					receipts.current.clear();
				}
				if (message.revision < revision.current) return;
				revision.current = message.revision;
				setPending(message.pending);
				setPlan(message.plan);
				for (const record of message.presentations ?? []) {
					setRecaps(current =>
						new Map(current).set(record.id, { recap: record.recap, evidence: record.evidence }),
					);
					presentationReceiver.current?.(record, true);
				}
			} else if (message.type === "interaction_error") {
				setFailures(current => new Map(current).set(message.failureId ?? message.itemId, message.message));
			} else if (message.type === "interaction_event") {
				if (message.revision <= revision.current) return;
				if (message.revision !== revision.current + 1) {
					transport.send({ type: "interaction_snapshot" });
					return;
				}
				revision.current = message.revision;
				if (message.event.presentation) {
					presentationReceiver.current?.(
						{
							id: message.event.interaction.id,
							recap: message.event.presentation,
							evidence: message.event.presentationEvidence,
							toolCallId: message.event.interaction.identity?.itemId,
						},
						false,
					);
					setRecaps(current =>
						new Map(current).set(message.event.interaction.id, {
							recap: message.event.presentation!,
							evidence: message.event.presentationEvidence,
						}),
					);
				}

				setPending(current =>
					message.event.type === "opened"
						? [...current.filter(value => value.id !== message.event.interaction.id), message.event.interaction]
						: current.filter(value => value.id !== message.event.interaction.id),
				);
			} else if (message.type === "plan_available") setPlan(message.plan);
			else if (message.type === "plan_resolved")
				setPlan(current => (current?.id === message.planId ? undefined : current));
			else if (message.type === "interaction_receipt") {
				const receipt = receipts.current.get(message.responseId);
				if (receipt) {
					clearTimeout(receipt.timer);
					receipts.current.delete(message.responseId);
					receipt.resolve({ accepted: message.accepted });
				}
			}
		});
		transport.send({ type: "interaction_snapshot" });
		return () => {
			unsubscribe();
			for (const receipt of receipts.current.values()) {
				clearTimeout(receipt.timer);
				receipt.reject(new Error("Disconnected"));
			}
			receipts.current.clear();
		};
	}, [transport]);
	const submit = (message: InteractionCommand & { responseId: string }) =>
		new Promise<{ accepted: boolean }>((resolve, reject) => {
			const timer = setTimeout(() => {
				receipts.current.delete(message.responseId);
				reject(new Error("Reply acknowledgement timed out"));
				transport.send({ type: "interaction_snapshot" });
			}, 15_000);
			receipts.current.set(message.responseId, { resolve, reject, timer });
			try {
				transport.send(message);
			} catch (error) {
				clearTimeout(timer);
				receipts.current.delete(message.responseId);
				reject(error);
			}
		});
	const active = pending.find(request => request.identity && !dismissed.has(request.id))?.id;
	useEffect(() => {
		if (active) setPresented(current => (current.has(active) ? current : new Set([...current, active])));
	}, [active]);
	return (
		<aside className="interaction-panel" aria-label="Questions and plans">
			{!onPresentation &&
				[...recaps].map(([id, value]) => (
					<AnswerRecapView key={id} recap={value.recap} evidence={value.evidence} />
				))}
			{[...failures].map(([id, message]) => (
				<div key={id} role="alert">
					{message}
				</div>
			))}
			{pending
				.filter(request => request.identity && (request.id === active || presented.has(request.id)))
				.map(request => {
					if (!request.identity) return null;
					const respond = (value: unknown) => {
						const serialized = JSON.stringify(value);
						let attempt = attempts.current.get(request.id);
						if (!attempt || attempt.serialized !== serialized) {
							attempt = { serialized, responseId: crypto.randomUUID() };
							attempts.current.set(request.id, attempt);
						}
						return submit({
							type: "interaction_respond",
							requestId: request.id,
							identity: request.identity!,
							value,
							responseId: attempt.responseId,
						});
					};
					if (request.delivery === "async")
						return (
							<div key={request.id} hidden={request.id !== active}>
								<AsyncQuestionCard
									key={request.id}
									title={request.title}
									options={request.options}
									onDismiss={() => setDismissed(current => new Set([...current, request.id]))}
									onRespond={respond}
								/>
							</div>
						);
					if (request.id === active && request.kind === "request_user_input" && request.inputQuestions)
						return (
							<QuestionCard
								key={request.id}
								requestId={request.id}
								questions={request.inputQuestions}
								isBlocking={request.isBlocking}
								onRespond={respond}
								onInterrupt={() =>
									transport.send({
										type: "interaction_cancel",
										requestId: request.id,
										identity: request.identity!,
									})
								}
							/>
						);
					return null;
				})}
			{pending.some(request => dismissed.has(request.id)) ? (
				<button type="button" onClick={() => setDismissed(new Set())}>
					Reopen pending questions
				</button>
			) : null}
			{plan?.status === "pending" ? (
				<PlanDecision
					key={plan.id}
					plan={plan}
					onDecide={(planId, action) => {
						if (action === "implement") onFollowTranscript?.();
						return submit({ type: "plan_decide", planId, action, responseId: crypto.randomUUID() });
					}}
				/>
			) : null}
		</aside>
	);
}
