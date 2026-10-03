import { terraformHash } from "../../src/internal-urls/terraform-documentation";
export async function measureCompleteRetrieval(
	read: (uri: string) => Promise<{ content: string }>,
	uri: string,
	repetitions = 5,
) {
	const discoveryTimes: number[] = [],
		contextTimes: number[] = [],
		routeTimes: number[] = [];
	let discovery = "",
		context = "",
		responseHash = "",
		toolCalls = 0,
		totalBytes = 0,
		maxDiscoveryBytes = 0,
		maxContextBytes = 0;
	for (let n = 0; n < repetitions; n++) {
		const routeStart = performance.now(),
			start = performance.now();
		discovery = (await read(uri)).content;
		discoveryTimes.push(performance.now() - start);
		toolCalls++;
		const bytes = Buffer.byteLength(discovery);
		totalBytes += bytes;
		maxDiscoveryBytes = Math.max(maxDiscoveryBytes, bytes);
		if (bytes > 4096) throw new Error("Discovery budget violated");
		context = "";
		const destination = [...discovery.matchAll(/^Read: (\S+)/gm)][0]?.[1];
		if (discovery.includes("Selected leaf;") && destination) {
			const target = new URL(destination);
			target.searchParams.set("view", "context");
			const before = performance.now();
			context = (await read(target.href)).content;
			contextTimes.push(performance.now() - before);
			toolCalls++;
			const contextBytes = Buffer.byteLength(context);
			totalBytes += contextBytes;
			maxContextBytes = Math.max(maxContextBytes, contextBytes);
			if (contextBytes > 16384) throw new Error("Context budget violated");
		}
		const hash = terraformHash(discovery + "\0" + context);
		if (!n) responseHash = hash;
		else if (hash !== responseHash) throw new Error("Non-deterministic complete retrieval response");
		routeTimes.push(performance.now() - routeStart);
	}
	return {
		discovery,
		context,
		responseHash,
		discoveryTimes,
		contextTimes,
		routeTimes,
		toolCalls,
		totalBytes,
		maxDiscoveryBytes,
		maxContextBytes,
	};
}
