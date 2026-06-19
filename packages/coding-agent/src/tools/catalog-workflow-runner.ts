import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolResult } from "@f5xc-salesdemos/pi-agent-core";
import { logger, prompt, untilAborted } from "@f5xc-salesdemos/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import type { Page } from "puppeteer";
import { parse as parseYaml } from "yaml";
import {
	assertText,
	BrowserSession,
	click,
	fill,
	pressKey,
	screenshot,
	scrollIntoView,
	selectOption,
	waitFor,
} from "../browser";
import { CONSOLE_CATALOG_DATA } from "../internal-urls/console-catalog.generated";
import catalogWorkflowRunnerDescription from "../prompts/tools/catalog-workflow-runner.md" with { type: "text" };
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";

// =============================================================================
// Schema
// =============================================================================

const catalogWorkflowRunnerSchema = Type.Object({
	catalog_path: Type.Optional(
		Type.String({ description: "Path to a console catalog root. Omit to use the catalogue embedded in xcsh." }),
	),
	resource: Type.String({ description: 'Resource identifier, e.g. "http-load-balancer"' }),
	operation: Type.String({ description: 'Workflow operation, e.g. "create", "delete", "view"' }),
	params: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Workflow parameters (name, namespace, etc.) for {placeholder} resolution",
		}),
	),
	observable: Type.Optional(Type.Boolean({ description: "Enable slow execution with screenshots after each step" })),
	observable_delay_ms: Type.Optional(
		Type.Number({ description: "Delay between steps in observable mode (default 1500)" }),
	),
	screenshot_dir: Type.Optional(Type.String({ description: "Directory to save screenshots" })),
	base_url: Type.Optional(Type.String({ description: "F5XC console base URL; falls back to F5XC_API_URL env var" })),
});

type CatalogWorkflowRunnerParams = Static<typeof catalogWorkflowRunnerSchema>;

// =============================================================================
// Workflow YAML Types
// =============================================================================

interface WorkflowDefinition {
	schema: string;
	id: string;
	name: string;
	description?: string;
	resource: string;
	operation: string;
	params?: WorkflowParamDef[];
	steps: WorkflowStep[];
}

interface WorkflowParamDef {
	name: string;
	required?: boolean;
	default?: unknown;
	description?: string;
}

interface WorkflowStep {
	id: string;
	action: string;
	description?: string;
	url?: string;
	selector?: string;
	value?: string;
	values?: string[];
	key?: string;
	expected_text?: string;
	wait_for?: string;
	condition?: string;
	context?: string;
	then?: WorkflowStep[];
	timeout?: number;
	workflow?: string;
	with?: Record<string, string>;
}

// =============================================================================
// Details Types
// =============================================================================

export interface StepResult {
	stepId: string;
	action: string;
	description?: string;
	status: "pass" | "fail" | "skipped";
	durationMs: number;
	error?: string;
	screenshotPath?: string;
}

export interface CatalogWorkflowRunnerDetails {
	workflowId: string;
	resource: string;
	operation: string;
	status: "pass" | "fail";
	totalDurationMs: number;
	steps: StepResult[];
	failedAtStep?: string;
	meta?: OutputMeta;
}

// =============================================================================
// Constants
// =============================================================================

const EXPECTED_SCHEMA = "urn:f5xc:console:workflow:v1";
const DEFAULT_OBSERVABLE_DELAY_MS = 1500;
const MAX_WORKFLOW_DEPTH = 10;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Load the raw YAML text for a workflow. When `catalog_path` is provided the
 * file is read from disk; otherwise the embedded catalogue is used.
 */
export function loadWorkflowYaml(params: { catalog_path?: string; resource: string; operation: string }): string {
	const SAFE = /^[a-z0-9][a-z0-9-]*$/;
	if (!SAFE.test(params.resource) || !SAFE.test(params.operation)) {
		throw new ToolError(
			`Invalid resource or operation name: must be lowercase alphanumeric/hyphen only (got resource="${params.resource}", operation="${params.operation}")`,
		);
	}

	if (params.catalog_path) {
		let base: string;
		try {
			base = fs.realpathSync(path.resolve(params.catalog_path, "catalog/workflows"));
		} catch {
			throw new ToolError(`Catalog workflows directory not found under: ${params.catalog_path}`);
		}
		const candidate = path.resolve(base, params.resource, `${params.operation}.yaml`);
		if (!fs.existsSync(candidate)) {
			throw new ToolError(`Workflow not found: ${params.resource}/${params.operation}`);
		}
		const file = fs.realpathSync(candidate); // resolves symlinks before containment check
		if (file !== base && !file.startsWith(base + path.sep)) {
			throw new ToolError(`Path traversal detected in catalog_path`);
		}
		return fs.readFileSync(file, "utf-8");
	}
	const key = `${params.resource}/${params.operation}`;
	const text = CONSOLE_CATALOG_DATA.workflows[key];
	if (!text) {
		const available = Object.keys(CONSOLE_CATALOG_DATA.workflows).slice(0, 20).join(", ");
		throw new Error(
			`No embedded console workflow for "${key}". Available: ${available || "(none — catalogue not embedded)"}`,
		);
	}
	return text;
}

/**
 * Resolve `{placeholder}` references in a string using the provided params map.
 * Supports dotted paths: `{params.name}` resolves to the `name` key in params.
 */
function resolvePlaceholders(template: string, params: Record<string, unknown>): string {
	return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
		// Support "params.X" → look up X in params
		const resolved = key.startsWith("params.") ? params[key.slice("params.".length)] : params[key];
		return resolved !== undefined ? String(resolved) : `{${key}}`;
	});
}

/**
 * Evaluate a simple condition string.
 * Supports patterns:
 * - "params.X is set"       → truthy check
 * - "params.X is not set"   → falsy check
 * - "params.X == value"     → equality check
 */
function evaluateCondition(condition: string, params: Record<string, unknown>): boolean {
	const isSetMatch = condition.match(/^params\.(\w+)\s+is\s+set$/);
	if (isSetMatch) {
		const key = isSetMatch[1]!;
		return params[key] !== undefined && params[key] !== null && params[key] !== "";
	}

	const isNotSetMatch = condition.match(/^params\.(\w+)\s+is\s+not\s+set$/);
	if (isNotSetMatch) {
		const key = isNotSetMatch[1]!;
		return params[key] === undefined || params[key] === null || params[key] === "";
	}

	const eqMatch = condition.match(/^params\.(\w+)\s*==\s*(.+)$/);
	if (eqMatch) {
		const key = eqMatch[1]!;
		const expected = eqMatch[2]!.trim();
		return String(params[key] ?? "") === expected;
	}

	logger.warn("catalog-workflow-runner: unrecognized condition, treating as false", { condition });
	return false;
}

/**
 * Format duration in seconds with one decimal place.
 */
function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Parse a workflow reference of the form "resource/operation".
 * Both segments must be non-empty and match ^[a-z0-9][a-z0-9-]*$.
 * Throws ToolError for malformed refs.
 */
export function parseWorkflowRef(ref: string): { resource: string; operation: string } {
	const SAFE = /^[a-z0-9][a-z0-9-]*$/;
	const parts = ref.split("/");
	if (parts.length !== 2) {
		throw new ToolError(`Invalid workflow ref "${ref}": must be "resource/operation" with exactly one slash`);
	}
	const [resource, operation] = parts as [string, string];
	if (!resource || !operation) {
		throw new ToolError(`Invalid workflow ref "${ref}": both resource and operation must be non-empty`);
	}
	if (!SAFE.test(resource) || !SAFE.test(operation)) {
		throw new ToolError(
			`Invalid workflow ref "${ref}": segments must be lowercase alphanumeric/hyphen only (no uppercase, underscores, or leading hyphens)`,
		);
	}
	return { resource, operation };
}

// =============================================================================
// Tool Class
// =============================================================================

export class CatalogWorkflowRunnerTool
	implements AgentTool<typeof catalogWorkflowRunnerSchema, CatalogWorkflowRunnerDetails>
{
	readonly name = "catalog_workflow_runner";
	readonly label = "Catalog Workflow";
	readonly description: string;
	readonly parameters = catalogWorkflowRunnerSchema;
	readonly strict = true;

	readonly #toolSession: ToolSession;
	#session: BrowserSession | null = null;

	constructor(session: ToolSession) {
		this.#toolSession = session;
		this.description = prompt.render(catalogWorkflowRunnerDescription);
	}

	#ensureSession(): BrowserSession {
		if (!this.#session) {
			this.#session = new BrowserSession(this.#toolSession.settings);
		}
		return this.#session;
	}

	// -------------------------------------------------------------------------
	// YAML loading & validation
	// -------------------------------------------------------------------------

	#loadWorkflow(params: { catalog_path?: string; resource: string; operation: string }): WorkflowDefinition {
		const raw = loadWorkflowYaml(params);
		const workflow = parseYaml(raw) as WorkflowDefinition;

		if (workflow.schema !== EXPECTED_SCHEMA) {
			throw new ToolError(`Invalid workflow schema: expected "${EXPECTED_SCHEMA}", got "${workflow.schema}"`);
		}
		if (!workflow.steps || !Array.isArray(workflow.steps)) {
			throw new ToolError("Workflow has no steps array");
		}
		return workflow;
	}

	#validateParams(workflow: WorkflowDefinition, params: Record<string, unknown>): void {
		if (!workflow.params) return;
		const missing: string[] = [];
		for (const paramDef of workflow.params) {
			if (paramDef.required && !(paramDef.name in params)) {
				if (paramDef.default !== undefined) continue;
				missing.push(paramDef.name);
			}
		}
		if (missing.length > 0) {
			throw new ToolError(`Missing required workflow params: ${missing.join(", ")}`);
		}
	}

	// -------------------------------------------------------------------------
	// Step execution
	// -------------------------------------------------------------------------

	async #executeStep(
		step: WorkflowStep,
		params: Record<string, unknown>,
		baseUrl: string,
		page: Page,
		options: {
			observable: boolean;
			observableDelayMs: number;
			screenshotDir?: string;
			stepIndex: number;
			catalogPath?: string;
			depth: number;
		},
		signal?: AbortSignal,
	): Promise<StepResult> {
		const start = performance.now();
		const result: StepResult = {
			stepId: step.id,
			action: step.action,
			description: step.description,
			status: "pass",
			durationMs: 0,
		};

		try {
			throwIfAborted(signal);

			// Condition gating
			if (step.condition) {
				const conditionMet = evaluateCondition(step.condition, params);
				if (!conditionMet) {
					result.status = "skipped";
					result.durationMs = performance.now() - start;
					return result;
				}
			}

			// Resolve placeholders in relevant fields
			const resolvedUrl = step.url ? resolvePlaceholders(step.url, params) : undefined;
			const resolvedSelector = step.selector ? resolvePlaceholders(step.selector, params) : undefined;
			const resolvedValue = step.value ? resolvePlaceholders(step.value, params) : undefined;
			const resolvedValues = step.values?.map(v => resolvePlaceholders(v, params));
			const resolvedExpected = step.expected_text ? resolvePlaceholders(step.expected_text, params) : undefined;
			const resolvedWaitFor = step.wait_for ? resolvePlaceholders(step.wait_for, params) : undefined;
			const resolvedContext = step.context ? resolvePlaceholders(step.context, params) : undefined;

			switch (step.action) {
				case "navigate": {
					if (!resolvedUrl) throw new ToolError(`Step "${step.id}": navigate requires url`);
					const fullUrl = resolvedUrl.startsWith("http") ? resolvedUrl : `${baseUrl}${resolvedUrl}`;
					await page.goto(fullUrl, { waitUntil: "networkidle2" });
					if (resolvedWaitFor) {
						await waitFor(page, resolvedWaitFor, resolvedContext);
					}
					break;
				}
				case "click": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": click requires selector`);
					await click(page, resolvedSelector, resolvedContext);
					break;
				}
				case "fill": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": fill requires selector`);
					if (resolvedValue === undefined) throw new ToolError(`Step "${step.id}": fill requires value`);
					await fill(page, resolvedSelector, resolvedValue, resolvedContext);
					break;
				}
				case "fill-list": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": fill-list requires selector`);
					if (!resolvedValues?.length) throw new ToolError(`Step "${step.id}": fill-list requires values`);
					for (const val of resolvedValues) {
						await fill(page, resolvedSelector, val, resolvedContext);
						await pressKey(page, "Enter");
					}
					break;
				}
				case "select": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": select requires selector`);
					await selectOption(page, resolvedSelector, resolvedValue ?? "", resolvedContext);
					break;
				}
				case "assert": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": assert requires selector`);
					if (!resolvedExpected) throw new ToolError(`Step "${step.id}": assert requires expected_text`);
					await assertText(page, resolvedSelector, resolvedExpected, resolvedContext);
					break;
				}
				case "screenshot": {
					if (options.screenshotDir) {
						const safeId = step.id.replace(/[^a-z0-9-]/gi, "-");
						const p = path.resolve(options.screenshotDir, `${safeId}.png`);
						if (!p.startsWith(path.resolve(options.screenshotDir) + path.sep)) {
							throw new ToolError(`Screenshot path escapes screenshotDir for step "${step.id}"`);
						}
						await screenshot(page, p);
						result.screenshotPath = p;
					}
					break;
				}
				case "key-press": {
					if (!step.key) throw new ToolError(`Step "${step.id}": key-press requires key`);
					await pressKey(page, step.key);
					break;
				}
				case "wait": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": wait requires selector`);
					await waitFor(page, resolvedSelector, resolvedContext);
					break;
				}
				case "scroll": {
					if (!resolvedSelector) throw new ToolError(`Step "${step.id}": scroll requires selector`);
					await scrollIntoView(page, resolvedSelector, resolvedContext);
					break;
				}
				case "run-workflow": {
					if (!step.workflow) throw new ToolError(`Step "${step.id}": run-workflow requires workflow`);
					if (options.depth >= MAX_WORKFLOW_DEPTH) {
						throw new ToolError(`run-workflow nesting too deep (possible cycle) at step ${step.id}`);
					}
					const { resource, operation } = parseWorkflowRef(step.workflow);
					const childParams: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(step.with ?? {})) {
						childParams[k] = resolvePlaceholders(v, params);
					}
					const childYaml = loadWorkflowYaml({
						catalog_path: options.catalogPath,
						resource,
						operation,
					});
					const childWorkflow = parseYaml(childYaml) as WorkflowDefinition;
					if (childWorkflow.schema !== EXPECTED_SCHEMA) {
						throw new ToolError(
							`Child workflow "${step.workflow}" has invalid schema: expected "${EXPECTED_SCHEMA}", got "${childWorkflow.schema}"`,
						);
					}
					if (!childWorkflow.steps || !Array.isArray(childWorkflow.steps)) {
						throw new ToolError(`Child workflow "${step.workflow}" has no steps array`);
					}
					// Apply defaults from child workflow param definitions
					if (childWorkflow.params) {
						for (const paramDef of childWorkflow.params) {
							if (!(paramDef.name in childParams) && paramDef.default !== undefined) {
								childParams[paramDef.name] = paramDef.default;
							}
						}
					}
					this.#validateParams(childWorkflow, childParams);
					for (const childStep of childWorkflow.steps) {
						const r = await this.#executeStep(
							childStep,
							childParams,
							baseUrl,
							page,
							{ ...options, depth: options.depth + 1 },
							signal,
						);
						if (r.status === "fail") {
							throw new ToolError(
								`run-workflow "${step.workflow}" failed at child step "${childStep.id}": ${r.error}`,
							);
						}
					}
					break;
				}
				default:
					throw new ToolError(`Unknown workflow action "${step.action}" at step "${step.id}"`);
			}

			// Post-action wait_for
			if (resolvedWaitFor && step.action !== "navigate") {
				await waitFor(page, resolvedWaitFor, resolvedContext);
			}

			// Execute sub-steps (then)
			if (step.then) {
				for (let i = 0; i < step.then.length; i++) {
					const subStep = step.then[i]!;
					const subResult = await this.#executeStep(subStep, params, baseUrl, page, options, signal);
					if (subResult.status === "fail") {
						result.status = "fail";
						result.error = `Sub-step "${subStep.id}" failed: ${subResult.error}`;
						break;
					}
				}
			}

			// Observable mode: delay + screenshot
			if (options.observable && result.status !== "fail") {
				await new Promise(resolve => setTimeout(resolve, options.observableDelayMs));
				if (options.screenshotDir) {
					const safeId = step.id.replace(/[^a-z0-9-]/gi, "-");
					const obsPath = path.resolve(options.screenshotDir, `step-${options.stepIndex}-${safeId}.png`);
					if (obsPath.startsWith(path.resolve(options.screenshotDir) + path.sep)) {
						try {
							await screenshot(page, obsPath);
							result.screenshotPath = obsPath;
						} catch (e) {
							logger.warn("catalog-workflow-runner: observable screenshot failed", {
								step: step.id,
								error: e instanceof Error ? e.message : String(e),
							});
						}
					}
				}
			}
		} catch (e) {
			result.status = "fail";
			result.error = e instanceof Error ? e.message : String(e);

			// Capture failure screenshot
			if (options.screenshotDir) {
				try {
					const safeId = step.id.replace(/[^a-z0-9-]/gi, "-");
					const failPath = path.resolve(options.screenshotDir, `fail-${safeId}.png`);
					if (failPath.startsWith(path.resolve(options.screenshotDir) + path.sep)) {
						await screenshot(page, failPath);
						result.screenshotPath = failPath;
					}
				} catch {
					// Best-effort screenshot on failure
				}
			}
		}

		result.durationMs = performance.now() - start;
		return result;
	}

	// -------------------------------------------------------------------------
	// Main execute
	// -------------------------------------------------------------------------

	async execute(
		_toolCallId: string,
		inputParams: CatalogWorkflowRunnerParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<CatalogWorkflowRunnerDetails>> {
		return untilAborted(signal, async () => {
			const totalStart = performance.now();

			// Load & validate
			const workflow = this.#loadWorkflow({
				catalog_path: inputParams.catalog_path,
				resource: inputParams.resource,
				operation: inputParams.operation,
			});
			const params: Record<string, unknown> = { ...inputParams.params };

			// Apply defaults from workflow param definitions
			if (workflow.params) {
				for (const paramDef of workflow.params) {
					if (!(paramDef.name in params) && paramDef.default !== undefined) {
						params[paramDef.name] = paramDef.default;
					}
				}
			}

			this.#validateParams(workflow, params);

			// Resolve base URL from params or environment
			const baseUrl = inputParams.base_url ?? process.env.F5XC_API_URL ?? "";
			if (!baseUrl) {
				throw new ToolError("No base_url provided and F5XC_API_URL env var is not set");
			}

			// Options
			const observable = inputParams.observable ?? false;
			const observableDelayMs = inputParams.observable_delay_ms ?? DEFAULT_OBSERVABLE_DELAY_MS;
			const screenshotDir = inputParams.screenshot_dir;

			// Ensure screenshot directory exists
			if (screenshotDir && !fs.existsSync(screenshotDir)) {
				fs.mkdirSync(screenshotDir, { recursive: true });
			}

			// Open browser session
			const session = this.#ensureSession();
			const page = await session.ensurePage();

			// Execute steps
			const stepResults: StepResult[] = [];
			let failedAtStep: string | undefined;

			try {
				for (let i = 0; i < workflow.steps.length; i++) {
					throwIfAborted(signal);
					const step = workflow.steps[i]!;
					const stepResult = await this.#executeStep(
						step,
						params,
						baseUrl,
						page,
						{
							observable,
							observableDelayMs,
							screenshotDir,
							stepIndex: i,
							catalogPath: inputParams.catalog_path,
							depth: 0,
						},
						signal,
					);
					stepResults.push(stepResult);

					if (stepResult.status === "fail") {
						failedAtStep = step.id;
						break;
					}
				}
			} finally {
				await session.close();
				this.#session = null;
			}

			const totalDurationMs = performance.now() - totalStart;
			const overallStatus = failedAtStep ? "fail" : "pass";
			const workflowId = `${inputParams.resource}-${inputParams.operation}`;

			const details: CatalogWorkflowRunnerDetails = {
				workflowId,
				resource: inputParams.resource,
				operation: inputParams.operation,
				status: overallStatus,
				totalDurationMs,
				steps: stepResults,
				failedAtStep,
			};

			// Format text report
			const statusLabel = overallStatus === "pass" ? "PASS" : "FAIL";
			const header = [
				`Workflow: ${workflow.name} (${workflowId})`,
				`Status: ${statusLabel}`,
				`Duration: ${formatDuration(totalDurationMs)}`,
				"",
				"Steps:",
			];

			const stepLines = stepResults.map(sr => {
				const tag = sr.status === "pass" ? "PASS" : sr.status === "fail" ? "FAIL" : "SKIPPED";
				const desc = sr.description ?? sr.error ?? "";
				const dur = formatDuration(sr.durationMs);
				return `   [${tag.padEnd(7)}] ${sr.stepId.padEnd(24)} ${desc.padEnd(40).slice(0, 40)} (${dur})`;
			});

			const text = [...header, ...stepLines].join("\n");

			return toolResult(details).text(text).done();
		});
	}
}
