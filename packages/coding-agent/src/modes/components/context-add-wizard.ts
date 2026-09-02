import { Container, Input, matchesKey, Spacer, Text, TruncatedText } from "@f5-sales-demo/pi-tui";
import { normalizeXcshApiUrlInput, normalizeXcshCredentialInput } from "@f5-sales-demo/pi-utils/xcsh-auth";
import type { TokenValidationResult, XCSHContext } from "../../services/xcsh-context";
import {
	deriveTenantFromUrl,
	isSensitiveEnvKey,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_CONSOLE_PASSWORD,
	XCSH_USERNAME,
} from "../../services/xcsh-env";
import { theme } from "../theme/theme";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

type WizardCredentialKey =
	| typeof XCSH_API_URL
	| typeof XCSH_API_TOKEN
	| typeof XCSH_USERNAME
	| typeof XCSH_CONSOLE_PASSWORD;

/**
 * Normalize a credential pasted from a shell or dotenv file without ever
 * interpreting arbitrary assignments. Raw values remain valid, including
 * tokens that contain or end with `=`.
 */
export function normalizeWizardCredential(value: string, expectedKey: WizardCredentialKey): string | null {
	return normalizeXcshCredentialInput(value, expectedKey);
}

export function normalizeWizardUrl(value: string): string | null {
	const normalized = normalizeXcshApiUrlInput(value);
	if (normalized === null || validateWizardUrl(normalized)) return null;
	return normalized;
}

export function validateWizardUrl(url: string): string | null {
	if (!url.trim()) return "URL is required";
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return "URL must use HTTPS";
		const labels = parsed.hostname.replace(/\.$/, "").split(".");
		if (labels.length < 2 || labels.some(l => l.length === 0)) {
			return "URL must include a full domain (e.g., tenant.console.ves.volterra.io)";
		}
		return null;
	} catch {
		return "Invalid URL format";
	}
}

function prefill(input: Input, value: string): void {
	input.setValue(value);
	input.setCursorToEnd();
}

export function validateWizardName(name: string): string | null {
	if (!name.trim()) return "Name is required";
	if (!NAME_PATTERN.test(name)) return "Name must be 1-64 characters: letters, digits, hyphens, underscores";
	return null;
}

function validationFailureMessage(reason: TokenValidationResult["failureReason"]): string {
	switch (reason) {
		case "unauthorized":
			return "Authentication failed (HTTP 401) — check your token";
		case "forbidden":
			return "Access forbidden (HTTP 403) — check token permissions";
		case "redirect":
			return "The tenant redirected this request — check the tenant URL";
		case "non_json":
			return "The tenant returned a non-JSON response — check the tenant URL";
		case "rate_limited":
			return "The tenant rate-limited validation — retry shortly";
		case "server":
			return "The tenant server failed validation — retry shortly";
		case "timeout":
			return "Validation timed out — check network access and the tenant URL";
		default:
			return "Could not reach the tenant — check the URL and network";
	}
}

function validationDetails(state: WizardState, httpStatus?: number, latencyMs?: number): string {
	const maskedToken = state.token.length > 4 ? `${"*".repeat(8)}${state.token.slice(-4)}` : "****";
	const status = httpStatus === undefined ? "n/a" : String(httpStatus);
	const latency = latencyMs === undefined ? "n/a" : `${latencyMs}ms`;
	return `Endpoint: ${state.url}/api/web/namespaces | HTTP: ${status} | Latency: ${latency} | Token: ${maskedToken} (${state.token.length} chars)`;
}

type WizardStep =
	| "url"
	| "token"
	| "name"
	| "validating"
	| "namespace"
	| "username"
	| "password"
	| "confirm"
	| "activate";

interface WizardState {
	url: string;
	token: string;
	name: string;
	namespace: string;
	/** Web-console login username (optional) — stored as the XCSH_USERNAME env var. */
	username: string;
	/** Web-console login password (optional) — stored as the XCSH_CONSOLE_PASSWORD env var. */
	password: string;
}

/**
 * Build the XCSHContext the wizard will persist from its collected state.
 *
 * The optional web-console credentials become generic env vars (XCSH_USERNAME /
 * XCSH_CONSOLE_PASSWORD); any secret-looking key (the password) is auto-marked
 * sensitive so it is masked in `/context show` and redacted on export. Exported
 * so the persistence shape is unit-testable without driving the TUI.
 */
export function buildWizardContext(state: WizardState): XCSHContext {
	const context: XCSHContext = {
		name: state.name,
		apiUrl: state.url,
		apiToken: state.token,
		defaultNamespace: state.namespace,
	};
	const env: Record<string, string> = {};
	if (state.username) env[XCSH_USERNAME] = state.username;
	if (state.password) env[XCSH_CONSOLE_PASSWORD] = state.password;
	if (Object.keys(env).length > 0) {
		context.env = env;
		const sensitiveKeys = Object.keys(env).filter(isSensitiveEnvKey);
		if (sensitiveKeys.length > 0) context.sensitiveKeys = sensitiveKeys;
	}
	return context;
}

export class ContextAddWizard extends Container {
	#currentStep: WizardStep = "url";
	#state: WizardState = { url: "", token: "", name: "", namespace: "default", username: "", password: "" };
	#contentContainer: Container;
	#inputField: Input | null = null;
	#selectedIndex = 0;
	#validationError: string | null = null;
	#validationFailed = false;
	#validationInFlight = false;
	#validationDetails: string | null = null;
	#onCompleteCallback: (context: XCSHContext, activate: boolean) => void;
	#onCancelCallback: () => void;
	#onRenderCallback: () => void;

	constructor(
		onComplete: (context: XCSHContext, activate: boolean) => void,
		onCancel: () => void,
		onRender: () => void,
	) {
		super();
		this.#onCompleteCallback = onComplete;
		this.#onCancelCallback = onCancel;
		this.#onRenderCallback = onRender;

		// Add border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new TruncatedText(theme.bold("Add F5 XC Context")));
		this.addChild(new Spacer(1));

		// Content container for step-specific content
		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Render first step
		this.#renderStep();
	}

	#requestRender(): void {
		this.#onRenderCallback();
	}

	#renderStep(): void {
		this.#contentContainer.clear();
		this.#inputField = null;

		switch (this.#currentStep) {
			case "url":
				this.#renderUrlStep();
				break;
			case "token":
				this.#renderTokenStep();
				break;
			case "name":
				this.#renderNameStep();
				break;
			case "validating":
				this.#renderValidatingStep();
				break;
			case "namespace":
				this.#renderNamespaceStep();
				break;
			case "username":
				this.#renderUsernameStep();
				break;
			case "password":
				this.#renderPasswordStep();
				break;
			case "confirm":
				this.#renderConfirmStep();
				break;
			case "activate":
				this.#renderActivateStep();
				break;
		}
	}

	#renderUrlStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 1: Tenant URL")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter the F5 XC console URL:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		prefill(this.#inputField, this.#state.url);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to cancel]"), 0, 0));
	}

	#renderTokenStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 2: API Token")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter your API token:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		this.#inputField.setMasked(true);
		prefill(this.#inputField, this.#state.token);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to go back]"), 0, 0));
	}

	#renderNameStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 3: Context Name")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter a name for this context:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		const initialValue = this.#state.name || deriveTenantFromUrl(this.#state.url) || "";
		prefill(this.#inputField, initialValue);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to go back]"), 0, 0));
	}

	#renderValidatingStep(): void {
		if (this.#validationFailed) {
			this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Validation Failed")));
			this.#contentContainer.addChild(new Spacer(1));
			if (this.#validationDetails) {
				this.#contentContainer.addChild(new Text(theme.fg("muted", this.#validationDetails), 0, 0));
				this.#contentContainer.addChild(new Spacer(1));
			}
			this.#contentContainer.addChild(
				new Text(theme.fg("error", `✗ ${this.#validationError ?? "Validation failed"}`), 0, 0),
			);
			this.#contentContainer.addChild(new Spacer(1));
			const options = ["Retry", "Edit (start over)"];
			for (let i = 0; i < options.length; i++) {
				const isSelected = i === this.#selectedIndex;
				const prefix = isSelected ? theme.fg("chromeAccent", `${theme.nav.cursor} `) : "  ";
				const text = isSelected ? theme.fg("contentAccent", options[i]) : options[i];
				this.#contentContainer.addChild(new Text(prefix + text, 0, 0));
			}
			this.#contentContainer.addChild(new Spacer(1));
			this.#contentContainer.addChild(
				new Text(theme.fg("muted", "[↑↓ to navigate, Enter to select, Esc to go back]"), 0, 0),
			);
			return;
		}
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 4: Validating Token")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Validating credentials...", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		if (!this.#validationInFlight) void this.#runValidation();
	}

	async #runValidation(): Promise<void> {
		if (this.#validationInFlight) return;
		this.#validationInFlight = true;
		try {
			const { ContextService } = await import("../../services/xcsh-context");
			const service = await ContextService.getOrInit();
			const result = await service.validateToken({
				apiUrl: this.#state.url,
				apiToken: this.#state.token,
				timeoutMs: 5000,
			});

			if (result.status === "connected") {
				this.#currentStep = "namespace";
				this.#selectedIndex = 0;
				this.#validationError = null;
				this.#renderStep();
				this.#requestRender();
				return;
			}

			// Failure — show error with Retry/Edit options.
			this.#validationFailed = true;
			this.#selectedIndex = 0;
			this.#validationError = validationFailureMessage(result.failureReason);
			this.#validationDetails = validationDetails(this.#state, result.httpStatus, result.latencyMs);
			this.#renderStep();
			this.#requestRender();
		} catch (error) {
			this.#validationFailed = true;
			this.#selectedIndex = 0;
			this.#validationError = error instanceof Error ? error.message : "Validation request failed";
			this.#validationDetails = validationDetails(this.#state);
			this.#renderStep();
			this.#requestRender();
		} finally {
			this.#validationInFlight = false;
		}
	}

	#renderNamespaceStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 5: Default Namespace")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter the default namespace:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		prefill(this.#inputField, this.#state.namespace);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to go back]"), 0, 0));
	}

	#renderUsernameStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 6: Web-Console Username")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter the web-console login username (optional):", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		prefill(this.#inputField, this.#state.username);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		this.#contentContainer.addChild(
			new Text(theme.fg("muted", "[Enter to continue (empty to skip), Esc to go back]"), 0, 0),
		);
	}

	#renderPasswordStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 7: Web-Console Password")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter the web-console login password (optional):", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		this.#inputField.setMasked(true);
		prefill(this.#inputField, this.#state.password);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		this.#contentContainer.addChild(
			new Text(theme.fg("muted", "[Enter to continue (empty to skip), Esc to go back]"), 0, 0),
		);
	}

	#renderConfirmStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 8: Confirm")));
		this.#contentContainer.addChild(new Spacer(1));

		// Summary table
		this.#contentContainer.addChild(new Text(`Name: ${theme.fg("contentAccent", this.#state.name)}`, 0, 0));
		this.#contentContainer.addChild(new Text(`URL: ${this.#state.url}`, 0, 0));
		const masked = this.#state.token.length > 4 ? `${"*".repeat(8)}${this.#state.token.slice(-4)}` : "****";
		this.#contentContainer.addChild(new Text(`Token: ${masked}`, 0, 0));
		this.#contentContainer.addChild(new Text(`Namespace: ${this.#state.namespace}`, 0, 0));
		if (this.#state.username) {
			this.#contentContainer.addChild(new Text(`Username: ${this.#state.username}`, 0, 0));
		}
		if (this.#state.password) {
			this.#contentContainer.addChild(new Text(`Console Password: ${"*".repeat(8)}`, 0, 0));
		}
		this.#contentContainer.addChild(new Spacer(1));

		this.#contentContainer.addChild(new Text("Save this context?", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		const options = ["Yes", "No"];
		for (let i = 0; i < options.length; i++) {
			const isSelected = i === this.#selectedIndex;
			const prefix = isSelected ? theme.fg("chromeAccent", `${theme.nav.cursor} `) : "  ";
			const text = isSelected ? theme.fg("contentAccent", options[i]) : options[i];
			this.#contentContainer.addChild(new Text(prefix + text, 0, 0));
		}

		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(
			new Text(theme.fg("muted", "[↑↓ to navigate, Enter to select, Esc to go back]"), 0, 0),
		);
	}

	#renderActivateStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 9: Activate")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Activate this context now?", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		const options = ["Yes", "No"];
		for (let i = 0; i < options.length; i++) {
			const isSelected = i === this.#selectedIndex;
			const prefix = isSelected ? theme.fg("chromeAccent", `${theme.nav.cursor} `) : "  ";
			const text = isSelected ? theme.fg("contentAccent", options[i]) : options[i];
			this.#contentContainer.addChild(new Text(prefix + text, 0, 0));
		}

		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(
			new Text(theme.fg("muted", "[↑↓ to navigate, Enter to select, Esc to go back]"), 0, 0),
		);
	}

	handleInput(keyData: string): void {
		// Handle Ctrl+C to cancel wizard immediately
		if (keyData === "\x03") {
			this.#onCancelCallback();
			return;
		}

		// Handle Escape
		if (matchesAppInterrupt(keyData)) {
			if (this.#currentStep === "url") {
				this.#onCancelCallback();
				return;
			}
			if (this.#currentStep === "validating" && !this.#validationFailed) {
				return;
			}
			if (this.#currentStep === "validating" && this.#validationFailed) {
				this.#validationFailed = false;
				this.#validationError = null;
				this.#currentStep = "url";
				this.#renderStep();
				this.#requestRender();
				return;
			}
			this.#goBack();
			return;
		}

		// If we have an input field, let it handle the input
		if (this.#inputField) {
			if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
				this.#saveInputAndProceed();
				return;
			}
			this.#inputField.handleInput(keyData);
			return;
		}

		// Selector steps - handle Enter
		if (matchesKey(keyData, "enter") || matchesKey(keyData, "return") || keyData === "\n") {
			this.#selectCurrentOption();
			return;
		}

		// Handle up/down arrows for selectors
		if (matchesKey(keyData, "up")) {
			this.#moveSelection(-1);
			return;
		}
		if (matchesKey(keyData, "down")) {
			this.#moveSelection(1);
			return;
		}
	}

	#saveInputAndProceed(): void {
		if (!this.#inputField) return;

		const rawValue = this.#inputField.getValue();
		const value = rawValue.trim();

		switch (this.#currentStep) {
			case "url": {
				const normalizedUrl = normalizeWizardUrl(rawValue);
				const urlError = normalizedUrl
					? null
					: validateWizardUrl(normalizeWizardCredential(rawValue, XCSH_API_URL) ?? "");
				if (urlError) {
					this.#validationError = urlError;
					this.#renderStep();
					return;
				}
				if (!normalizedUrl) {
					this.#validationError = "Tenant URL must be a raw URL or XCSH_API_URL assignment";
					this.#renderStep();
					return;
				}
				this.#validationError = null;
				this.#state.url = normalizedUrl;
				this.#currentStep = "token";
				break;
			}
			case "token": {
				const normalizedToken = normalizeWizardCredential(rawValue, XCSH_API_TOKEN);
				if (normalizedToken === null) {
					this.#validationError = "Token must be a raw value or XCSH_API_TOKEN assignment";
					this.#renderStep();
					return;
				}
				if (!normalizedToken) {
					this.#validationError = "API token is required";
					this.#renderStep();
					return;
				}
				this.#validationError = null;
				this.#state.token = normalizedToken;
				this.#currentStep = "name";
				break;
			}
			case "name": {
				const nameError = validateWizardName(value);
				if (nameError) {
					this.#validationError = nameError;
					this.#renderStep();
					return;
				}
				this.#validationError = null;
				this.#state.name = value;
				this.#currentStep = "validating";
				this.#selectedIndex = 0;
				break;
			}
			case "namespace": {
				this.#state.namespace = value || "default";
				this.#currentStep = "username";
				break;
			}
			case "username": {
				const username = normalizeWizardCredential(rawValue, XCSH_USERNAME);
				if (username === null) {
					this.#validationError = "Username must be a raw value or XCSH_USERNAME assignment";
					this.#renderStep();
					return;
				}
				this.#state.username = username;
				this.#currentStep = "password";
				break;
			}
			case "password": {
				const password = normalizeWizardCredential(rawValue, XCSH_CONSOLE_PASSWORD);
				if (password === null) {
					this.#validationError = "Password must be a raw value or XCSH_CONSOLE_PASSWORD assignment";
					this.#renderStep();
					return;
				}
				this.#state.password = password;
				this.#currentStep = "confirm";
				this.#selectedIndex = 0;
				break;
			}
		}

		this.#inputField = null;
		this.#renderStep();
	}

	#selectCurrentOption(): void {
		switch (this.#currentStep) {
			case "validating": {
				this.#validationFailed = false;
				if (this.#selectedIndex === 0) {
					// Retry
					this.#validationError = null;
					this.#validationDetails = null;
					this.#renderStep();
				} else {
					// Edit — go back to url
					this.#currentStep = "url";
					this.#state.token = "";
					this.#state.password = "";
					this.#validationError = null;
					this.#validationDetails = null;
					this.#selectedIndex = 0;
					this.#renderStep();
				}
				return;
			}
			case "confirm": {
				if (this.#selectedIndex === 0) {
					// Yes — advance to activate
					this.#currentStep = "activate";
					this.#selectedIndex = 0;
					this.#renderStep();
				} else {
					// No — go back to url
					this.#currentStep = "url";
					this.#selectedIndex = 0;
					this.#renderStep();
				}
				return;
			}
			case "activate": {
				const context = buildWizardContext(this.#state);
				this.#onCompleteCallback(context, this.#selectedIndex === 0);
				return;
			}
		}
	}

	#moveSelection(delta: number): void {
		const maxIndex = this.#getMaxIndexForCurrentStep();
		this.#selectedIndex = (this.#selectedIndex + delta + maxIndex + 1) % (maxIndex + 1);
		this.#renderStep();
		this.#requestRender();
	}

	#getMaxIndexForCurrentStep(): number {
		switch (this.#currentStep) {
			case "validating":
			case "confirm":
			case "activate":
				return 1;
			default:
				return 0;
		}
	}

	#goBack(): void {
		this.#validationError = null;
		this.#selectedIndex = 0;

		switch (this.#currentStep) {
			case "token":
				this.#currentStep = "url";
				break;
			case "name":
				this.#currentStep = "token";
				break;
			case "namespace":
				this.#currentStep = "name";
				break;
			case "username":
				this.#currentStep = "namespace";
				break;
			case "password":
				this.#currentStep = "username";
				break;
			case "confirm":
				this.#currentStep = "password";
				break;
			case "activate":
				this.#currentStep = "confirm";
				break;
		}

		this.#renderStep();
	}
}
