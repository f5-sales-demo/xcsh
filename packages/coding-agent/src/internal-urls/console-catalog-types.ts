/** Embedded F5 XC admin-console catalogue. All values are raw YAML text. */
export interface ConsoleCatalogData {
	/** Catalogue version stamp (from source artifact or "local"). */
	readonly version: string;
	/** Raw workflow YAML keyed by "<resource>/<operation>", e.g. "http-load-balancer/create". */
	readonly workflows: Readonly<Record<string, string>>;
	/** Raw resource YAML keyed by resource id, e.g. "http-load-balancer". */
	readonly resources: Readonly<Record<string, string>>;
	/** Raw route YAML keyed by route id, e.g. "origin-pools". */
	readonly routes: Readonly<Record<string, string>>;
	/** Raw navigation-tree YAML (console-tree.yaml), or null if absent. */
	readonly navigation: string | null;
}

export const EMPTY_CONSOLE_CATALOG: ConsoleCatalogData = {
	version: "unavailable",
	workflows: {},
	resources: {},
	routes: {},
	navigation: null,
};
