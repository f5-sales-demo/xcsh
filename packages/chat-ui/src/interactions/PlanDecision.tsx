import { useState } from "react";
import { type ConversationPlan, PLAN_ACTIONS, type PlanAction } from "./conversation-plan";

export function PlanDecision({
	plan,
	onDecide,
}: {
	plan: ConversationPlan;
	onDecide: (id: string, action: PlanAction) => Promise<{ accepted: boolean }>;
}) {
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const decide = async (action: PlanAction) => {
		setSending(true);
		try {
			if (!(await onDecide(plan.id, action)).accepted) setError("This plan decision is no longer available.");
		} catch {
			setError("Unable to submit the plan decision. Try again.");
		} finally {
			setSending(false);
		}
	};
	return (
		<section aria-label="Plan decision" data-plan-id={plan.id}>
			<h3>Implement this plan?</h3>
			<pre style={{ whiteSpace: "pre-wrap" }}>{plan.markdown}</pre>
			{PLAN_ACTIONS.map(action => (
				<button
					type="button"
					key={action.id}
					disabled={sending || plan.status !== "pending"}
					onClick={() => void decide(action.id)}
					title={action.description}
				>
					{action.label}
				</button>
			))}
			{error ? <p role="alert">{error}</p> : null}
		</section>
	);
}
