import { closeDb, getRecentRequests, initDb, insertMessageStats } from "../../src/db";
import type { MessageStats } from "../../src/types";

await initDb();
const baseMessage = {
	sessionFile: "/tmp/legacy-session.jsonl",
	folder: "/tmp/project",
	model: "legacy-model",
	provider: "legacy-provider",
	api: "openai-completions",
	timestamp: Date.now(),
	duration: null,
	ttft: null,
	stopReason: "stop",
	errorMessage: null,
	usage: {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
	},
};

const partialInserted = insertMessageStats([
	{
		...baseMessage,
		entryId: "legacy-partial-cost",
		usage: { ...baseMessage.usage, cost: { total: 1 } },
	} as unknown as MessageStats,
]);
const partialCost = getRecentRequests(1)[0]?.usage.cost;

const completeCost = { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 };
const completeInserted = insertMessageStats([
	{
		...baseMessage,
		entryId: "current-complete-cost",
		timestamp: baseMessage.timestamp + 1,
		usage: { ...baseMessage.usage, cost: completeCost },
	} as MessageStats,
]);
const storedCompleteCost = getRecentRequests(1)[0]?.usage.cost;
closeDb();
console.log(JSON.stringify({ inserted: partialInserted + completeInserted, partialCost, storedCompleteCost }));
