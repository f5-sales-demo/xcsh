import { logger } from "@f5-sales-demo/pi-utils";

interface ImageRequest {
	model: string;
	prompt: string;
	n: number;
	size?: string;
	quality?: string;
}
export interface GeneratedOpenAIImage {
	data: string;
	mimeType: string;
	model: string;
	revisedPrompt?: string;
	usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
}

/** Preserve the configured gateway's native API and its existing image model. */
export async function requestOpenAIImage(
	baseUrl: string,
	apiKey: string,
	request: ImageRequest,
	gateway: boolean,
	signal?: AbortSignal,
): Promise<GeneratedOpenAIImage | undefined> {
	const root = baseUrl.replace(/\/+$/, "").replace(/\/(?:openai\/)?v1$/, "");
	const headers = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
	const post = (path: string, body: unknown) =>
		fetch(root + path, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
	const read = async (response: Response): Promise<unknown> => {
		const text = await response.text();
		let data: any;
		try {
			data = JSON.parse(text);
		} catch {
			/* Preserve non-JSON diagnostics privately. */
		}
		if (!response.ok) {
			logger.debug("Image transport rejected", { status: response.status, body: text });
			const message = typeof data?.detail === "string" ? data.detail : data?.error?.message;
			throw new Error(
				`OpenAI image request failed (${response.status}): ${
					typeof message === "string"
						? message.replaceAll(apiKey, "[credential]").slice(0, 512)
						: "Unexpected upstream response"
				}`,
			);
		}
		if (!data) throw new Error("Image service returned an invalid JSON response");
		return data;
	};
	const response = await post(gateway ? "/openai/v1/images/generations" : "/v1/images/generations", request);
	if (gateway && response.status === 403) {
		const rejection: unknown = await response
			.clone()
			.json()
			.catch(() => undefined);
		if (
			rejection &&
			typeof rejection === "object" &&
			"detail" in rejection &&
			typeof rejection.detail === "string" &&
			rejection.detail.startsWith("Direct API passthrough is disabled.")
		) {
			// This is a definite pre-execution rejection, so native fallback does not replay a generation.
			const models = await read(await fetch(root + "/api/v1/images/models", { headers, signal }));
			const supported = Array.isArray(models) ? models.map(model => model.id) : [];
			if (!supported.includes(request.model))
				throw new Error("Gateway native images do not support the requested OpenAI model");
			// Passing a model to some Open WebUI engines changes shared configuration.
			const native = await read(
				await post("/api/v1/images/generations", {
					prompt: request.prompt,
					n: request.n,
					...(request.size ? { size: request.size } : {}),
				}),
			);
			const url = Array.isArray(native) && typeof native[0]?.url === "string" ? native[0].url : undefined;
			if (!url) throw new Error("Gateway native images returned no asset");
			const asset = new URL(url, root + "/");
			const id = /\/api\/v1\/files\/([A-Za-z0-9_-]+)\/content$/.exec(asset.pathname)?.[1];
			if (asset.origin !== new URL(root).origin || !id) throw new Error("Gateway image asset identity is invalid");
			const metadata: any = await read(await fetch(root + "/api/v1/files/" + id, { headers, signal }));
			const model = metadata?.meta?.data?.model;
			if (typeof model !== "string" || !supported.includes(model))
				throw new Error("Gateway image model receipt is missing");
			const image = await fetch(asset, { headers, signal });
			if (!image.ok) throw new Error(`Gateway image download failed (${image.status})`);
			return {
				data: Buffer.from(await image.arrayBuffer()).toString("base64"),
				mimeType: image.headers.get("content-type")?.split(";")[0] ?? "image/png",
				model,
			};
		}
	}
	const data: any = await read(response);
	const entry = data.data?.[0];
	return typeof entry?.b64_json === "string"
		? {
				data: entry.b64_json,
				mimeType: "image/png",
				model: request.model,
				...(data.usage ? { usage: data.usage } : {}),
				...(typeof entry.revised_prompt === "string" ? { revisedPrompt: entry.revised_prompt } : {}),
			}
		: undefined;
}
