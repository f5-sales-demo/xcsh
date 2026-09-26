import type {
	ModelBenchmarkTarget,
	ModelBenchmarkUsage,
	NumericSummary,
	TimedJsonEvent,
} from "./model-matrix-report";
import type { Effort } from "@f5-sales-demo/pi-ai";
import type {
	ModelBenchmarkScenario,
	ModelScenarioKnowledgeExpectation,
	ModelScenarioSuite,
	ModelScenarioTurn,
	ModelScenarioToolExpectation,
} from "./model-scenario-library";

export interface ScenarioQualityCriterionResult {
	id: string;
	label: string;
	weight: number;
	passed: boolean;
}

export interface ScenarioQualityResult {
	score: number;
	earned: number;
	possible: number;
	visibleWords: number;
	criteria: ScenarioQualityCriterionResult[];
}

export interface ScenarioToolCall {
	id: string;
	name: string;
	args?: Record<string, unknown>;
	startedAtMs: number;
	durationMs?: number;
	isError: boolean;
	isWarning: boolean;
}

export interface ScenarioKnowledgeEvent {
	type: "api-catalog-preflight" | "read";
	atMs: number;
	query?: string;
	path?: string;
}

export interface BuildScenarioBenchmarkSampleInput {
	target: ModelBenchmarkTarget;
	scenario: ModelBenchmarkScenario;
	thinking?: Effort;
	contextName?: string;
	round: number;
	warmup: boolean;
	startedAt: string;
	processDurationMs: number;
	exitCode: number;
	timedOut: boolean;
	stderr: string;
	stdoutErrors: string[];
	events: TimedJsonEvent[];
	turnInputs?: ScenarioBenchmarkTurnInput[];
}

export interface ScenarioBenchmarkTurnInput {
	startedAtMs: number;
	durationMs: number;
	events: TimedJsonEvent[];
	error?: string;
}

export interface ScenarioBenchmarkTurn {
	id: string;
	prompt: string;
	success: boolean;
	contractPassed: boolean;
	contractFailures: string[];
	quality: ScenarioQualityResult;
	response: string;
	error?: string;
	startedAtMs: number;
	durationMs: number;
	toolCalls: ScenarioToolCall[];
	knowledgeEvents: ScenarioKnowledgeEvent[];
	ttftMs?: number;
	timeToFirstToolMs?: number;
	timeToAuthoritativeEvidenceMs?: number;
	responseDurationMs?: number;
}

export interface ScenarioBenchmarkSample {
	label: string;
	selector: string;
	scenarioId: string;
	scenarioLabel: string;
	suite: ModelScenarioSuite;
	tier: number;
	requestedThinking?: Effort;
	effectiveThinking?: Effort;
	contextName?: string;
	round: number;
	warmup: boolean;
	startedAt: string;
	provider?: string;
	model?: string;
	success: boolean;
	contractPassed: boolean;
	contractFailures: string[];
	quality: ScenarioQualityResult;
	response: string;
	stopReason?: string;
	error?: string;
	stderr?: string;
	exitCode: number;
	timedOut: boolean;
	eventCount: number;
	turnCount: number;
	assistantMessageCount: number;
	toolCalls: ScenarioToolCall[];
	knowledgeEvents: ScenarioKnowledgeEvent[];
	turns: ScenarioBenchmarkTurn[];
	startupMs?: number;
	timeToAuthoritativeEvidenceMs?: number;
	ttftMs?: number;
	timeToFirstToolMs?: number;
	startupInclusiveTtftMs?: number;
	responseDurationMs?: number;
	totalToolDurationMs?: number;
	processDurationMs: number;
	providerReportedTtftMs?: number;
	providerReportedDurationMs?: number;
	outputTokensPerSecond?: number;
	usage?: ModelBenchmarkUsage;
}

export interface ScenarioBenchmarkSummary {
	scenarioId: string;
	scenarioLabel: string;
	suite: ModelScenarioSuite;
	tier: number;
	thinking: Effort;
	label: string;
	selector: string;
	samples: number;
	successes: number;
	contractPasses: number;
	successRate: number;
	contractPassRate: number;
	qualityScore: NumericSummary | null;
	visibleWords: NumericSummary | null;
	latencyMs: {
		startup: NumericSummary | null;
		ttft: NumericSummary | null;
		timeToFirstTool: NumericSummary | null;
		authoritativeEvidence: NumericSummary | null;
		response: NumericSummary | null;
		toolExecution: NumericSummary | null;
		process: NumericSummary | null;
	};
	toolCalls: NumericSummary | null;
	outputTokensPerSecond: NumericSummary | null;
	costTotal: NumericSummary | null;
	tokens: {
		input: NumericSummary | null;
		output: NumericSummary | null;
		cacheRead: NumericSummary | null;
		cacheWrite: NumericSummary | null;
	};
}

export interface ScenarioBenchmarkReport {
	schemaVersion: 3;
	createdAt: string;
	config: {
		binaryPath?: string;
		thinkingEfforts: Effort[];
		runs: number;
		warmups: number;
		timeoutMs: number;
		failFastProviderError: boolean;
		order: "rotating-round-robin";
		contextName?: string;
		models: ModelBenchmarkTarget[];
			scenarios: Array<{
			id: string;
			label: string;
			suite: ModelScenarioSuite;
			tier: number;
			prompt: string;
			contract: string[];
			quality: Array<{ id: string; label: string; weight: number }>;
				runtime: ModelBenchmarkScenario["runtime"];
				turns?: Array<{
					id: string;
					prompt: string;
					contract: string[];
					quality: Array<{ id: string; label: string; weight: number }>;
				}>;
			}>;
	};
	warmups: ScenarioBenchmarkSample[];
	samples: ScenarioBenchmarkSample[];
	summaries: ScenarioBenchmarkSummary[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function effortValue(value: unknown): Effort | undefined {
	return typeof value === "string" && ["minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
		? (value as Effort)
		: undefined;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function selectorParts(selector: string): { provider: string; model: string } | undefined {
	const slash = selector.indexOf("/");
	if (slash <= 0 || slash === selector.length - 1) return undefined;
	return { provider: selector.slice(0, slash), model: selector.slice(slash + 1) };
}

function messageUsage(message: Record<string, unknown>): ModelBenchmarkUsage | undefined {
	const usage = record(message.usage);
	if (!usage) return undefined;
	return {
		input: finiteNumber(usage.input) ?? 0,
		output: finiteNumber(usage.output) ?? 0,
		cacheRead: finiteNumber(usage.cacheRead) ?? 0,
		cacheWrite: finiteNumber(usage.cacheWrite) ?? 0,
		totalTokens: finiteNumber(usage.totalTokens) ?? 0,
		costTotal: finiteNumber(record(usage.cost)?.total) ?? 0,
	};
}

function sumUsage(messages: Record<string, unknown>[]): ModelBenchmarkUsage | undefined {
	const usages = messages.map(messageUsage).filter((usage): usage is ModelBenchmarkUsage => usage !== undefined);
	if (usages.length === 0) return undefined;
	return usages.reduce<ModelBenchmarkUsage>(
		(total, usage) => ({
			input: total.input + usage.input,
			output: total.output + usage.output,
			cacheRead: total.cacheRead + usage.cacheRead,
			cacheWrite: total.cacheWrite + usage.cacheWrite,
			totalTokens: total.totalTokens + usage.totalTokens,
			costTotal: total.costTotal + usage.costTotal,
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0 },
	);
}

function containsArgumentSubset(actual: unknown, expected: unknown): boolean {
	if (expected === undefined) return true;
	if (typeof expected !== "object" || expected === null) return Object.is(actual, expected);
	if (Array.isArray(expected)) {
		return Array.isArray(actual) &&
			expected.length === actual.length &&
			expected.every((value, index) => containsArgumentSubset(actual[index], value));
	}
	const actualRecord = record(actual);
	if (!actualRecord) return false;
	return Object.entries(expected).every(([key, value]) => containsArgumentSubset(actualRecord[key], value));
}

function toolExpectationLabel(expectation: ModelScenarioToolExpectation): string {
	const argumentsLabel = expectation.arguments ? ` with ${JSON.stringify(expectation.arguments)}` : "";
	const patternsLabel = expectation.argumentPatterns
		? ` matching ${Object.entries(expectation.argumentPatterns)
				.map(([key, pattern]) => `${key}=${pattern}`)
				.join(", ")}`
		: "";
	return `${expectation.name}${argumentsLabel}${patternsLabel}`;
}

function matchesToolExpectation(call: ScenarioToolCall, expectation: ModelScenarioToolExpectation): boolean {
	if (call.name !== expectation.name || !containsArgumentSubset(call.args, expectation.arguments)) return false;
	const args = call.args;
	return Object.entries(expectation.argumentPatterns ?? {}).every(([key, pattern]) => {
		const value = args?.[key];
		return typeof value === "string" && pattern.test(value);
	});
}

function matchesKnowledgeExpectation(
	event: ScenarioKnowledgeEvent,
	expectation: ModelScenarioKnowledgeExpectation,
): boolean {
	if (event.type !== expectation.type) return false;
	if (expectation.query !== undefined && event.query !== expectation.query) return false;
	if (expectation.path !== undefined && event.path !== expectation.path) return false;
	if (expectation.pathPattern && (!event.path || !expectation.pathPattern.test(event.path))) return false;
	return true;
}

function isReadContinuation(call: ScenarioToolCall): boolean {
	return call.name === "read" && typeof call.args?.sel === "string" && call.args.sel.trim().length > 0;
}

export function evaluateScenarioContract(
	scenario: ModelBenchmarkScenario,
	response: string,
	toolCalls: ScenarioToolCall[],
	knowledgeEvents: ScenarioKnowledgeEvent[] = [],
): string[] {
	const failures: string[] = [];
	const { contract } = scenario;
	if (contract.expectedResponse !== undefined && response !== contract.expectedResponse) {
		failures.push(`response did not exactly match ${JSON.stringify(contract.expectedResponse)}`);
	}
	for (const requirement of contract.requiredResponsePatterns ?? []) {
		if (!requirement.pattern.test(response)) failures.push(`response missing: ${requirement.label}`);
	}
	for (const forbidden of contract.forbiddenResponsePatterns ?? []) {
		if (forbidden.pattern.test(response)) failures.push(`response included forbidden content: ${forbidden.label}`);
	}
	for (const expected of contract.requiredTools ?? []) {
		const matchingCalls = toolCalls.filter(call => matchesToolExpectation(call, expected));
		const count = contract.allowReadContinuations
			? matchingCalls.filter(call => !isReadContinuation(call)).length
			: matchingCalls.length;
		if (count !== expected.count) {
			const callKind = contract.allowReadContinuations ? "initial calls" : "times";
			failures.push(`tool ${toolExpectationLabel(expected)} called ${count} ${callKind}, expected ${expected.count}`);
		}
	}
	if (contract.requiredToolSequence) {
		let after = 0;
		for (const expected of contract.requiredToolSequence) {
			const found = toolCalls.findIndex((call, index) => index >= after && matchesToolExpectation(call, expected));
			if (found < 0) {
				failures.push(`tool sequence missing ${toolExpectationLabel(expected)} after position ${after}`);
				break;
			}
			after = found + 1;
		}
	}
	if (contract.requiredKnowledgeSequence) {
		let after = 0;
		for (const [requiredIndex, expected] of contract.requiredKnowledgeSequence.entries()) {
			const found = knowledgeEvents.findIndex(
				(event, index) => index >= after && matchesKnowledgeExpectation(event, expected),
			);
			if (found < 0) {
				failures.push(`knowledge sequence missing ${expected.type} after position ${after}`);
				break;
			}
			if (requiredIndex === 0 && contract.knowledgeSequenceStartsAtFirst && found !== 0) {
				failures.push(`first knowledge event was ${knowledgeEvents[0]?.type ?? "missing"}, expected ${expected.type}`);
				break;
			}
			after = found + 1;
		}
	}
	if (contract.exclusiveTools) {
		const expectedTools = contract.requiredTools ?? [];
		if (contract.allowReadContinuations) {
			const unexpected = toolCalls.filter(
				call => !expectedTools.some(expected => matchesToolExpectation(call, expected)),
			);
			if (unexpected.length > 0) {
				failures.push(`unexpected tool calls: ${unexpected.map(call => `${call.name} ${JSON.stringify(call.args)}`).join(", ")}`);
			}
		} else {
			const expectedCount = expectedTools.reduce((sum, expectation) => sum + expectation.count, 0);
			if (toolCalls.length !== expectedCount) {
				failures.push(`tool call count was ${toolCalls.length}, expected exactly ${expectedCount}`);
			}
			const expectedNames = new Set(expectedTools.map(tool => tool.name));
			const unexpected = [...new Set(toolCalls.map(call => call.name).filter(name => !expectedNames.has(name)))];
			if (unexpected.length > 0) failures.push(`unexpected tools called: ${unexpected.join(", ")}`);
		}
	}
	const failedTools = toolCalls.filter(call => call.isError).map(call => call.name);
	if (failedTools.length > 0) failures.push(`tool execution failed: ${failedTools.join(", ")}`);
	return failures;
}

function countVisibleWords(response: string): number {
	const words = response.trim().match(/\S+/gu);
	return words?.length ?? 0;
}

export function evaluateScenarioQuality(
	scenario: ModelBenchmarkScenario,
	response: string,
	contractPassed: boolean,
	transportSucceeded = true,
): ScenarioQualityResult {
	const visibleWords = countVisibleWords(response);
	const normalizedResponse = response.toLocaleLowerCase("en-US");
	const criteria = scenario.quality.map(criterion => {
		const checks: boolean[] = [];
		if (criterion.responsePattern) checks.push(criterion.responsePattern.test(response));
		if (criterion.forbiddenResponsePattern) checks.push(!criterion.forbiddenResponsePattern.test(response));
		if (criterion.responseIncludes) {
			checks.push(normalizedResponse.includes(criterion.responseIncludes.toLocaleLowerCase("en-US")));
		}
		if (criterion.maxVisibleWords !== undefined) checks.push(visibleWords <= criterion.maxVisibleWords);
		if (criterion.requiresContract) checks.push(contractPassed);
		return {
			id: criterion.id,
			label: criterion.label,
			weight: criterion.weight,
			passed: transportSucceeded && checks.length > 0 && checks.every(Boolean),
		};
	});
	const possible = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
	const earned = criteria.reduce((sum, criterion) => sum + (criterion.passed ? criterion.weight : 0), 0);
	return {
		score: possible === 0 ? 0 : round((earned / possible) * 100),
		earned,
		possible,
		visibleWords,
		criteria,
	};
}

function buildSingleScenarioBenchmarkSample(
	input: Omit<BuildScenarioBenchmarkSampleInput, "turnInputs">,
): Omit<ScenarioBenchmarkSample, "turns"> {
	let provider: string | undefined;
	let model: string | undefined;
	let effectiveThinking: Effort | undefined;
	let promptAt: number | undefined;
	let firstTextAt: number | undefined;
	let lastAssistantEndAt: number | undefined;
	let turnCount = 0;
	let response = "";
	const assistantMessages: Record<string, unknown>[] = [];
	const assistantErrors = new Set<string>();
	const toolCalls: ScenarioToolCall[] = [];
	const toolCallsById = new Map<string, ScenarioToolCall>();
	const knowledgeEvents: ScenarioKnowledgeEvent[] = [];

	for (const timed of input.events) {
		const event = record(timed.event);
		if (!event) continue;
		const type = stringValue(event.type);
		if (type === "session") {
			provider = stringValue(event.provider) ?? provider;
			model = stringValue(event.model) ?? model;
			effectiveThinking = effortValue(event.thinking) ?? effectiveThinking;
			continue;
		}
		const message = record(event.message);
		if (type === "message_start" && message?.role === "custom" && message.customType === "api-catalog-preflight") {
			const details = record(message.details);
			const queries = Array.isArray(details?.queries) ? details.queries : [];
			knowledgeEvents.push({
				type: "api-catalog-preflight",
				atMs: round(timed.elapsedMs),
				query: queries.find((query): query is string => typeof query === "string"),
			});
		}
		if (type === "message_start" && message?.role === "user" && promptAt === undefined) {
			promptAt = timed.elapsedMs;
		}
		if (type === "message_update") {
			const assistantEvent = record(event.assistantMessageEvent);
			if (assistantEvent?.type === "text_delta") {
				const delta = stringValue(assistantEvent.delta);
				if (delta !== undefined) {
					response += delta;
					if (delta.length > 0 && firstTextAt === undefined) firstTextAt = timed.elapsedMs;
				}
			}
		}
		if (type === "message_end" && message?.role === "assistant") {
			assistantMessages.push(message);
			const errorMessage = stringValue(message.errorMessage);
			if (errorMessage) assistantErrors.add(errorMessage);
			lastAssistantEndAt = timed.elapsedMs;
			provider = stringValue(message.provider) ?? provider;
			model = stringValue(message.model) ?? model;
		}
		if (type === "turn_end") turnCount++;
		if (type === "tool_execution_start") {
			const id = stringValue(event.toolCallId);
			const name = stringValue(event.toolName);
			if (id && name) {
				const call: ScenarioToolCall = {
					id,
					name,
					args: record(event.args),
					startedAtMs: round(timed.elapsedMs),
					isError: false,
					isWarning: false,
				};
				toolCalls.push(call);
				toolCallsById.set(id, call);
				const knowledgePath = typeof call.args?.path === "string" ? call.args.path : undefined;
				if (name === "read" && knowledgePath) {
					knowledgeEvents.push({ type: "read", atMs: round(timed.elapsedMs), path: knowledgePath });
				}
			}
		}
		if (type === "tool_execution_end") {
			const id = stringValue(event.toolCallId);
			const call = id ? toolCallsById.get(id) : undefined;
			if (call) {
				call.durationMs = round(timed.elapsedMs - call.startedAtMs);
				call.isError = event.isError === true;
				call.isWarning = event.isWarning === true;
			}
		}
	}

	const failures = [...input.stdoutErrors];
	if (input.timedOut) failures.push("process timed out");
	if (input.exitCode !== 0) failures.push(`process exited ${input.exitCode}`);
	if (promptAt === undefined) failures.push("user prompt event missing");
	if (firstTextAt === undefined) failures.push("non-empty text delta missing");
	if (input.thinking !== undefined && effectiveThinking === undefined) {
		failures.push("effective thinking level missing from session event");
	}
	if (assistantMessages.length === 0 || lastAssistantEndAt === undefined) {
		failures.push("assistant completion event missing");
	}
	failures.push(...assistantErrors);
	const expected = selectorParts(input.target.selector);
	if (expected && provider && model && (provider !== expected.provider || model !== expected.model)) {
		failures.push(`resolved ${provider}/${model} instead of ${input.target.selector}`);
	}

	const contractFailures = evaluateScenarioContract(input.scenario, response, toolCalls, knowledgeEvents);
	const transportSucceeded = failures.length === 0;
	const quality = evaluateScenarioQuality(
		input.scenario,
		response,
		contractFailures.length === 0,
		transportSucceeded,
	);
	const finalMessage = assistantMessages.at(-1);
	const usage = sumUsage(assistantMessages);
	const providerReportedDurations = assistantMessages
		.map(message => finiteNumber(message.duration))
		.filter((duration): duration is number => duration !== undefined);
	const providerReportedTtftMs = finiteNumber(assistantMessages[0]?.ttft);
	const providerReportedDurationMs =
		providerReportedDurations.length > 0 ? providerReportedDurations.reduce((sum, duration) => sum + duration, 0) : undefined;
	const completedToolDurations = toolCalls
		.map(call => call.durationMs)
		.filter((duration): duration is number => duration !== undefined);

	return {
		label: input.target.label,
		selector: input.target.selector,
		scenarioId: input.scenario.id,
		scenarioLabel: input.scenario.label,
		suite: input.scenario.suite,
		tier: input.scenario.tier,
		requestedThinking: input.thinking,
		effectiveThinking,
		contextName: input.contextName,
		round: input.round,
		warmup: input.warmup,
		startedAt: input.startedAt,
		provider,
		model,
		success: transportSucceeded,
		contractPassed: contractFailures.length === 0,
		contractFailures,
		quality,
		response,
		stopReason: stringValue(finalMessage?.stopReason),
		error: failures.length > 0 ? failures.join("; ") : undefined,
		stderr: input.stderr.trim() || undefined,
		exitCode: input.exitCode,
		timedOut: input.timedOut,
		eventCount: input.events.length,
		turnCount,
		assistantMessageCount: assistantMessages.length,
		toolCalls,
		knowledgeEvents,
		timeToAuthoritativeEvidenceMs: knowledgeEvents.find(
			event => event.type === "api-catalog-preflight" || event.path?.startsWith("xcsh://"),
		)?.atMs,
		startupMs: promptAt === undefined ? undefined : round(promptAt),
		ttftMs: promptAt === undefined || firstTextAt === undefined ? undefined : round(firstTextAt - promptAt),
		timeToFirstToolMs:
			promptAt === undefined || toolCalls.length === 0 ? undefined : round(toolCalls[0].startedAtMs - promptAt),
		startupInclusiveTtftMs: firstTextAt === undefined ? undefined : round(firstTextAt),
		responseDurationMs:
			promptAt === undefined || lastAssistantEndAt === undefined ? undefined : round(lastAssistantEndAt - promptAt),
		totalToolDurationMs:
			completedToolDurations.length > 0
				? round(completedToolDurations.reduce((sum, duration) => sum + duration, 0))
				: undefined,
		processDurationMs: round(input.processDurationMs),
		providerReportedTtftMs,
		providerReportedDurationMs,
		outputTokensPerSecond:
			usage && providerReportedDurationMs !== undefined && providerReportedDurationMs > 0
				? round((usage.output * 1000) / providerReportedDurationMs)
				: undefined,
		usage,
	};
}

function scenarioTurns(scenario: ModelBenchmarkScenario): readonly ModelScenarioTurn[] {
	return scenario.turns ?? [
		{ id: "turn-1", prompt: scenario.prompt, contract: scenario.contract, quality: scenario.quality },
	];
}

function projectTurn(
	definition: ModelScenarioTurn,
	sample: Omit<ScenarioBenchmarkSample, "turns">,
	input: ScenarioBenchmarkTurnInput,
): ScenarioBenchmarkTurn {
	return {
		id: definition.id,
		prompt: definition.prompt,
		success: sample.success,
		contractPassed: sample.contractPassed,
		contractFailures: sample.contractFailures,
		quality: sample.quality,
		response: sample.response,
		error: input.error ?? sample.error,
		startedAtMs: input.startedAtMs,
		durationMs: input.durationMs,
		toolCalls: sample.toolCalls,
		knowledgeEvents: sample.knowledgeEvents,
		ttftMs: sample.ttftMs,
		timeToFirstToolMs: sample.timeToFirstToolMs,
		timeToAuthoritativeEvidenceMs: sample.timeToAuthoritativeEvidenceMs,
		responseDurationMs: sample.responseDurationMs,
	};
}

export function buildScenarioBenchmarkSample(input: BuildScenarioBenchmarkSampleInput): ScenarioBenchmarkSample {
	const definitions = scenarioTurns(input.scenario);
	if (!input.turnInputs) {
		const sample = buildSingleScenarioBenchmarkSample(input);
		return {
			...sample,
			turns: [projectTurn(definitions[0], sample, {
				startedAtMs: sample.startupMs ?? 0,
				durationMs: input.processDurationMs,
				events: input.events,
			})],
		};
	}
	if (definitions.length !== input.turnInputs.length) {
		throw new Error(`scenario ${input.scenario.id} defines ${definitions.length} turns but captured ${input.turnInputs.length}`);
	}
	const turnSamples = definitions.map((definition, index) => {
		const turnInput = input.turnInputs![index];
		const scenario: ModelBenchmarkScenario = {
			...input.scenario,
			prompt: definition.prompt,
			contract: definition.contract,
			quality: definition.quality,
			turns: undefined,
		};
		const sample = buildSingleScenarioBenchmarkSample({
			...input,
			scenario,
			thinking: undefined,
			processDurationMs: turnInput.durationMs,
			exitCode: 0,
			timedOut: false,
			stderr: "",
			stdoutErrors: turnInput.error ? [turnInput.error] : [],
			events: turnInput.events,
		});
		return { sample, turn: projectTurn(definition, sample, turnInput) };
	});
	const last = turnSamples.at(-1)!.sample;
	const turns = turnSamples.map(entry => entry.turn);
	const contractFailures = turns.flatMap(turn => turn.contractFailures.map(failure => `${turn.id}: ${failure}`));
	const errors = [
		...input.stdoutErrors,
		...(input.timedOut ? ["process timed out"] : []),
		...(input.exitCode !== 0 ? [`process exited ${input.exitCode}`] : []),
		...turns.flatMap(turn => turn.error ? [`${turn.id}: ${turn.error}`] : []),
	];
	const possible = turns.reduce((sum, turn) => sum + turn.quality.possible, 0);
	const earned = turns.reduce((sum, turn) => sum + turn.quality.earned, 0);
	const sessionEvent = input.events
		.map(event => record(event.event))
		.find(event => event?.type === "session");
	const stateEvent = input.events
		.map(event => record(event.event))
		.find(event => event?.type === "response" && event.command === "get_state");
	const stateData = record(stateEvent?.data);
	const stateModel = record(stateData?.model);
	const usages = turnSamples
		.map(entry => entry.sample.usage)
		.filter((usage): usage is ModelBenchmarkUsage => usage !== undefined);
	const usage = usages.length > 0
		? usages.reduce<ModelBenchmarkUsage>(
			(total, item) => ({
				input: total.input + item.input,
				output: total.output + item.output,
				cacheRead: total.cacheRead + item.cacheRead,
				cacheWrite: total.cacheWrite + item.cacheWrite,
				totalTokens: total.totalTokens + item.totalTokens,
				costTotal: total.costTotal + item.costTotal,
			}),
			{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0 },
		)
		: undefined;
	return {
		...last,
		scenarioId: input.scenario.id,
		scenarioLabel: input.scenario.label,
		requestedThinking: input.thinking,
		effectiveThinking: effortValue(sessionEvent?.thinking) ?? effortValue(stateData?.thinkingLevel),
		provider: stringValue(sessionEvent?.provider) ?? stringValue(stateModel?.provider) ?? last.provider,
		model: stringValue(sessionEvent?.model) ?? stringValue(stateModel?.id) ?? last.model,
		success: errors.length === 0 && turns.every(turn => turn.success),
		contractPassed: contractFailures.length === 0,
		contractFailures,
		quality: {
			score: possible === 0 ? 0 : round((earned / possible) * 100),
			earned,
			possible,
			visibleWords: turns.reduce((sum, turn) => sum + turn.quality.visibleWords, 0),
			criteria: turns.flatMap(turn => turn.quality.criteria.map(criterion => ({ ...criterion, id: `${turn.id}:${criterion.id}` }))),
		},
		response: turns.map(turn => turn.response).join("\n\n"),
		error: errors.length > 0 ? errors.join("; ") : undefined,
		stderr: input.stderr.trim() || undefined,
		exitCode: input.exitCode,
		timedOut: input.timedOut,
		eventCount: input.events.length,
		turnCount: turns.length,
		assistantMessageCount: turnSamples.reduce((sum, entry) => sum + entry.sample.assistantMessageCount, 0),
		toolCalls: turns.flatMap(turn => turn.toolCalls),
		knowledgeEvents: turns.flatMap(turn => turn.knowledgeEvents),
		turns,
		timeToAuthoritativeEvidenceMs: turns.find(turn => turn.timeToAuthoritativeEvidenceMs !== undefined)?.timeToAuthoritativeEvidenceMs,
		responseDurationMs: turns.reduce((sum, turn) => sum + (turn.responseDurationMs ?? 0), 0),
		totalToolDurationMs: turns.reduce((sum, turn) => sum + turn.toolCalls.reduce((total, call) => total + (call.durationMs ?? 0), 0), 0),
		processDurationMs: round(input.processDurationMs),
		usage,
	};
}

function summarizeNumbers(values: Array<number | undefined>): NumericSummary | null {
	const present = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (present.length === 0) return null;
	const sorted = [...present].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	const p95 = sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1))];
	return { min: round(sorted[0]), p50: round(median), p95: round(p95), max: round(sorted[sorted.length - 1]) };
}

export function summarizeScenarioBenchmarks(
	scenarios: readonly ModelBenchmarkScenario[],
	targets: ModelBenchmarkTarget[],
	thinkingEfforts: readonly Effort[],
	samples: ScenarioBenchmarkSample[],
): ScenarioBenchmarkSummary[] {
	return scenarios.flatMap(scenario =>
		thinkingEfforts.flatMap(thinking => targets.map(target => {
			const selected = samples.filter(
				sample =>
					sample.scenarioId === scenario.id &&
					sample.selector === target.selector &&
					sample.requestedThinking === thinking &&
					!sample.warmup,
			);
			const successful = selected.filter(sample => sample.success);
			const count = selected.length;
			const contractPasses = selected.filter(sample => sample.contractPassed).length;
			return {
				scenarioId: scenario.id,
				scenarioLabel: scenario.label,
				suite: scenario.suite,
				tier: scenario.tier,
				thinking,
				label: target.label,
				selector: target.selector,
				samples: count,
				successes: successful.length,
				contractPasses,
				successRate: count === 0 ? 0 : round(successful.length / count),
				contractPassRate: count === 0 ? 0 : round(contractPasses / count),
				qualityScore: summarizeNumbers(selected.map(sample => sample.quality.score)),
				visibleWords: summarizeNumbers(selected.map(sample => sample.quality.visibleWords)),
				latencyMs: {
					startup: summarizeNumbers(successful.map(sample => sample.startupMs)),
					ttft: summarizeNumbers(successful.map(sample => sample.ttftMs)),
					timeToFirstTool: summarizeNumbers(successful.map(sample => sample.timeToFirstToolMs)),
					authoritativeEvidence: summarizeNumbers(successful.map(sample => sample.timeToAuthoritativeEvidenceMs)),
					response: summarizeNumbers(successful.map(sample => sample.responseDurationMs)),
					toolExecution: summarizeNumbers(successful.map(sample => sample.totalToolDurationMs)),
					process: summarizeNumbers(successful.map(sample => sample.processDurationMs)),
				},
				toolCalls: summarizeNumbers(successful.map(sample => sample.toolCalls.length)),
				outputTokensPerSecond: summarizeNumbers(successful.map(sample => sample.outputTokensPerSecond)),
				costTotal: summarizeNumbers(successful.map(sample => sample.usage?.costTotal)),
				tokens: {
					input: summarizeNumbers(successful.map(sample => sample.usage?.input)),
					output: summarizeNumbers(successful.map(sample => sample.usage?.output)),
					cacheRead: summarizeNumbers(successful.map(sample => sample.usage?.cacheRead)),
					cacheWrite: summarizeNumbers(successful.map(sample => sample.usage?.cacheWrite)),
				},
			};
		})),
	);
}

export function regradeScenarioBenchmarkReport(
	report: ScenarioBenchmarkReport,
	scenarios: readonly ModelBenchmarkScenario[],
): ScenarioBenchmarkReport {
	const selected = report.config.scenarios.map(configured => {
		const scenario = scenarios.find(candidate => candidate.id === configured.id);
		if (!scenario) throw new Error(`Cannot regrade unknown scenario: ${configured.id}`);
		return scenario;
	});
	const byId = new Map(selected.map(scenario => [scenario.id, scenario]));
	const regrade = (sample: ScenarioBenchmarkSample): ScenarioBenchmarkSample => {
		const scenario = byId.get(sample.scenarioId);
		if (!scenario) throw new Error(`Cannot regrade sample for unknown scenario: ${sample.scenarioId}`);
		const definitions = scenarioTurns(scenario);
		if (definitions.length > 1) {
			if (sample.turns.length !== definitions.length) {
				throw new Error(
					`Cannot regrade scenario ${scenario.id}: stored ${sample.turns.length} turns but definition has ${definitions.length}`,
				);
			}
			const turns = sample.turns.map((turn, index) => {
				const definition = definitions[index];
				const turnScenario: ModelBenchmarkScenario = {
					...scenario,
					prompt: definition.prompt,
					contract: definition.contract,
					quality: definition.quality,
					turns: undefined,
				};
				const contractFailures = evaluateScenarioContract(
					turnScenario,
					turn.response,
					turn.toolCalls,
					turn.knowledgeEvents,
				);
				return {
					...turn,
					contractPassed: contractFailures.length === 0,
					contractFailures,
					quality: evaluateScenarioQuality(
						turnScenario,
						turn.response,
						contractFailures.length === 0,
						turn.success,
					),
				};
			});
			const contractFailures = turns.flatMap(turn =>
				turn.contractFailures.map(failure => `${turn.id}: ${failure}`),
			);
			const possible = turns.reduce((sum, turn) => sum + turn.quality.possible, 0);
			const earned = turns.reduce((sum, turn) => sum + turn.quality.earned, 0);
			return {
				...sample,
				contractPassed: contractFailures.length === 0,
				contractFailures,
				quality: {
					score: possible === 0 ? 0 : round((earned / possible) * 100),
					earned,
					possible,
					visibleWords: turns.reduce((sum, turn) => sum + turn.quality.visibleWords, 0),
					criteria: turns.flatMap(turn =>
						turn.quality.criteria.map(criterion => ({ ...criterion, id: `${turn.id}:${criterion.id}` })),
					),
				},
				turns,
			};
		}
		const contractFailures = evaluateScenarioContract(
			scenario,
			sample.response,
			sample.toolCalls,
			sample.knowledgeEvents ?? [],
		);
		return {
			...sample,
			contractPassed: contractFailures.length === 0,
			contractFailures,
			quality: evaluateScenarioQuality(scenario, sample.response, contractFailures.length === 0, sample.success),
		};
	};
	const warmups = report.warmups.map(regrade);
	const samples = report.samples.map(regrade);
	return {
		...report,
		config: {
			...report.config,
			scenarios: selected.map(scenario => ({
				id: scenario.id,
				label: scenario.label,
				suite: scenario.suite,
				tier: scenario.tier,
				prompt: scenario.prompt,
				contract: describeScenarioContract(scenario),
				quality: scenario.quality.map(criterion => ({
					id: criterion.id,
					label: criterion.label,
					weight: criterion.weight,
				})),
				runtime: scenario.runtime,
				turns: scenario.turns?.map(turn => ({
					id: turn.id,
					prompt: turn.prompt,
					contract: describeScenarioContract({ ...scenario, ...turn, turns: undefined }),
					quality: turn.quality.map(criterion => ({
						id: criterion.id,
						label: criterion.label,
						weight: criterion.weight,
					})),
				})),
			})),
		},
		warmups,
		samples,
		summaries: summarizeScenarioBenchmarks(selected, report.config.models, report.config.thinkingEfforts, samples),
	};
}

export function describeScenarioContract(scenario: ModelBenchmarkScenario): string[] {
	const descriptions: string[] = [];
	if (scenario.contract.expectedResponse !== undefined) {
		descriptions.push(`exact response ${JSON.stringify(scenario.contract.expectedResponse)}`);
	}
	descriptions.push(...(scenario.contract.requiredResponsePatterns ?? []).map(pattern => pattern.label));
	descriptions.push(
		...(scenario.contract.forbiddenResponsePatterns ?? []).map(pattern => `forbid: ${pattern.label}`),
	);
	descriptions.push(
		...(scenario.contract.requiredTools ?? []).map(
			tool =>
				scenario.contract.allowReadContinuations
					? `${toolExpectationLabel(tool)} called exactly ${tool.count} initial time(s); bounded sel continuations permitted`
					: `${toolExpectationLabel(tool)} called exactly ${tool.count} time(s)`,
		),
	);
	descriptions.push(
		...(scenario.contract.requiredKnowledgeSequence ?? []).map(event =>
			event.type === "api-catalog-preflight"
				? `preflight query ${JSON.stringify(event.query)}`
				: `read ${event.path ?? event.pathPattern}`,
		),
	);
	if (scenario.contract.exclusiveTools) descriptions.push("no unexpected tools");
	return descriptions;
}
