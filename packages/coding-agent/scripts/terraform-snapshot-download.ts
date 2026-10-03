/** Build-time transport only. Provenance and byte validation stay in the caller. */
export async function fetchTerraformSnapshot(
	url: string,
	init?: RequestInit,
	transport: {
		fetch: (url: string, init?: RequestInit) => Promise<Response>;
		sleep: (ms: number) => Promise<void>;
	} = {
		fetch: (url, init) => fetch(url, init),
		sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
	},
): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await transport.fetch(url, init);
			if (attempt >= 3 || ![408, 429, 500, 502, 503, 504].includes(response.status)) return response;
			await response.body?.cancel();
		} catch (error) {
			if (attempt >= 3 || !(error instanceof TypeError)) throw error;
		}
		await transport.sleep(500 * 2 ** attempt);
	}
}
