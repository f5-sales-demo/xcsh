import { Container, Input, matchesKey } from "@f5-sales-demo/pi-tui";
import type { ProviderAccessState } from "../../config/model-registry";
import { theme } from "../../modes/theme/theme";
import { matchesSelectCancel } from "../../modes/utils/keybinding-matchers";
import type { AuthStorage } from "../../session/auth-storage";
import { getLoginOptions, type LoginOption } from "../controllers/login-options";
import { providerPresentation } from "../controllers/provider-presentation";
import {
	matchesSelectorKey,
	selectorCancelHint,
	selectorFrame,
	selectorNavigationHint,
	selectorRow,
} from "./selector-frame";
/**
 * Component that renders an OAuth provider selector.
 */
export class OAuthSelectorComponent extends Container {
	static readonly MAX_VISIBLE_PROVIDERS = 10;

	#rows: () => number = () => process.stdout.rows || 24;
	#actionIndex = 0;
	#onChooseModel?: (provider: string) => void;
	#directCatalog = false;
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
	#getDiscoveryState?: (provider: string) => { status: string; models: string[] } | undefined;
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
			rows?: () => number;
			initialCatalog?: boolean;
			onChooseModel?: (provider: string) => void;
			providers?: LoginOption[];
			catalogProviders?: LoginOption[];
			validateAuth?: (providerId: string) => Promise<boolean>;
			getDiscoveryState?: (provider: string) => { status: string; models: string[] } | undefined;
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
		this.#getDiscoveryState = options?.getDiscoveryState;
		this.#validateAccess = options?.validateAccess;
		this.#isExcluded = options?.isExcluded;
		this.#requestRenderCallback = options?.requestRender;
		// Load all OAuth providers
		this.#loadProviders(options?.providers, options?.catalogProviders);
		if (mode === "login" && !options?.providers) {
			this.#catalogMode = true;
			this.#directCatalog = true;
			this.#allProviders = this.#catalogProviders;
			this.#filteredProviders = this.#allProviders;
		}
		this.#searchInput = new Input();
		this.#rows = options?.rows ?? this.#rows;
		this.#onChooseModel = options?.onChooseModel;
		if (
			mode === "login" &&
			(options?.initialCatalog || this.#allProviders.every(provider => provider.action === "add-provider"))
		) {
			this.#directCatalog = true;
			this.#catalogMode = true;
			this.#allProviders = this.#catalogProviders;
			this.#filteredProviders = this.#allProviders;
		}

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
		const categoryOrder = ["Subscriptions", "Cloud & API", "Local & proxies", "Other services"];
		this.#catalogProviders = [...(catalogProviders ?? getLoginOptions())].sort(
			(a, b) =>
				categoryOrder.indexOf(providerPresentation(a.id).category) -
				categoryOrder.indexOf(providerPresentation(b.id).category),
		);
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
					`${provider.name} ${provider.id} ${provider.description ?? ""} ${providerPresentation(provider.id).access} ${providerPresentation(provider.id).description}`
						.toLowerCase()
						.includes(normalizedQuery),
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
			return access?.credentialSource === "stored-oauth" ? "Sign-in required" : "Sign-in required";
		}
		if (access?.status === "unreachable") return "Unreachable";
		if (
			providerIds.every(id => {
				const state = this.#getDiscoveryState?.(id);
				return state?.status === "ok" && state.models.length === 0;
			})
		)
			return "No models returned";
		if (access?.status === "connected") {
			return access.credentialSource === "keyless" ? "Ready" : "Ready";
		}
		if (state.includes("valid")) return "Ready";
		if (access?.status === "configured-unverified") return "Credentials saved";
		if (providerIds.some(providerId => this.#authStorage.hasAuth(providerId))) return "Credentials saved";
		return "Set up";
	}

	#managementActions(): string[] {
		const provider = this.#detailsProvider;
		if (!provider) return [];
		return [
			...(this.#onChooseModel ? ["Choose model"] : []),
			...(provider.available && provider.action !== "manage-only"
				? [providerPresentation(provider.id).access === "Subscription" ? "Sign in again" : "Edit connection"]
				: []),
		];
	}
	#updateList(): void {
		this.invalidate();
	}
	override render(width: number): string[] {
		const rows = this.#rows();
		const inner = Math.min(100, width) - 6;
		const wide = width >= 80;
		const selected = this.#detailsProvider ?? this.#filteredProviders[this.#selectedIndex];
		const presentation = selected ? providerPresentation(selected.id) : undefined;
		const title = this.#detailsProvider
			? `Manage ${selected?.name}`
			: this.#mode === "logout"
				? "Disconnect a provider"
				: this.#catalogMode
					? "Connect a provider"
					: "Your providers";
		const details =
			selected?.action === "add-provider"
				? [selected.description ?? "Search the full provider catalog"]
				: selected
					? [
							`${selected.id} · ${presentation?.access}`,
							this.#getStatusText(selected),
							selected.description ?? presentation?.description ?? "",
						]
					: [];
		let body: string[] = [];
		if (this.#detailsProvider) {
			body = this.#managementActions().map((label, i) => selectorRow([label], [inner], i === this.#actionIndex));
			const access = this.#getCombinedAccess(this.#detailsProvider);
			details.push(
				access?.failureReason ??
					(access?.lastCheckedAt
						? "Connection checked; refresh from model selection with Ctrl+R."
						: "Live availability has not been verified."),
			);
			if (this.#providerIds(this.#detailsProvider).every(id => this.#isExcluded?.(id)))
				details.push("Models hidden by the configured provider filter.");
		} else {
			const maxVisible = Math.max(
				1,
				Math.min(10, Math.floor((rows - 13) / (this.#catalogMode && !this.#searchInput.getValue() ? 2 : 1))),
			);
			const start = Math.max(
				0,
				Math.min(this.#selectedIndex - maxVisible + 1, this.#filteredProviders.length - maxVisible),
			);
			if (wide) body.push(selectorRow(["Provider", "Access", "Status"], [inner - 40, 16, 20]));
			let category = "";
			for (let i = start; i < Math.min(start + maxVisible, this.#filteredProviders.length); i++) {
				const provider = this.#filteredProviders[i];
				const meta = providerPresentation(provider.id);
				if (this.#catalogMode && !this.#searchInput.getValue() && meta.category !== category) {
					category = meta.category;
					body.push(theme.fg("muted", category));
				}
				body.push(
					selectorRow(
						wide
							? [
									provider.name,
									provider.action === "add-provider" ? "" : meta.access,
									this.#getStatusText(provider),
								]
							: [provider.name],
						wide ? [inner - 40, 16, 20] : [inner],
						i === this.#selectedIndex,
					),
				);
			}
			if (!this.#filteredProviders.length) body.push("No matching providers");
		}
		if (this.#statusMessage) details.push(this.#statusMessage);
		return selectorFrame(
			width,
			rows,
			title,
			this.#detailsProvider
				? "Choose what to do with this connection."
				: "Connect access, then choose a model when ready.",
			this.#detailsProvider
				? []
				: [
						`Search providers (${this.#filteredProviders.length ? this.#selectedIndex + 1 : 0}/${this.#filteredProviders.length})`,
						...this.#searchInput.render(inner),
					],
			body,
			details,
			[selectorNavigationHint(), selectorCancelHint(this.#searchInput.getValue() ? "clear search" : "back")],
		);
	}

	handleInput(keyData: string): void {
		if (this.#detailsProvider) {
			const actions = this.#managementActions();
			if (matchesSelectCancel(keyData) || matchesKey(keyData, "left")) {
				this.#detailsProvider = undefined;
				this.#actionIndex = 0;
			} else if (matchesSelectorKey(keyData, "up") || matchesSelectorKey(keyData, "down")) {
				this.#actionIndex =
					(this.#actionIndex + (matchesSelectorKey(keyData, "up") ? -1 : 1) + actions.length) % actions.length;
			} else if (matchesSelectorKey(keyData, "confirm")) {
				const provider = this.#detailsProvider;
				this.stopValidation();
				if (actions[this.#actionIndex] === "Choose model") this.#onChooseModel?.(provider.id);
				else if (actions[this.#actionIndex]) this.#onSelectCallback(provider.id);
			}
			this.#updateList();
			return;
		}

		// Up arrow
		if (matchesSelectorKey(keyData, "up")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === 0 ? this.#filteredProviders.length - 1 : this.#selectedIndex - 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Down arrow
		else if (matchesSelectorKey(keyData, "down")) {
			if (this.#filteredProviders.length > 0) {
				this.#selectedIndex =
					this.#selectedIndex === this.#filteredProviders.length - 1 ? 0 : this.#selectedIndex + 1;
			}
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Page up
		else if (matchesSelectorKey(keyData, "pageUp")) {
			this.#selectedIndex = Math.max(0, this.#selectedIndex - OAuthSelectorComponent.MAX_VISIBLE_PROVIDERS);
			this.#statusMessage = undefined;
			this.#updateList();
		}
		// Page down
		else if (matchesSelectorKey(keyData, "pageDown")) {
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
		else if (matchesSelectorKey(keyData, "confirm")) {
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
			} else if (
				selectedProvider &&
				(selectedProvider.action === "manage-only" ||
					(this.#mode === "login" &&
						(!this.#catalogMode ||
							this.#providerIds(selectedProvider).some(
								id => this.#authStorage.hasAuth(id) || this.#getAccessState?.(id)?.configured,
							))))
			) {
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
			if (this.#catalogMode && !this.#directCatalog) {
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
