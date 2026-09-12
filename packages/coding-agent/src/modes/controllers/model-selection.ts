import { formatModelSelectorValue } from "../../config/model-resolver";
import type { AgentSession } from "../../session/agent-session";
import type { ModelSelection } from "../components/model-selector";

/** Resolve exact catalog identity and the saved/session effects before review. */
export function prepareModelSelection(session: AgentSession, selection: ModelSelection, sessionId = session.sessionId) {
	const model = session.modelRegistry
		.getAll()
		.find(candidate => candidate.provider === selection.model.provider && candidate.id === selection.model.id);
	if (!model) return undefined;
	const target = { ...selection, model };
	const currentModel = session.model
		? formatModelSelectorValue(
				`${session.model.provider}/${session.model.id}`,
				session.thinkingLevel ?? selection.thinkingLevel,
			)
		: "None";
	const selectedModel = formatModelSelectorValue(selection.selector, selection.thinkingLevel);
	const role = selection.scope === "default" ? "default" : selection.role;
	const routingState = session.getRoutingState();
	const changes: Array<{ field: string; before: string; after: string }> = [];
	if (selection.scope !== "conversation") {
		if (!role) return undefined;
		changes.push({
			field: `User role ${role}`,
			before: session.settings.getModelRoles()[role] ?? "Unset",
			after: selectedModel,
		});
	}
	if (selection.scope !== "role") {
		changes.push(
			{ field: "Active model / reasoning", before: currentModel, after: selectedModel },
			{
				field: "Manual routing pin",
				before: routingState.manualPin ?? "None",
				after: `${model.provider}/${model.id}`,
			},
		);
	}
	const scope =
		selection.scope === "conversation"
			? `Session ${sessionId} · active model and routing pin`
			: selection.scope === "default"
				? `User settings · default role; session ${sessionId}`
				: `User settings · role ${role}`;
	const changed = changes.filter(change => change.before !== change.after);
	return {
		review: {
			identity: selection.scope === "conversation" ? `session:${sessionId}:active-model` : `model-role:${role}`,
			scope,
			revision: JSON.stringify({
				model,
				selection: { ...selection, model: undefined },
				changes: changed,
			}),
			changes: changed,
			consequence:
				selection.scope === "conversation"
					? "Switches this conversation and records a manual routing pin; user model defaults are unchanged."
					: selection.scope === "default"
						? "Saves the user default role, then switches this conversation and records a manual routing pin."
						: `Saves the ${role} role for future routed work; the active conversation model is unchanged.`,
		},
		target,
	};
}

/** Commit a picker selection only after persistence succeeds. */
export async function applyModelSelection(session: AgentSession, selection: ModelSelection): Promise<void> {
	const { model, thinkingLevel, selector, scope } = selection;
	const previousModel = session.model;
	const previousThinking = session.thinkingLevel;
	const previousRoles = { ...session.settings.get("modelRoles") };
	const previousRouting = session.getRoutingState();
	let switched = false;
	const role = scope === "default" ? "default" : selection.role;
	if (scope === "role" && !role) throw new Error("A role is required");
	// Validate the exact transport before changing saved assignments or conversation state.
	if (!(await session.modelRegistry.getApiKey(model, session.sessionId))) {
		throw new Error(`No API key for ${selector}`);
	}
	try {
		if (scope !== "conversation") {
			session.settings.setModelRole(role!, formatModelSelectorValue(selector, thinkingLevel));
			await session.settings.flush({ throwOnError: true });
		}
		if (scope !== "role") {
			switched = true;
			await session.setModelTemporary(model, thinkingLevel);
			session.routingCoordinator.getStateMachine().setManualPin(`${model.provider}/${model.id}`);
			session.sessionManager.appendCustomEntry("routing_event", {
				type: "routing_skipped",
				epochId: `selection-${Date.now()}`,
				reasons: ["user_model_pin"],
				state: session.getRoutingState(),
			});
			// A reviewed model choice is user-requested durable session state. Do
			// not leave it behind the ordinary first-assistant-message lazy-write
			// boundary: the user may exit immediately after making the selection.
			await session.sessionManager.ensureOnDisk();
			await session.sessionManager.flush();
		}
	} catch (error) {
		if (scope !== "conversation") {
			session.settings.set("modelRoles", previousRoles);
			await session.settings.flush({ throwOnError: true }).catch(() => {});
		}
		if (switched && previousModel) await session.setModelTemporary(previousModel, previousThinking);
		session.restoreRoutingState(previousRouting);
		if (switched) {
			session.sessionManager.appendCustomEntry("routing_event", {
				type: "routing_skipped",
				epochId: `selection-rollback-${Date.now()}`,
				reasons: ["user_model_pin"],
				state: previousRouting,
			});
			await session.sessionManager.ensureOnDisk().catch(() => {});
			await session.sessionManager.flush().catch(() => {});
		}
		throw error;
	}
}
