import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, rmdir } from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { Text } from "@f5-sales-demo/pi-tui";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { resolveLocalUrlToPath } from "../src/internal-urls";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import * as externalEditor from "../src/utils/external-editor";

describe("InteractiveMode plan review rendering", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-review-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-5");
		if (!model) {
			throw new Error("Expected claude-sonnet-5 to exist in registry");
		}

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: "Test",
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
			toolRegistry: new Map([
				[
					"exit_plan_mode",
					{
						name: "exit_plan_mode",
						label: "Exit plan mode",
						description: "Synthetic plan approval tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [], details: {} }),
					},
				],
			]),
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("re-appends refreshed plan review previews at the chat tail", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# First plan\n\nalpha");

		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Stay in plan mode");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		const firstPreview = mode.chatContainer.children.at(-1);
		expect(firstPreview).toBeDefined();
		expect(firstPreview!.render(120).join("\n")).toContain("First plan");

		const marker = new Text("MARKER", 0, 0);
		mode.chatContainer.addChild(marker);
		await Bun.write(resolvedPlanPath, "# Second plan\n\nbeta");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		expect(mode.chatContainer.children.at(-1)).toBe(firstPreview);
		expect(mode.chatContainer.children.at(-2)).toBe(marker);
		expect(firstPreview!.render(120).join("\n")).toContain("Second plan");
	});

	it.each(["Approve and execute", "Refine plan"])("session changes invalidate plan action %s", async choice => {
		const planFilePath = path.join(tempDir.path(), "review-plan.md");
		await Bun.write(planFilePath, "# Session-specific plan");
		mode.planModeEnabled = true;
		const clear = vi.spyOn(mode, "handleClearCommand").mockResolvedValue();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		const input = vi.spyOn(mode, "showHookInput").mockResolvedValue("Unreviewed refinement");
		const warning = vi.spyOn(mode, "showWarning");
		vi.spyOn(mode, "showHookSelector").mockImplementation(async () => {
			await session.sessionManager.newSession();
			return choice;
		});
		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath: planFilePath,
			planExists: true,
			title: "PLAN",
		});
		expect(warning).toHaveBeenCalledWith("The plan review session changed. Open a new review before continuing.");
		expect(clear).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(input).not.toHaveBeenCalled();
	});
	it.each([false, true])(
		"external editor avoids unchanged or stale-session writes (session changed: %s)",
		async changed => {
			const planFilePath = path.join(tempDir.path(), "editor-plan.md");
			await Bun.write(planFilePath, "Original plan");
			mode.planModeEnabled = true;
			vi.spyOn(externalEditor, "getEditorCommand").mockReturnValue("synthetic-editor");
			vi.spyOn(externalEditor, "openInEditor").mockImplementation(async () => {
				if (changed) await session.sessionManager.newSession();
				return changed ? "Stale edit" : "Original plan";
			});
			const finished = Promise.withResolvers<void>();
			vi.spyOn(mode.ui, "stop").mockImplementation(() => {});
			vi.spyOn(mode.ui, "start").mockImplementation(() => {
				finished.resolve();
			});
			const write = vi.spyOn(Bun, "write");
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, _choices, options) => {
				options?.onExternalEditor?.();
				await finished.promise;
				return "Stay in plan mode";
			});
			await mode.handleExitPlanModeTool({
				planFilePath,
				finalPlanFilePath: planFilePath,
				planExists: true,
				title: "PLAN",
			});
			expect(write).not.toHaveBeenCalled();
			expect(await Bun.file(planFilePath).text()).toBe("Original plan");
		},
	);
	it.each(["cancel", "confirm", "file-drift"])(
		"changed external-editor text requires review before saving (%s)",
		async action => {
			const planFilePath = path.join(tempDir.path(), "edited-plan.md");
			await Bun.write(planFilePath, "Original plan");
			mode.planModeEnabled = true;
			vi.spyOn(externalEditor, "getEditorCommand").mockReturnValue("synthetic-editor");
			vi.spyOn(externalEditor, "openInEditor").mockResolvedValue("Edited plan");
			const resumed = Promise.withResolvers<void>();
			vi.spyOn(mode.ui, "stop").mockImplementation(() => {});
			vi.spyOn(mode.ui, "start").mockImplementation(() => {
				resumed.resolve();
			});
			let reviewFinished: Promise<unknown> | undefined;
			let rendered = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				expect(await Bun.file(planFilePath).text()).toBe("Original plan");
				const completed = Promise.withResolvers<any>();
				reviewFinished = completed.promise;
				const component = await factory(
					{ terminal: { rows: 32 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				rendered = Bun.stripANSI(component.render(100).join("\n"));
				if (action === "file-drift") await Bun.write(planFilePath, "Concurrent plan");
				if (action !== "cancel") component.handleInput("\x1b[B");
				component.handleInput("\r");
				if (action === "file-drift") {
					for (
						let i = 0;
						i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("proposal changed");
						i++
					)
						await Bun.sleep(5);
					const refreshed = Bun.stripANSI(component.render(100).join("\n"));
					expect(refreshed).toContain("proposal changed");
					expect(refreshed).toContain("Concurrent plan → Edited plan");
					expect(await Bun.file(planFilePath).text()).toBe("Concurrent plan");
					component.handleInput("\r"); // Renewed review resets to Cancel.
				}
				return completed.promise;
			});
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, _choices, options) => {
				options?.onExternalEditor?.();
				await resumed.promise;
				await Bun.sleep(5);
				await reviewFinished;
				return "Stay in plan mode";
			});
			await mode.handleExitPlanModeTool({
				planFilePath,
				finalPlanFilePath: planFilePath,
				planExists: true,
				title: "PLAN",
			});
			expect(rendered).toContain("Original plan → Edited plan");
			expect(await Bun.file(planFilePath).text()).toBe(
				action === "confirm" ? "Edited plan" : action === "file-drift" ? "Concurrent plan" : "Original plan",
			);
		},
	);
	it("changed plan content is shown for renewed approval instead of executing", async () => {
		const planFilePath = "local://PLAN.md";
		const resolved = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolved, "# Reviewed plan");
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const clear = vi.spyOn(mode, "handleClearCommand").mockResolvedValue();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		let choices = 0;
		vi.spyOn(mode, "showHookSelector").mockImplementation(async () => {
			if (choices++ === 0) {
				await Bun.write(resolved, "# Changed plan");
				return "Approve and execute";
			}
			return "Stay in plan mode";
		});
		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath: planFilePath,
			planExists: true,
			title: "PLAN",
		});
		expect(choices).toBe(2);
		expect(clear).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.chatContainer.children.at(-1)!.render(100).join("\n")).toContain("Changed plan");
	});
	it("approval cancellation leaves the planning session and plan file unchanged", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://SYNTHETIC_APPROVED_PLAN.md";
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		const destination = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(source, "# Reviewed synthetic plan");
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const originalSessionId = session.sessionManager.getSessionId();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath,
			planExists: true,
			title: "SYNTHETIC_APPROVED_PLAN",
		});

		expect(rendered).toContain("Review plan approval");
		expect(rendered).toContain(originalSessionId);
		expect(rendered).toContain("Execution session file");
		expect(session.sessionManager.getSessionId()).toBe(originalSessionId);
		expect(mode.planModeEnabled).toBe(true);
		expect(await Bun.file(source).text()).toBe("# Reviewed synthetic plan");
		expect(await Bun.file(destination).exists()).toBe(false);
		expect(prompt).not.toHaveBeenCalled();
	});
	it("confirmed approval finalizes both plan copies and submits only in the saved execution session", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://SYNTHETIC_APPROVED_PLAN.md";
		const content = "# Execute synthetic plan\n\nUse only disposable fixtures.";
		const originalSessionId = session.sessionManager.getSessionId();
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => originalSessionId,
		});
		const approvedPlanningCopy = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => originalSessionId,
		});
		await Bun.write(source, content);
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		session.setPlanModeState({ enabled: true, planFilePath });
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		const newSession = vi.spyOn(session, "newSessionWithReviewedPreparation");
		let customCalls = 0;
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			customCalls++;
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 40 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			component.handleInput("\r");
			return completed.promise;
		});
		const prompt = vi.spyOn(session, "prompt").mockImplementation(async (_text, options) => {
			expect(options).toEqual({ synthetic: true });
			expect(session.sessionManager.getSessionId()).not.toBe(originalSessionId);
			const executionCopy = resolveLocalUrlToPath(finalPlanFilePath, {
				getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
				getSessionId: () => session.sessionManager.getSessionId(),
			});
			expect(await Bun.file(executionCopy).text()).toBe(content);
			const reopened = await SessionManager.open(session.sessionManager.getSessionFile()!);
			expect(reopened.getSessionId()).toBe(session.sessionManager.getSessionId());
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath,
			planExists: true,
			title: "SYNTHETIC_APPROVED_PLAN",
		});

		expect(customCalls).toBe(1);
		expect(rendered).toContain("Review plan approval");
		expect(rendered).toContain(`Planning session ${originalSessionId} → execution session`);
		expect(rendered).toContain("Plan destination: available → approved plan file");
		expect(rendered).toContain("Execution prompt: not submitted");
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(newSession).toHaveBeenCalledTimes(1);
		expect(session.sessionManager.getSessionId()).not.toBe(originalSessionId);
		expect(mode.planModeEnabled).toBe(false);
		expect(await Bun.file(source).exists()).toBe(false);
		expect(await Bun.file(approvedPlanningCopy).text()).toBe(content);
	});
	it("approval revalidates changed plan content and renews the Cancel-first review", async () => {
		const planFilePath = "local://PLAN.md";
		const changedPlan = "Changed plan that requires renewed review";
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(source, "Original reviewed plan");
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const originalSessionId = session.sessionManager.getSessionId();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		let renewed = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			await Bun.write(source, changedPlan);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			for (let i = 0; i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("proposal changed"); i++)
				await Bun.sleep(5);
			renewed = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath: planFilePath,
			planExists: true,
			title: "PLAN",
		});

		expect(renewed).toContain("The proposal changed. Review the updated values before confirming.");
		expect(renewed).toContain(`${Buffer.byteLength(changedPlan, "utf8")} bytes`);
		expect(session.sessionManager.getSessionId()).toBe(originalSessionId);
		expect(mode.planModeEnabled).toBe(true);
		expect(await Bun.file(source).text()).toBe(changedPlan);
		expect(prompt).not.toHaveBeenCalled();
	});
	it("extension veto leaves approval unresolved without mutating the planning session", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://VETOED_PLAN.md";
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		const destination = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(source, "Vetoed reviewed plan");
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		const originalSessionId = session.sessionManager.getSessionId();
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		vi.spyOn(session, "newSessionWithReviewedPreparation").mockResolvedValue(false);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		let unresolved = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			for (
				let i = 0;
				i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("declined by an extension");
				i++
			)
				await Bun.sleep(5);
			unresolved = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath,
			planExists: true,
			title: "VETOED_PLAN",
		});

		expect(unresolved).toContain("Unresolved plan approval");
		expect(unresolved).toContain("declined by an extension");
		expect(session.sessionManager.getSessionId()).toBe(originalSessionId);
		expect(mode.planModeEnabled).toBe(true);
		expect(await Bun.file(source).text()).toBe("Vetoed reviewed plan");
		expect(await Bun.file(destination).exists()).toBe(false);
		expect(prompt).not.toHaveBeenCalled();
	});
	it.each(["veto", "accept"] as const)(
		"reviewed new-session preparation runs only beyond the extension boundary (%s)",
		async decision => {
			const manager = SessionManager.create(tempDir.path(), tempDir.path());
			const sequence: string[] = [];
			const extensionRunner = {
				hasHandlers: (name: string) => name === "session_before_switch",
				emit: async (event: { type: string }) => {
					sequence.push(event.type === "session_before_switch" ? "before" : "switch");
					return event.type === "session_before_switch" && decision === "veto" ? { cancel: true } : undefined;
				},
			};
			const reviewedSession = new AgentSession({
				agent: new Agent({
					initialState: { model: session.model, systemPrompt: "Test", tools: [], messages: [] },
				}),
				sessionManager: manager,
				settings: Settings.isolated(),
				modelRegistry: session.modelRegistry,
				extensionRunner: extensionRunner as any,
			});
			const originalId = manager.getSessionId();
			try {
				const switched = await reviewedSession.newSessionWithReviewedPreparation(async () => {
					sequence.push("prepare");
				});
				expect(switched).toBe(decision === "accept");
				expect(sequence).toEqual(decision === "accept" ? ["before", "prepare", "switch"] : ["before"]);
				expect(manager.getSessionId() === originalId).toBe(decision === "veto");
			} finally {
				await reviewedSession.dispose();
			}
		},
	);
	it("approval persistence retry completes the same execution-session identity", async () => {
		const planFilePath = "local://PLAN.md";
		const finalPlanFilePath = "local://RETRIED_PLAN.md";
		const content = "Plan whose execution session save is retried";
		const originalSessionId = session.sessionManager.getSessionId();
		const source = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => originalSessionId,
		});
		await Bun.write(source, content);
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = planFilePath;
		session.setPlanModeState({ enabled: true, planFilePath });
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Approve and execute");
		const newSession = vi.spyOn(session, "newSessionWithReviewedPreparation");
		const retryPersistence = session.sessionManager.retryPersistence.bind(session.sessionManager);
		let failed = false;
		vi.spyOn(session.sessionManager, "retryPersistence").mockImplementation(async () => {
			if (!failed && session.sessionManager.getSessionId() !== originalSessionId) {
				failed = true;
				throw new Error("Synthetic execution-session persistence failure");
			}
			await retryPersistence();
		});
		const prompt = vi.spyOn(session, "prompt").mockResolvedValue();
		let failedSessionId = "";
		let unresolved = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			for (
				let i = 0;
				i < 100 &&
				!Bun.stripANSI(component.render(100).join("\n")).includes(
					"Synthetic execution-session persistence failure",
				);
				i++
			)
				await Bun.sleep(5);
			failedSessionId = session.sessionManager.getSessionId();
			unresolved = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			finalPlanFilePath,
			planExists: true,
			title: "RETRIED_PLAN",
		});

		expect(unresolved).toContain("Unresolved plan approval");
		expect(failedSessionId).not.toBe(originalSessionId);
		expect(session.sessionManager.getSessionId()).toBe(failedSessionId);
		expect(newSession).toHaveBeenCalledTimes(1);
		expect(prompt).toHaveBeenCalledTimes(1);
		const executionCopy = resolveLocalUrlToPath(finalPlanFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => failedSessionId,
		});
		expect(await Bun.file(executionCopy).text()).toBe(content);
		expect((await SessionManager.open(session.sessionManager.getSessionFile()!)).getSessionId()).toBe(
			failedSessionId,
		);
	});
	it.each([false, true])(
		"typed planning prompt is reviewed and submitted only after saving (confirm: %s)",
		async confirm => {
			const text = "Plan the synthetic fixture change";
			const submit = vi.fn(() => {
				const entries = readFileSync(session.sessionManager.getSessionFile()!, "utf8")
					.trim()
					.split("\n")
					.map(line => JSON.parse(line));
				expect(entries.some(entry => entry.type === "mode_change" && entry.mode === "plan")).toBe(true);
			});
			mode.onInputCallback = submit;
			let rendered = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				const completed = Promise.withResolvers<any>();
				const component = await factory(
					{ terminal: { rows: 40 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				rendered = Bun.stripANSI(component.render(100).join("\n"));
				if (confirm) component.handleInput("\x1b[B");
				component.handleInput("\r");
				return completed.promise;
			});
			await mode.handlePlanModeCommand(text);
			expect(rendered).toContain(text);
			expect(submit).toHaveBeenCalledTimes(confirm ? 1 : 0);
			expect(mode.planModeEnabled).toBe(confirm);
		},
	);
	it("typed planning prompt keeps an already-active plan mode enabled", async () => {
		const text = "Continue planning the active synthetic session";
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = "local://PLAN.md";
		session.setPlanModeState({ enabled: true, planFilePath: "local://PLAN.md" });
		const before = JSON.stringify(session.sessionManager.getEntries());
		const submit = vi.fn();
		mode.onInputCallback = submit;
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			return completed.promise;
		});

		await mode.handlePlanModeCommand(text);

		expect(rendered).toContain("Review planning prompt");
		expect(rendered).toContain("Plan mode: on → on");
		expect(rendered).toContain(text);
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.planModePaused).toBe(false);
		expect(submit).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it("typed retry reviews replacement of a prompt waiting on plan-mode persistence", async () => {
		const originalPrompt = "Original planning prompt waiting for persistence";
		const replacementPrompt = "Replacement planning prompt after persistence recovery";
		vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("Synthetic plan save failure"));
		const submitted: string[] = [];
		mode.onInputCallback = input => submitted.push(input.text);
		let attempt = 0;
		let retryReview = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			if (attempt++ > 0) retryReview = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			if (attempt === 1) {
				for (
					let i = 0;
					i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("Synthetic plan save failure");
					i++
				)
					await Bun.sleep(5);
				component.handleInput("\x1b");
			}
			return completed.promise;
		});

		await mode.handlePlanModeCommand(originalPrompt);
		expect(mode.planModeEnabled).toBe(true);
		expect(submitted).toEqual([]);
		await mode.handlePlanModeCommand(replacementPrompt);

		expect(retryReview).toContain("Retry saving only");
		expect(retryReview).toContain("Pending planning prompt");
		expect(retryReview).toContain(originalPrompt);
		expect(retryReview).toContain("Replacement");
		expect(retryReview).toContain("planning prompt after persistence recovery");
		expect(submitted).toEqual([replacementPrompt]);
	});
	it("typed prompt recovers an unresolved pause, re-enables plan mode, and then submits", async () => {
		const prompt = "Resume planning after saving the pending pause";
		mode.planModeEnabled = true;
		mode.planModePlanFilePath = "local://PLAN.md";
		session.setPlanModeState({ enabled: true, planFilePath: "local://PLAN.md" });
		vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("Synthetic paused-state save failure"));
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
		const submitted: string[] = [];
		mode.onInputCallback = input => submitted.push(input.text);
		let attempt = 0;
		let recoveryReview = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			if (attempt++ > 0) recoveryReview = Bun.stripANSI(component.render(100).join("\n"));
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			if (attempt === 1) {
				for (
					let i = 0;
					i < 100 &&
					!Bun.stripANSI(component.render(100).join("\n")).includes("Synthetic paused-state save failure");
					i++
				)
					await Bun.sleep(5);
				component.handleInput("\x1b");
			}
			return completed.promise;
		});

		await mode.handlePlanModeCommand();
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePaused).toBe(true);
		expect(submitted).toEqual([]);

		await mode.handlePlanModeCommand(prompt);

		expect(recoveryReview).toContain("Save pending pause, then re-enable");
		expect(recoveryReview).toContain("Plan mode: paused → on");
		expect(recoveryReview).toContain(prompt);
		expect(mode.planModeEnabled).toBe(true);
		expect(mode.planModePaused).toBe(false);
		expect(submitted).toEqual([prompt]);
		const reopened = await SessionManager.open(session.sessionManager.getSessionFile()!);
		expect(reopened.buildSessionContext().mode).toBe("plan");
		await reopened.close();
	});
	it("argument-free plan offers explicit choices without changing session state", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		const chooser = vi.spyOn(mode, "showHookSelector").mockResolvedValue(undefined);
		await mode.handlePlanModeCommand();
		expect(chooser).toHaveBeenCalledWith("Plan mode", ["Cancel", "Enable plan mode"]);
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it("prompt preparation failure leaves actual active tools and prompt unchanged", async () => {
		const tool = {
			name: "fixture",
			label: "Fixture",
			description: "Synthetic tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const agent = new Agent({
			initialState: { model: session.model, systemPrompt: "Original prompt", tools: [tool], messages: [] },
		});
		const manager = SessionManager.inMemory(tempDir.path());
		const rebuild = vi.fn(async () => {
			throw new Error("prompt preparation failed");
		});
		const isolated = new AgentSession({
			agent,
			sessionManager: manager,
			settings: Settings.isolated(),
			modelRegistry: session.modelRegistry,
			toolRegistry: new Map([[tool.name, tool]]),
			rebuildSystemPrompt: rebuild,
		});
		try {
			const before = JSON.stringify(manager.getEntries());
			await expect(isolated.setActiveToolsByName([])).rejects.toThrow("prompt preparation failed");
			expect(isolated.getActiveToolNames()).toEqual(["fixture"]);
			expect(agent.state.systemPrompt).toBe("Original prompt");
			expect(JSON.stringify(manager.getEntries())).toBe(before);
		} finally {
			await isolated.dispose();
		}
	});
	it.each(["selection", "session"])("an older prepared tool update cannot overwrite a changed %s", async change => {
		const tool = {
			name: "fixture",
			label: "Fixture",
			description: "Synthetic",
			parameters: Type.Object({}),
			execute: async () => ({ content: [], details: {} }),
		};
		const agent = new Agent({
			initialState: { model: session.model, tools: [tool], systemPrompt: "Original", messages: [] },
		});
		const slow = Promise.withResolvers<string>();
		const isolated = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry: session.modelRegistry,
			toolRegistry: new Map([[tool.name, tool]]),
			rebuildSystemPrompt: async names => (names.length ? "Latest prompt" : slow.promise),
		});
		try {
			const older = isolated.setActiveToolsByName([]).then(
				() => undefined,
				error => error,
			);
			if (change === "session") await isolated.sessionManager.newSession();
			else await isolated.setActiveToolsByName(["fixture"]);
			const entries = JSON.stringify(isolated.sessionManager.getEntries());
			slow.resolve("Stale prompt");
			expect(await older).toBeInstanceOf(Error);
			expect(isolated.getActiveToolNames()).toEqual(["fixture"]);
			expect(agent.state.systemPrompt).toBe(change === "session" ? "Original" : "Latest prompt");
			expect(JSON.stringify(isolated.sessionManager.getEntries())).toBe(entries);
		} finally {
			slow.resolve("Stale prompt");
			await isolated.dispose();
		}
	});
	it("failed tool activation leaves plan mode disabled and retryable", async () => {
		const activate = vi
			.spyOn(session, "setActiveToolsByName")
			.mockRejectedValueOnce(new Error("tool activation failed"));
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			for (
				let i = 0;
				i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("tool activation failed");
				i++
			)
				await Bun.sleep(5);
			expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("tool activation failed");
			component.handleInput("\x1b");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(activate).toHaveBeenCalledTimes(1);
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePlanFilePath).toBeUndefined();
		expect(session.getPlanModeState()).toBeUndefined();
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
	it.each([false, true])(
		"failed plan save retries persistence without applying the mode again (disk failure: %s)",
		async realDiskFailure => {
			const file = session.sessionManager.getSessionFile()!;
			if (realDiskFailure) await mkdir(file, { recursive: true });
			else vi.spyOn(session.sessionManager, "flush").mockRejectedValueOnce(new Error("fixture save failed"));
			const status = vi.spyOn(mode, "showStatus");
			const apply = vi.spyOn(session, "setPlanModeState");
			vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
			let attempt = 0;
			let retryText = "";
			vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
				const completed = Promise.withResolvers<any>();
				const component = await factory(
					{ terminal: { rows: 32 }, requestRender() {} },
					undefined,
					undefined,
					completed.resolve,
				);
				if (attempt++ > 0) retryText = Bun.stripANSI(component.render(100).join("\n"));
				component.handleInput("\x1b[B");
				component.handleInput("\r");
				if (attempt === 1) {
					for (
						let i = 0;
						i < 100 && !Bun.stripANSI(component.render(100).join("\n")).includes("Unresolved plan mode");
						i++
					)
						await Bun.sleep(5);
					expect(Bun.stripANSI(component.render(100).join("\n"))).toContain("Unresolved plan mode");
					component.handleInput("\x1b");
				}
				return completed.promise;
			});
			await mode.handlePlanModeCommand();
			expect(status).not.toHaveBeenCalled();
			if (realDiskFailure) await rmdir(file);
			await mode.handlePlanModeCommand();
			expect(retryText).toContain("Retry saving only");
			expect(apply).toHaveBeenCalledTimes(1);
			expect(mode.planModeEnabled).toBe(true);
			expect(status).toHaveBeenCalledTimes(1);
			const reopened = await SessionManager.open(file);
			expect(reopened.buildSessionContext().mode).toBe("plan");
			expect(reopened.getEntries().filter(entry => entry.type === "mode_change")).toHaveLength(1);
			await reopened.close();
		},
	);
	it("confirmed enable and pause persist mode state for a newly reopened session", async () => {
		expect(session.getActiveToolNames()).toEqual([]);
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title, choices) => choices[1]);
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 32 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		const file = session.sessionManager.getSessionFile()!;
		expect(session.getActiveToolNames()).toEqual(["exit_plan_mode"]);
		expect(await Bun.file(file).exists()).toBe(true);
		let entries = (await Bun.file(file).text())
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(entries.filter(entry => entry.type === "mode_change").map(entry => entry.mode)).toEqual(["plan"]);
		let reopened = await SessionManager.open(file);
		expect(reopened.buildSessionContext().mode).toBe("plan");
		await reopened.close();
		await mode.handlePlanModeCommand();
		entries = (await Bun.file(file).text())
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(entries.filter(entry => entry.type === "mode_change").map(entry => entry.mode)).toEqual([
			"plan",
			"plan_paused",
		]);
		reopened = await SessionManager.open(file);
		expect(reopened.buildSessionContext().mode).toBe("plan_paused");
		await reopened.close();
		expect(mode.planModeEnabled).toBe(false);
		expect(mode.planModePaused).toBe(true);
		expect(session.getActiveToolNames()).toEqual([]);
	});

	it("plan entry confirmation starts on Cancel and preserves session entries", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 24 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			rendered = Bun.stripANSI(component.render(80).join("\n"));
			component.handleInput("\r");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(rendered).toContain("Review plan mode");
		expect(rendered).toContain("Plan mode: off → on");
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});

	it("a session identity change invalidates plan confirmation before mutation", async () => {
		const before = JSON.stringify(session.sessionManager.getEntries());
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Enable plan mode");
		let rendered = "";
		vi.spyOn(mode, "showHookCustom").mockImplementation(async (factory: any) => {
			const completed = Promise.withResolvers<any>();
			const component = await factory(
				{ terminal: { rows: 24 }, requestRender() {} },
				undefined,
				undefined,
				completed.resolve,
			);
			vi.spyOn(session.sessionManager, "getSessionId").mockReturnValue("different-session");
			component.handleInput("\x1b[B");
			component.handleInput("\r");
			await Bun.sleep(0);
			rendered = Bun.stripANSI(component.render(80).join("\n"));
			component.handleInput("\x1b");
			return completed.promise;
		});
		await mode.handlePlanModeCommand();
		expect(rendered).toContain("changed");
		expect(mode.planModeEnabled).toBe(false);
		expect(JSON.stringify(session.sessionManager.getEntries())).toBe(before);
	});
});
