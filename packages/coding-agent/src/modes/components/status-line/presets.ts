import type { PresetDef, StatusLinePreset } from "./types";

export const STATUS_LINE_PRESETS: Record<StatusLinePreset, PresetDef> = {
	default: {
		leftSegments: ["pi", "model", "plan_mode", "path", "git", "pr", "context_pct", "token_total", "cost"],
		rightSegments: ["context_xcsh"],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
		dropOrder: [
			"pr",
			"token_total",
			"cost",
			"git",
			"path",
			"context_pct",
			"plan_mode",
			"model",
			"pi",
			"context_xcsh",
		],
	},

	minimal: {
		leftSegments: ["path", "git"],
		rightSegments: ["plan_mode", "context_pct", "context_xcsh"],
		separator: "slash",
		segmentOptions: {
			path: { abbreviate: true, maxLength: 30 },
			git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
		},
		dropOrder: ["git", "plan_mode", "context_pct", "path", "context_xcsh"],
	},

	compact: {
		leftSegments: ["model", "plan_mode", "git", "pr"],
		rightSegments: ["cost", "context_pct", "context_xcsh"],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: false },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
		},
		dropOrder: ["pr", "cost", "git", "context_pct", "plan_mode", "model", "context_xcsh"],
	},

	full: {
		leftSegments: ["pi", "hostname", "model", "plan_mode", "path", "git", "pr", "subagents"],
		rightSegments: [
			"token_in",
			"token_out",
			"token_rate",
			"cache_read",
			"cost",
			"context_pct",
			"time_spent",
			"time",
			"context_xcsh",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 50 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: false },
		},
		dropOrder: [
			"time",
			"time_spent",
			"cache_read",
			"token_rate",
			"token_out",
			"token_in",
			"subagents",
			"pr",
			"git",
			"path",
			"cost",
			"context_pct",
			"plan_mode",
			"hostname",
			"model",
			"pi",
			"context_xcsh",
		],
	},

	nerd: {
		// Full preset with all Nerd Font icons
		leftSegments: ["pi", "hostname", "model", "plan_mode", "path", "git", "pr", "session", "subagents"],
		rightSegments: [
			"token_in",
			"token_out",
			"cache_read",
			"cache_write",
			"token_rate",
			"cost",
			"context_pct",
			"context_total",
			"time_spent",
			"time",
			"context_xcsh",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 60 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: true },
		},
		dropOrder: [
			"context_total",
			"cache_write",
			"session",
			"time",
			"time_spent",
			"cache_read",
			"token_rate",
			"token_out",
			"token_in",
			"subagents",
			"pr",
			"git",
			"path",
			"cost",
			"context_pct",
			"plan_mode",
			"hostname",
			"model",
			"pi",
			"context_xcsh",
		],
	},

	ascii: {
		// No Nerd Font dependencies
		leftSegments: ["model", "plan_mode", "path", "git", "pr"],
		rightSegments: ["token_total", "cost", "context_pct", "context_xcsh"],
		separator: "ascii",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
		dropOrder: ["pr", "token_total", "cost", "git", "path", "context_pct", "model", "context_xcsh"],
	},

	xcsh: {
		leftSegments: ["context_pct", "path", "git"],
		rightSegments: ["plan_mode", "context_xcsh"],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			context_pct: { compact: true },
		},
		dropOrder: ["plan_mode", "git", "path", "context_pct", "context_xcsh"],
	},

	custom: {
		// User-defined - these are just defaults that get overridden
		leftSegments: ["model", "plan_mode", "path", "git", "pr"],
		rightSegments: ["token_total", "cost", "context_pct", "context_xcsh"],
		separator: "powerline",
		segmentOptions: {},
	},
};

export function getPreset(name: StatusLinePreset): PresetDef {
	return STATUS_LINE_PRESETS[name] ?? STATUS_LINE_PRESETS.default;
}
