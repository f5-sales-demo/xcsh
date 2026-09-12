import {
	type AcquireMode,
	acquirePage,
	type BrowserAcquisitionStep,
	dedicatedProfileDir,
	defaultProfileDir,
} from "../browser/acquire";
import { locateChrome } from "../browser/chrome-locate";
import { CdpBrowserProvider } from "../browser/provider";
import type { ActionReview } from "../modes/components/reviewed-action";
import { runReviewedAction } from "../modes/components/reviewed-action-dialog";
import { ConnectionChoiceComponent } from "../modes/components/selector-frame";
import type { InteractiveModeContext } from "../modes/types";
import { assertLoopbackBrowserUrl, resolveBrowserConnectUrl } from "../tools/browser";

type ChromeSettings = { get(key: string): unknown };
export interface ChromeReviewTarget {
	endpoint: string;
	executable: string | null;
	profile: string | null;
	fallback: string;
	configured: boolean;
	running: boolean;
	debuggable: boolean;
}
const chromeDependencies = {
	async inspect(settings: ChromeSettings): Promise<ChromeReviewTarget> {
		const configured = resolveBrowserConnectUrl(settings);
		const endpoint = configured ?? "http://127.0.0.1:9222";
		try {
			assertLoopbackBrowserUrl(endpoint);
		} catch {
			throw new Error("Chrome connection URL must be a valid loopback HTTP address. Its value is hidden.");
		}
		// Never put credentials in a review, diagnostic, or browser launch argument.
		const parsed = new URL(endpoint);
		if (parsed.username || parsed.password || parsed.search || parsed.hash)
			throw new Error("Chrome connection URL must not contain credentials, query parameters, or a fragment.");
		const state = await new CdpBrowserProvider(settings).status();
		return {
			endpoint,
			executable: locateChrome({ settings })?.path ?? null,
			profile: defaultProfileDir(),
			fallback: dedicatedProfileDir(),
			configured: !!configured,
			running: state.chromeRunning,
			debuggable: state.debuggableNow,
		};
	},
	async execute(
		settings: ChromeSettings,
		beforeAction: (step: BrowserAcquisitionStep) => Promise<void>,
	): Promise<AcquireMode> {
		const result = await acquirePage({ settings, allowRelaunch: true, beforeAction });
		return result.mode;
	},
};
const chromeActive = new WeakSet<InteractiveModeContext>();

/** Interactive-only consent adapter. The CLI retains its existing command contract. */
export async function handleChromeCommand(
	ctx: InteractiveModeContext,
	argument: string,
	dependencies = chromeDependencies,
): Promise<void> {
	const arg = argument.trim().toLowerCase();
	if (!["", "status", "relaunch"].includes(arg)) {
		ctx.showError("Usage: /chrome [status|relaunch]");
		return;
	}
	if (chromeActive.has(ctx)) {
		ctx.showStatus("A Chrome operation is already open.");
		return;
	}
	chromeActive.add(ctx);
	try {
		const settings = ctx.settings;
		const inspect = () => dependencies.inspect(settings);
		const initial = await inspect();
		if (arg !== "relaunch") {
			ctx.showStatus(
				`Chrome · ${initial.executable ?? "executable unavailable"}\nTarget: ${initial.endpoint}\nProcess running: ${initial.running ? "yes" : "no"} · Debug endpoint: ${initial.debuggable ? "reachable" : initial.configured ? "configured but unavailable" : "unavailable"}\nAuthentication is not verified. No browser was launched or restarted.`,
			);
			return;
		}
		const review = (target: ChromeReviewTarget): ActionReview => ({
			identity: "chrome:interactive-acquisition",
			scope: `Local browser · ${target.endpoint}`,
			revision: JSON.stringify(target),
			changes: [
				{
					field: "Executable",
					before: target.executable ?? "unavailable",
					after: target.executable ?? "attach only",
				},
				{
					field: "Browser access",
					before: target.debuggable
						? "Debug endpoint reachable"
						: target.configured
							? "Configured endpoint; availability unverified"
							: target.running
								? "Running"
								: "Not running",
					after: "Connect for xcsh automation",
				},
				{
					field: "Profile",
					before: target.profile ?? "Default unavailable",
					after: target.configured
						? "Existing endpoint profile only"
						: `${target.profile ?? "Default unavailable"}; fallback: ${target.fallback}`,
				},
			],
			consequence: target.configured
				? "Attaches only to the configured endpoint; failure does not launch another browser. Local debug access can read cookies and session data. Authentication is not verified."
				: "May attach, launch, or gracefully quit and reopen your Chrome. The platform quit command can affect all matching Chrome processes, not just this profile. Windows and unsaved work may be affected. If the default profile cannot be used, creates/uses the isolated fallback profile. A loopback debug port lets local processes read cookies and session data; this command does not close that port afterward. Authentication is not verified.",
		});
		let mode: AcquireMode | undefined;
		const outcome = await runReviewedAction(ctx, "Chrome access", {
			review: review(initial),
			resolve: async () => {
				if (ctx.settings !== settings) return undefined;
				const target = await inspect();
				return { target, review: review(target) };
			},
			execute: async target => {
				// Pin settings to the reviewed target instead of consulting changing defaults mid-operation.
				const pinned: ChromeSettings = {
					get: key =>
						key === "browser.connectUrl"
							? target.configured
								? target.endpoint
								: undefined
							: key === "browser.chromePath"
								? target.executable
								: undefined,
				};
				mode = await dependencies.execute(pinned, async step => {
					if (ctx.settings !== settings) throw new Error("Chrome settings target changed. Review again.");
					const current = await inspect();
					// Running/debuggable state can change because of our own earlier steps.
					// Destination changes cannot: stop before the next effect, including quit.
					for (const key of ["endpoint", "executable", "profile", "fallback", "configured"] as const)
						if (current[key] !== target[key]) throw new Error("Chrome acquisition target changed. Review again.");
					if (
						step.endpoint !== target.endpoint ||
						(step.action !== "attach" &&
							(target.configured ||
								!target.executable ||
								step.executable !== target.executable ||
								!step.profile ||
								(step.profile !== target.profile && step.profile !== target.fallback)))
					)
						throw new Error("Chrome acquisition exceeded its reviewed target. Review again.");
				});
			},
		});
		if (outcome === "succeeded")
			ctx.showStatus(
				`Chrome ready (${mode}). ${mode === "launched-dedicated" ? "Using an isolated profile, not your usual signed-in session." : "Authentication has not been verified."}`,
			);
		else if (outcome === "unresolved")
			ctx.showError(
				"Chrome access remains unresolved; the browser may have changed. Check /chrome status before reviewing another attempt.",
			);
	} catch (error) {
		ctx.showError(error instanceof Error ? error.message : String(error));
	} finally {
		chromeActive.delete(ctx);
	}
}

const active = new WeakSet<InteractiveModeContext>();
const unresolved = new WeakMap<InteractiveModeContext, { proposed: boolean; needsReset: boolean }>();
const mode = (headless: boolean) => (headless ? "headless" : "visible");
export async function handleBrowserModeCommand(ctx: InteractiveModeContext, argument: string): Promise<void> {
	const arg = argument.trim().toLowerCase();
	if (!["", "status", "headless", "hidden", "visible", "show", "headful"].includes(arg)) {
		ctx.showError("Usage: /browser [status|headless|visible]");
		return;
	}
	const settings = ctx.settings;
	const state = () => settings.inspectScopes("browser.headless");
	if (arg === "status") {
		const current = state();
		ctx.showStatus(
			`Browser default: ${mode(current.userValue)} · Effective setting: ${mode(current.effectiveValue)} · ${settings.get("browser.enabled") ? "enabled" : "disabled"}. Running browser state is not verified by this settings report.`,
		);
		return;
	}
	if (!settings.get("browser.enabled")) {
		ctx.showWarning("Browser tool is disabled. Enable it in /settings before changing its mode.");
		return;
	}
	if (active.has(ctx)) {
		ctx.showStatus("A browser-mode review is already open.");
		return;
	}
	active.add(ctx);
	try {
		let proposed: boolean;
		if (!arg) {
			const current = state();
			const choice = await ctx.showHookCustom<number | undefined>(
				(ui, _theme, _keys, done) =>
					new ConnectionChoiceComponent(
						"Browser mode",
						`User default: ${mode(current.userValue)} · Effective: ${mode(current.effectiveValue)}`,
						[{ label: "Cancel" }, { label: "Use headless browser" }, { label: "Use visible browser" }],
						done,
						() => done(undefined),
						() => ui.terminal.rows,
					),
			);
			if (!choice) return;
			proposed = choice === 1;
		} else proposed = arg === "headless" || arg === "hidden";
		const initial = state();
		if (initial.userValue === proposed && unresolved.get(ctx)?.proposed !== proposed) {
			ctx.showStatus(`Browser default is already ${mode(proposed)}; nothing saved or restarted.`);
			return;
		}
		const session = ctx.session;
		const tool = session.getToolByName("browser");
		let needsReset = false;
		const review = (): ActionReview => {
			const current = state();
			const effective = current.runtimeValue ?? current.projectValue ?? proposed;
			const pending = unresolved.get(ctx);
			needsReset = pending?.proposed === proposed ? pending.needsReset : current.effectiveValue !== effective;
			return {
				identity: `settings:${settings.getAgentDir()}:browser.headless`,
				scope: "User defaults · Project and runtime overrides remain unchanged",
				revision: JSON.stringify([current, settings.get("browser.enabled")]),
				changes: [
					{ field: "User default", before: mode(current.userValue), after: mode(proposed) },
					{ field: "Effective setting", before: mode(current.effectiveValue), after: mode(effective) },
				],
				consequence: `${effective !== proposed ? "An override masks this default. " : ""}Saves the user preference.${needsReset ? " Resets the active browser when supported; pages may close. The next browser use starts with the effective setting." : " Does not reset the browser because its effective setting is unchanged."}`,
			};
		};
		const outcome = await runReviewedAction(ctx, "browser mode", {
			review: review(),
			resolve: async () =>
				ctx.settings === settings &&
				ctx.session === session &&
				settings.get("browser.enabled") &&
				session.getToolByName("browser") === tool
					? { review: review(), target: settings }
					: undefined,
			execute: async target => {
				const before = state();
				unresolved.set(ctx, { proposed, needsReset });
				if (state().userValue !== proposed) target.set("browser.headless", proposed);
				await target.flush({ throwOnError: true });
				const after = state();
				if (
					after.runtimeValue !== before.runtimeValue ||
					after.projectValue !== before.projectValue ||
					after.userValue !== proposed ||
					ctx.settings !== settings ||
					ctx.session !== session ||
					!settings.get("browser.enabled") ||
					session.getToolByName("browser") !== tool
				)
					throw new Error(
						"Preference save finished, but the target or overrides changed. Review again before resetting the browser.",
					);
				if (needsReset && tool && "restartForModeChange" in tool) {
					try {
						await (tool as { restartForModeChange(): Promise<void> }).restartForModeChange();
					} catch (error) {
						throw new Error(
							`Preference saved; browser reset failed: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
				unresolved.delete(ctx);
			},
		});
		if (outcome === "succeeded")
			ctx.showStatus(
				`Browser default saved: ${mode(proposed)}. Effective setting: ${mode(state().effectiveValue)}; applies on next browser use.`,
			);
		else if (outcome === "unresolved")
			ctx.showError("Browser change remains unresolved. Retry the same mode to complete saving or browser reset.");
	} catch (error) {
		ctx.showError(error instanceof Error ? error.message : String(error));
	} finally {
		active.delete(ctx);
	}
}
