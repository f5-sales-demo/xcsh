import { Container, Input, matchesKey, Spacer, Text, TruncatedText } from "@f5xc-salesdemos/pi-tui";
import type { F5XCContext } from "../../services/f5xc-context";
import { deriveTenantFromUrl } from "../../services/f5xc-env";
import { theme } from "../theme/theme";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

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

export function validateWizardName(name: string): string | null {
	if (!name.trim()) return "Name is required";
	if (!NAME_PATTERN.test(name)) return "Name must be 1-64 characters: letters, digits, hyphens, underscores";
	return null;
}

type WizardStep = "url" | "token" | "name" | "validating" | "namespace" | "confirm" | "activate";

interface WizardState {
	url: string;
	token: string;
	name: string;
	namespace: string;
}

export class ContextAddWizard extends Container {
	#currentStep: WizardStep = "url";
	#state: WizardState = { url: "", token: "", name: "", namespace: "default" };
	#contentContainer: Container;
	#inputField: Input | null = null;
	#selectedIndex = 0;
	#validationError: string | null = null;
	#validationFailed = false;
	#onCompleteCallback: (context: F5XCContext, activate: boolean) => void;
	#onCancelCallback: () => void;
	#onRenderCallback: () => void;

	constructor(
		onComplete: (context: F5XCContext, activate: boolean) => void,
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
		this.#inputField.setValue(this.#state.url);
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
		this.#inputField.setValue(this.#state.token);
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
		const prefill = this.#state.name || deriveTenantFromUrl(this.#state.url) || "";
		this.#inputField.setValue(prefill);
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

		void this.#runValidation();
	}

	async #runValidation(): Promise<void> {
		try {
			const { ContextService } = await import("../../services/f5xc-context");
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

			// Failure — show error with Retry/Edit options
			this.#validationFailed = true;
			this.#selectedIndex = 0;
			const errorMsg =
				result.status === "auth_error"
					? "Authentication failed — check your token"
					: "Could not reach the server — check the URL";
			this.#contentContainer.clear();
			this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Validation Failed")));
			this.#contentContainer.addChild(new Spacer(1));
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${errorMsg}`), 0, 0));
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
			this.#requestRender();
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			this.#validationFailed = true;
			this.#selectedIndex = 0;
			this.#contentContainer.clear();
			this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Validation Failed")));
			this.#contentContainer.addChild(new Spacer(1));
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${errorMsg}`), 0, 0));
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
			this.#requestRender();
		}
	}

	#renderNamespaceStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 5: Default Namespace")));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter the default namespace:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		this.#inputField.setValue(this.#state.namespace);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to go back]"), 0, 0));
	}

	#renderConfirmStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 6: Confirm")));
		this.#contentContainer.addChild(new Spacer(1));

		// Summary table
		this.#contentContainer.addChild(new Text(`Name: ${theme.fg("contentAccent", this.#state.name)}`, 0, 0));
		this.#contentContainer.addChild(new Text(`URL: ${this.#state.url}`, 0, 0));
		const masked = this.#state.token.length > 4 ? `${"*".repeat(8)}${this.#state.token.slice(-4)}` : "****";
		this.#contentContainer.addChild(new Text(`Token: ${masked}`, 0, 0));
		this.#contentContainer.addChild(new Text(`Namespace: ${this.#state.namespace}`, 0, 0));
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
		this.#contentContainer.addChild(new Text(theme.fg("contentAccent", "Step 7: Activate")));
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

		const value = this.#inputField.getValue().trim();

		switch (this.#currentStep) {
			case "url": {
				const urlError = validateWizardUrl(value);
				if (urlError) {
					this.#validationError = urlError;
					this.#renderStep();
					return;
				}
				this.#validationError = null;
				this.#state.url = value;
				this.#currentStep = "token";
				break;
			}
			case "token": {
				if (!value) {
					this.#validationError = "API token is required";
					this.#renderStep();
					return;
				}
				this.#validationError = null;
				this.#state.token = value;
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
					this.#renderStep();
				} else {
					// Edit — go back to url
					this.#currentStep = "url";
					this.#validationError = null;
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
				const context: F5XCContext = {
					name: this.#state.name,
					apiUrl: this.#state.url,
					apiToken: this.#state.token,
					defaultNamespace: this.#state.namespace,
				};
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
			case "confirm":
				this.#currentStep = "namespace";
				break;
			case "activate":
				this.#currentStep = "confirm";
				break;
		}

		this.#renderStep();
	}
}
