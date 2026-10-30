import { useState } from "react";
import { type AnswerRecap, DELIVERY_COPY } from "./answer-recap";

export function AnswerRecapView({ recap, evidence }: { recap: AnswerRecap; evidence?: string }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="answer-recap" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
			<strong>{DELIVERY_COPY[recap.state]}</strong>
			{recap.rows.map(row => (
				<div key={row.id} style={{ marginTop: 8 }}>
					{recap.state === "pending" || recap.state === "asked" ? (
						row.question
					) : (
						<>
							<strong>
								{row.topic} — {row.answer}
							</strong>
							{row.description ? <div>{row.description}</div> : null}
							{row.notes !== undefined ? <div>Notes: {row.notes}</div> : null}
						</>
					)}
				</div>
			))}
			{evidence ? (
				<details className="tool-activity" onToggle={event => setExpanded(event.currentTarget.open)}>
					<summary>Details</summary>
					{expanded ? <pre className="tool-activity-detail">{evidence}</pre> : null}
				</details>
			) : null}
		</div>
	);
}
