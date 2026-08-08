import type { RoutingTier } from "./types";

export interface RoutingState {
	currentTier?: RoutingTier;
	downshiftStreak: number;
	escalationFloor?: RoutingTier;
	manualPin?: string;
}

const TIER_RANK: Record<RoutingTier, number> = {
	utility: 1,
	balanced: 2,
	frontier: 3,
};

export class RoutingStateMachine {
	private state: RoutingState;

	constructor(initialState?: Partial<RoutingState>) {
		this.state = {
			currentTier: initialState?.currentTier ?? "balanced",
			downshiftStreak: initialState?.downshiftStreak ?? 0,
			escalationFloor: initialState?.escalationFloor,
			manualPin: initialState?.manualPin,
		};
	}

	public getState(): Readonly<RoutingState> {
		return { ...this.state };
	}

	public restoreState(state: Partial<RoutingState>): void {
		if (state.currentTier) this.state.currentTier = state.currentTier;
		if (typeof state.downshiftStreak === "number") this.state.downshiftStreak = state.downshiftStreak;
		this.state.escalationFloor = state.escalationFloor;
		this.state.manualPin = state.manualPin;
	}

	public reset(): void {
		this.state = {
			currentTier: "balanced",
			downshiftStreak: 0,
			escalationFloor: undefined,
			manualPin: undefined,
		};
	}

	public setManualPin(model: string | undefined): void {
		this.state.manualPin = model;
	}

	public clearManualPin(): void {
		this.state.manualPin = undefined;
	}

	public setEscalationFloor(tier: RoutingTier): void {
		this.state.escalationFloor = tier;
	}

	public clearEscalationFloor(): void {
		this.state.escalationFloor = undefined;
	}

	public evaluateNextTurn(
		desiredTier: RoutingTier,
		downshiftThreshold = 2,
	): { effectiveTier: RoutingTier; downshiftStreak: number } {
		const currentTier = this.state.currentTier ?? "balanced";
		const currentRank = TIER_RANK[currentTier];
		const desiredRank = TIER_RANK[desiredTier];

		let effectiveTier = currentTier;
		let streak = this.state.downshiftStreak;

		if (desiredRank > currentRank) {
			// Upgrade immediately
			effectiveTier = desiredTier;
			streak = 0;
		} else if (desiredRank === currentRank) {
			// Same tier
			streak = 0;
			effectiveTier = currentTier;
		} else {
			// Desired lower tier
			streak += 1;
			if (streak >= downshiftThreshold) {
				effectiveTier = desiredTier;
				streak = 0;
			} else {
				effectiveTier = currentTier;
			}
		}

		// Enforce escalation floor if set and higher than effective tier
		if (this.state.escalationFloor) {
			const floorRank = TIER_RANK[this.state.escalationFloor];
			if (floorRank > TIER_RANK[effectiveTier]) {
				effectiveTier = this.state.escalationFloor;
			}
		}

		this.state.currentTier = effectiveTier;
		this.state.downshiftStreak = streak;

		return { effectiveTier, downshiftStreak: streak };
	}
}
