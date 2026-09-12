import type { RoutingCoordinator } from "./coordinator";
import { SUBSCRIPTION_ROUTING_PROFILES, type SubscriptionProfileId } from "./subscription-profiles";
import type { RoutingMode } from "./types";

export interface CommandContext {
	coordinator: RoutingCoordinator;
	currentModel: string;
	mode: RoutingMode;
	profile?: string;
}

export interface RouteCommandResult {
	output: string;
	error?: boolean;
	newMode?: RoutingMode;
	newProfile?: SubscriptionProfileId;
}

export async function handleRouteCommand(args: string[], ctx: CommandContext): Promise<RouteCommandResult> {
	const subcommand = (args[0] ?? "status").toLowerCase();
	const sm = ctx.coordinator.getStateMachine();
	const state = sm.getState();
	const usage = "Usage: /route [status|off|shadow|auto|profile <anthropic|google-antigravity|openai-codex>]";
	if (subcommand === "profile" ? args.length !== 2 : args.length !== 1) {
		return { output: usage, error: true };
	}

	switch (subcommand) {
		case "status": {
			const lines = [
				`Effective Routing Mode: ${ctx.mode}`,
				`Effective Routing Profile: ${ctx.profile ?? "none"}`,
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
			return {
				output: "Routing mode set to auto. Manual model pin cleared.",
				newMode: "auto",
			};
		}

		case "profile": {
			const profile = args[1] as SubscriptionProfileId | undefined;
			if (!profile || !Object.hasOwn(SUBSCRIPTION_ROUTING_PROFILES, profile)) {
				return {
					output: `Usage: /route profile [${Object.keys(SUBSCRIPTION_ROUTING_PROFILES).join("|")}]`,
					error: true,
				};
			}
			return { output: `Routing profile selected: ${profile}`, newProfile: profile };
		}

		default: {
			return {
				output: `Unknown /route subcommand '${subcommand}'. ${usage}`,
				error: true,
			};
		}
	}
}
