import { handleTerraform } from "../web/scrapers/terraform";
import type { InternalResource, InternalUrl } from "./types";

export interface RegistryResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createRegistryResolver(): RegistryResolver {
	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = (url.rawPathname ?? url.pathname).replace(/^\/+/, "").replace(/\/+$/, "");
			const host = url.rawHost || url.hostname;

			let targetUrl: string;

			if (host === "provider" || pathname.startsWith("provider/")) {
				const parts = (host === "provider" ? pathname : pathname.replace(/^provider\//, "")).split("/");
				const namespace = parts[0] || "hashicorp";
				const type = parts[1] || parts[0];
				targetUrl = `https://registry.terraform.io/providers/${namespace}/${type}`;
			} else if (host === "module" || pathname.startsWith("module/")) {
				const parts = (host === "module" ? pathname : pathname.replace(/^module\//, "")).split("/");
				const namespace = parts[0] || "terraform-aws-modules";
				const name = parts[1] || "vpc";
				const provider = parts[2] || "aws";
				targetUrl = `https://registry.terraform.io/modules/${namespace}/${name}/${provider}`;
			} else {
				// Default fallback search overview
				targetUrl = `https://registry.terraform.io/providers/f5-sales-demo/xcsh`;
			}

			const result = await handleTerraform(targetUrl, 10000);
			const content =
				result?.content ??
				`# Terraform Registry Lookup (${targetUrl})\n\nCould not fetch details from Terraform Registry. Defaulting to provider source \`f5-sales-demo/xcsh\`.`;

			return {
				url: url.href,
				content,
				contentType: "text/markdown",
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: `xcsh://registry/${pathname}`,
			};
		},
	};
}
