export interface DashboardPlugin {
	id: string;
	name: string;
	displayName?: string;
	marketplace?: string;
	source: "npm" | "marketplace";
	scope?: "user" | "project" | "local";
	version?: string;
	catalogVersion?: string;
	description?: string;
	category?: string;
	tags?: string[];
	author?: string;
	homepage?: string;
	license?: string;
	installed: boolean;
	enabled: boolean;
	shadowedBy?: "project";
	hasUpdate: boolean;
	updateVersion?: string;
	recommended?: boolean;
	prerequisites?: Array<{
		tool: string;
		installCmd: string;
		detectCmd: string;
		authDetectCmd?: string;
		authLoginCmd?: string;
	}>;
}

export type PluginTabId = "installed" | "recommended" | "discover" | "updates";

export interface PluginTab {
	id: PluginTabId;
	label: string;
	count: number;
}

export interface PluginDashboardState {
	tabs: PluginTab[];
	activeTabIndex: number;
	allPlugins: DashboardPlugin[];
	tabFiltered: DashboardPlugin[];
	searchFiltered: DashboardPlugin[];
	searchQuery: string;
	selectedIndex: number;
	scrollOffset: number;
	notice: string | null;
	loading: boolean;
	loadError: string | null;
}
