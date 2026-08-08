import type { RoutingCoordinator } from "./coordinator";
import type { RoutingMode } from "./types";

export interface CommandContext {
	coordinator: RoutingCoordinator;
	currentModel: string;
	mode: RoutingMode;
}

export interface RouteCommandResult {
	output: string;
	newMode?: RoutingMode;
}

export async function handleRouteCommand(args: string[], ctx: CommandContext): Promise<RouteCommandResult> {
	const subcommand = (args[0] ?? "status").toLowerCase();
	const sm = ctx.coordinator.getStateMachine();
	const state = sm.getState();

	switch (subcommand) {
		case "status": {
			const lines = [
				`Routing Mode: ${ctx.mode}`,
				`Active Model: ${ctx.currentModel}`,
				`Active Tier: ${state.currentTier ?? "balanced"}`,
				`Downshift Streak: ${state.downshiftStreak}`,
				`Manual Pin: ${state.manualPin ?? "none"}`,
				`Escalation Floor: ${state.escalationFloor ?? "none"}`,
			];
			return { output: lines.join("\n") };
		}

		case "off": {
			return {
				output: "Routing mode set to off. Current model retained.",
				newMode: "off",
			};
		}

		case "shadow": {
			return {
				output: "Routing mode set to shadow. Router decisions will be recorded without switching models.",
				newMode: "shadow",
			};
		}

		case "auto": {
			sm.clearManualPin();
			return {
				output: "Routing mode set to auto. Manual model pin cleared.",
				newMode: "auto",
			};
		}

		default: {
			return {
				output: `Unknown /route subcommand '${subcommand}'. Usage: /route [status|off|shadow|auto]`,
			};
		}
	}
}
