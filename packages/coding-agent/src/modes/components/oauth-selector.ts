import { Container, Input, matchesKey, Spacer, Text, TruncatedText } from "@f5-sales-demo/pi-tui";
import type { ProviderAccessState } from "../../config/model-registry";
import { theme } from "../../modes/theme/theme";
import { matchesSelectCancel } from "../../modes/utils/keybinding-matchers";
import type { AuthStorage } from "../../session/auth-storage";
import { getLoginOptions, type LoginOption } from "../controllers/login-options";
import { DynamicBorder } from "./dynamic-border";
/**
 * Component that renders an OAuth provider selector.
 */
export class OAuthSelectorComponent extends Container {
	static readonly MAX_VISIBLE_PROVIDERS = 10;

	#listContainer: Container;
	#allProviders: LoginOption[] = [];
	#filteredProviders: LoginOption[] = [];
	#managementProviders: LoginOption[] = [];
	#catalogProviders: LoginOption[] = [];
	#catalogMode = false;
	#detailsProvider?: LoginOption;
	#searchInput: Input;
	#selectedIndex: number = 0;
	#mode: "login" | "logout";
	#authStorage: AuthStorage;
	#onSelectCallback: (providerId: string) => void;
	#onCancelCallback: () => void;
	#statusMessage: string | undefined;
	#validateAuthCallback?: (providerId: string) => Promise<boolean>;
	#getAccessState?: (providerId: string) => ProviderAccessState;
	#validateAccess?: (providerId: string) => Promise<ProviderAccessState>;
	#isExcluded?: (providerId: string) => boolean;
	#requestRenderCallback?: () => void;
	#authState: Map<string, "checking" | "valid" | "invalid"> = new Map();
	#spinnerFrame: number = 0;
	#spinnerInterval?: NodeJS.Timeout;
	#validationGeneration: number = 0;
	constructor(
		mode: "login" | "logout",
		authStorage: AuthStorage,
		onSelect: (providerId: string) => void,
		onCancel: () => void,
		options?: {
			providers?: LoginOption[];
			catalogProviders?: LoginOption[];
			validateAuth?: (providerId: string) => Promise<boolean>;
			getAccessState?: (providerId: string) => ProviderAccessState;
			validateAccess?: (providerId: string) => Promise<ProviderAccessState>;
			isExcluded?: (providerId: string) => boolean;
			requestRender?: () => void;
		},
	) {
		super();
		this.#mode = mode;
		this.#authStorage = authStorage;
		this.#onSelectCallback = onSelect;
		this.#onCancelCallback = onCancel;
		this.#validateAuthCallback = options?.validateAuth;
		this.#getAccessState = options?.getAccessState;
		this.#validateAccess = options?.validateAccess;
		this.#isExcluded = options?.isExcluded;
		this.#requestRenderCallback = options?.requestRender;
		// Load all OAuth providers
		this.#loadProviders(options?.providers, options?.catalogProviders);
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		// Add title
		const title = mode === "login" ? "Select provider to login:" : "Select provider to logout:";
		this.addChild(new TruncatedText(theme.bold(title)));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Type to filter providers:"), 0, 0));
		this.#searchInput = new Input();
		this.addChild(this.#searchInput);
		this.addChild(new Spacer(1));
		// Create list container
		this.#listContainer = new Container();
		this.addChild(this.#listContainer);
		this.addChild(new Spacer(1));
		// Add bottom border
		this.addChild(new DynamicBorder());
		// Initial render
		this.#updateList();
		this.#startValidation();
	}

	stopValidation(): void {
		this.#validationGeneration += 1;
		this.#stopSpinner();
	}
	#loadProviders(providers?: LoginOption[], catalogProviders?: LoginOption[]): void {
		const defaultProviders =
			this.#mode === "login"
				? getLoginOptions()
				: getLoginOptions().filter(provider => !provider.loginOnly && provider.id !== "google-vertex");
		this.#managementProviders = providers ?? defaultProviders;
		this.#catalogProviders = catalogProviders ?? getLoginOptions();
		this.#allProviders = this.#managementProviders;
		// Keep the curated registry order stable except for explicit priorities.
		this.#allProviders = this.#allProviders
			.map((provider, index) => ({ provider, index }))
			.sort((a, b) => (a.provider.loginOrder ?? 0) - (b.provider.loginOrder ?? 0) || a.index - b.index)
			.map(({ provider }) => provider);
		this.#filteredProviders = this.#allProviders;
	}

	#providerIds(provider: LoginOption): string[] {
		return provider.providerIds ?? [provider.id];
	}

	#filterProviders(query: string): void {
		const normalizedQuery = query.trim().toLowerCase();
		this.#filteredProviders = normalizedQuery
			? this.#allProviders.filter(provider =>
					`${provider.name} ${provider.id}`.toLowerCase().includes(normalizedQuery),
				)
			: this.#allProviders;
		this.#selectedIndex = 0;
		this.#statusMessage = undefined;
		this.#updateList();
	}

	#startValidation(): void {
		if (!this.#validateAuthCallback && !this.#validateAccess) return;
		const generation = this.#validationGeneration + 1;
		this.#validationGeneration = generation;

		let pending = 0;
		for (const provider of this.#allProviders) {
			for (const providerId of this.#providerIds(provider)) {
				const access = this.#getAccessState?.(providerId);
				if (!this.#authStorage.hasAuth(providerId) && access?.credentialSource !== "keyless") {
					this.#authState.delete(providerId);
					continue;
				}
				this.#authState.set(providerId, "checking");
				pending += 1;
				void this.#validateProvider(providerId, generation);
			}
		}

		if (pending > 0) {
			this.#startSpinner();
			this.#updateList();
			this.#requestRenderCallback?.();
		}
	}

	async #validateProvider(providerId: string, generation: number): Promise<void> {
		if (!this.#validateAuthCallback && !this.#validateAccess) return;
		let result: "valid" | "invalid" | undefined;
		try {
			if (this.#validateAccess) {
				const access = await this.#validateAccess(providerId);
				if (access.status === "connected") result = "valid";
				else if (access.status === "reauth-required") result = "invalid";
			} else {
				result = (await this.#validateAuthCallback!(providerId)) ? "valid" : "invalid";
			}
		} catch {
			result = undefined;
		}

		if (generation !== this.#validationGeneration) return;
		if (result) this.#authState.set(providerId, result);
		else this.#authState.delete(providerId);
		if (![...this.#authState.values()].includes("checking")) {
			this.#stopSpinner();
		}
		this.#updateList();
		this.#requestRenderCallback?.();
	}

	#startSpinner(): void {
		if (this.#spinnerInterval) return;
		this.#spinnerInterval = setInterval(() => {
			const frameCount = theme.spinnerFrames.length;
			if (frameCount > 0) {
				this.#spinnerFrame = (this.#spinnerFrame + 1) % frameCount;
			}
			this.#updateList();
			this.#requestRenderCallback?.();
		}, 80);
	}

	#stopSpinner(): void {
		if (this.#spinnerInterval) {
			clearInterval(this.#spinnerInterval);
			this.#spinnerInterval = undefined;
		}
	}

	#getCombinedAccess(provider: LoginOption): ProviderAccessState | undefined {
		const states = this.#providerIds(provider).flatMap(providerId => {
			const access = this.#getAccessState?.(providerId);
			return access ? [access] : [];
		});
		if (states.length === 0) return undefined;
		const rank: Record<ProviderAccessState["status"], number> = {
			checking: 6,
			"reauth-required": 5,
			unreachable: 4,
			connected: 3,
			"configured-unverified": 2,
			unconfigured: 1,
		};
		return [...states].sort((a, b) => rank[b.status] - rank[a.status])[0];
	}

	#getStatusText(provider: LoginOption): string {
		if (provider.action === "add-provider") return "";
		const providerIds = this.#providerIds(provider);
		const state = providerIds.map(providerId => this.#authState.get(providerId));
		if (state.includes("checking")) {
			const frameCount = theme.spinnerFrames.length;
			const spinner = frameCount > 0 ? `${theme.spinnerFrames[this.#spinnerFrame % frameCount]} ` : "";
			return `${spinner}Checking…`;
		}
		const access = this.#getCombinedAccess(provider);
		if (state.includes("invalid") || access?.status === "reauth-required") {
			return access?.credentialSource === "stored-oauth" ? "Sign in again" : "Credentials need attention";
		}
		if (access?.status === "unreachable") return "Can't connect";
		if (access?.status === "connected") {
			return access.credentialSource === "keyless" ? "Available" : "Connected";
		}
		if (state.includes("valid")) return "Connected";
		if (access?.status === "configured-unverified") return "Configured";
		if (providerIds.some(providerId => this.#authStorage.hasAuth(providerId))) return "Configured";
		return "Set up";
	}

	#getStatusIndicator(provider: LoginOption): string {
		const text = this.#getStatusText(provider);
		if (!text) return "";
		const access = this.#getCombinedAccess(provider);
		const color =
			text === "Connected" || text === "Available"
				? "success"
				: text === "Sign in again" || text === "Credentials need attention"
					? "error"
					: text === "Set up"
						? "muted"
						: "warning";
		const icon =
			access?.status === "connected"
				? `${theme.status.success} `
				: access?.status === "unreachable" || access?.status === "reauth-required"
					? `${theme.status.warning} `
					: "";
		return theme.fg(color, ` ${icon}${text}`);
	}
	#updateList(): void {
		this.#listContainer.clear();
		if (this.#detailsProvider) {
			const access = this.#getCombinedAccess(this.#detailsProvider);
			const providerIds = this.#providerIds(this.#detailsProvider);
			const credentialLabels: Record<string, string> = {
				"stored-oauth": "Stored OAuth",
				"stored-api-key": "Stored API key",
				environment: "Environment",
				runtime: "Runtime",
				configuration: "Configuration",
				keyless: "None required",
			};
			this.#listContainer.addChild(new TruncatedText(theme.bold(`  Manage ${this.#detailsProvider.name}`), 0, 0));
			this.#listContainer.addChild(
				new TruncatedText(`  Status: ${this.#getStatusText(this.#detailsProvider)}`, 0, 0),
			);
			this.#listContainer.addChild(
				new TruncatedText(`  Credential: ${credentialLabels[access?.credentialSource ?? ""] ?? "None"}`, 0, 0),
			);
			this.#listContainer.addChild(
				new TruncatedText(
					`  Last verification: ${access?.lastCheckedAt ? new Date(access.lastCheckedAt).toISOString() : "Never"}`,
					0,
					0,
				),
			);
			this.#listContainer.addChild(
				new TruncatedText(
					`  Model visibility: ${providerIds.every(providerId => this.#isExcluded?.(providerId)) ? "Hidden" : "Visible"}`,
					0,
					0,
				),
			);
			if (providerIds.length > 1) {
				this.#listContainer.addChild(new TruncatedText(`  Routes: ${providerIds.join(", ")}`, 0, 0));
			}
			if (access?.failureReason) {
				this.#listContainer.addChild(new TruncatedText(`  Reason: ${access.failureReason}`, 0, 0));
			}
			this.#listContainer.addChild(new Spacer(1));
			this.#listContainer.addChild(new TruncatedText(theme.fg("muted", "  Esc: back"), 0, 0));
			return;
		}
		const maxVisible = OAuthSelectorComponent.MAX_VISIBLE_PROVIDERS;
		const startIndex = Math.max(
			0,
			Math.min(this.#selectedIndex - maxVisible + 1, this.#filteredProviders.length - maxVisible),
		);
		const endIndex = Math.min(startIndex + maxVisible, this.#filteredProviders.length);

		for (let i = startIndex; i < endIndex; i++) {
			const provider = this.#filteredProviders[i];
			if (!provider) continue;
			const isSelected = i === this.#selectedIndex;
			const isAvailable = provider.available;
			const statusIndicator = this.#getStatusIndicator(provider);

			let line = "";
			if (isSelected) {
				const prefix = theme.fg("chromeAccent", `${theme.nav.cursor} `);
				const text = isAvailable ? theme.fg("contentAccent", provider.name) : theme.fg("dim", provider.name);
				line = prefix + text + statusIndicator;
			} else {
				const text = isAvailable ? `  ${provider.name}` : theme.fg("dim", `  ${provider.name}`);
				line = text + statusIndicator;
			}
			this.#listContainer.addChild(new TruncatedText(line, 0, 0));
			if (provider.description) {
				this.#listContainer.addChild(new TruncatedText(theme.fg("muted", `     ${provider.description}`), 0, 0));
			}
		}

		// Show "no providers" if empty
		if (
			this.#mode === "login" &&
			!this.#catalogMode &&
			this.#allProviders.length === 1 &&
			this.#allProviders[0]?.action === "add-provider"
		) {
			this.#listContainer.addChild(new TruncatedText(theme.fg("muted", "  No providers configured"), 0, 0));
		} else if (this.#allProviders.length === 0) {
			const message =
				this.#mode === "login" ? "No OAuth providers available" : "No OAuth providers logged in. Use /login first.";
			this.#listContainer.addChild(new TruncatedText(theme.fg("muted", `  ${message}`), 0, 0));
		} else if (this.#filteredProviders.length === 0) {
			this.#listContainer.addChild(new TruncatedText(theme.fg("muted", "  No matching providers"), 0, 0));
			this.#listContainer.addChild(
				new TruncatedText(theme.fg("muted", `  0 matches (${this.#allProviders.length} total)`), 0, 0),
			);
		} else if (this.#searchInput.getValue()) {
			const matchLabel = this.#filteredProviders.length === 1 ? "match" : "matches";
			this.#listContainer.addChild(
				new TruncatedText(
					theme.fg(
						"muted",
						`  ${this.#filteredProviders.length} ${matchLabel} (${this.#allProviders.length} total)`,
					),
					0,
					0,
				),
			);
		} else {
			this.#listContainer.addChild(
				new TruncatedText(
					theme.fg("muted", `  Showing ${startIndex + 1}-${endIndex} of ${this.#filteredProviders.length}`),
					0,
					0,
				),
			);
		}
		if (this.#statusMessage) {
			this.#listContainer.addChild(new Spacer(1));
			this.#listContainer.addChild(new TruncatedText(theme.fg("warning", `  ${this.#statusMessage}`), 0, 0));
		}
		this.#listContainer.addChild(new Spacer(1));
		this.#listContainer.addChild(
			new TruncatedText(
				theme.fg("muted", "  Type to filter providers · Enter: select · Right: details · Esc: clear/back"),
				0,
				0,
			),
		);
	}
	handleInput(keyData: string): void {
		if (this.#detailsProvider) {
			if (matchesSelectCancel(keyData) || matchesKey(keyData, "left")) {
				this.#detailsProvider = undefined;
				this.#updateList();
			}
			return;
		}
		// Up arrow
		if (matchesKey(keyData, "up")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === 0 ? this.#filteredProviders.length - 1 : this.#selectedIndex - 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Down arrow
		else if (matchesKey(keyData, "down")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === this.#filteredProviders.length - 1 ? 0 : this.#selectedIndex + 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Page up
		else if (matchesKey(keyData, "pageUp")) {
			this.#selectedIndex = Math.max(0, this.#selectedIndex - OAuthSelectorComponent.MAX_VISIBLE_PROVIDERS);
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Page down
		else if (matchesKey(keyData, "pageDown")) {
			this.#selectedIndex = Math.min(
				Math.max(0, this.#filteredProviders.length - 1),
				this.#selectedIndex + OAuthSelectorComponent.MAX_VISIBLE_PROVIDERS,
			);
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Home
		else if (matchesKey(keyData, "home")) {
			this.#selectedIndex = 0;
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// End
		else if (matchesKey(keyData, "end")) {
			this.#selectedIndex = Math.max(0, this.#filteredProviders.length - 1);
			this.#statusMessage = undefined;
			this.#updateList();
		} else if (matchesKey(keyData, "right")) {
			const selectedProvider = this.#filteredProviders[this.#selectedIndex];
			if (selectedProvider && selectedProvider.action !== "add-provider") {
				this.#detailsProvider = selectedProvider;
				this.#updateList();
			}
		}
		// Enter
		else if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			const selectedProvider = this.#filteredProviders[this.#selectedIndex];
			if (selectedProvider?.action === "add-provider") {
				this.stopValidation();
				this.#catalogMode = true;
				this.#allProviders = this.#catalogProviders;
				this.#filteredProviders = this.#allProviders;
				this.#selectedIndex = 0;
				this.#searchInput.setValue("");
				this.#updateList();
				this.#startValidation();
			} else if (selectedProvider?.action === "manage-only") {
				this.#detailsProvider = selectedProvider;
				this.#updateList();
			} else if (selectedProvider?.available) {
				this.#statusMessage = undefined;
				this.stopValidation();
				this.#onSelectCallback(selectedProvider.id);
			} else if (selectedProvider) {
				this.#statusMessage = "Provider unavailable in this environment.";
				this.#updateList();
			}
		}
		// Escape or Ctrl+C
		else if (matchesSelectCancel(keyData)) {
			if (this.#searchInput.getValue()) {
				this.#searchInput.setValue("");
				this.#filterProviders("");
				return;
			}
			if (this.#catalogMode) {
				this.stopValidation();
				this.#catalogMode = false;
				this.#allProviders = this.#managementProviders;
				this.#filteredProviders = this.#allProviders;
				this.#selectedIndex = 0;
				this.#updateList();
				return;
			}
			this.stopValidation();
			this.#onCancelCallback();
		}
		// Everything else edits the provider filter.
		else {
			const previousQuery = this.#searchInput.getValue();
			this.#searchInput.handleInput(keyData);
			const nextQuery = this.#searchInput.getValue();
			if (nextQuery !== previousQuery) this.#filterProviders(nextQuery);
		}
	}
}
