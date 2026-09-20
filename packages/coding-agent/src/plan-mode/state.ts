export interface PlanModeState {
	enabled: boolean;
	workflow?: "parallel" | "iterative";
	reentry?: boolean;
}
