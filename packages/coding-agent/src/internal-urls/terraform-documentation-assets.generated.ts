import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "4110fadb432e995783ba015ccd378c45a64cb4efb08c667d57571683ffad3a09",
				size_bytes: 46316258,
			},
			"canonical-manifest.json": {
				sha256: "97984d6caf835c80b2d3fabfee52fb7749385226b5c8c9719aaf5414f034c5e0",
				size_bytes: 7565728,
			},
			"manifest.json": {
				sha256: "726c469e4f57bba3173eb031cb4e61489be34e2606e2dd4d8e0daa0c940b4ec9",
				size_bytes: 70478860,
			},
			"publication.json": {
				sha256: "783c3b2a91c8df567b29943db41ef382f8eb666752f0ec5d19e6e336a042b546",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "f05017ed28925f6b7711903837d95d0a3e7b1afbf6f2914e2c9df6b7d7e3587e",
				size_bytes: 9982010,
			},
			"registry-manifest.json": {
				sha256: "c2d38aa639da8ab3eea603e1529026390ebda5c359ea2f4c05dd12a9b40444f6",
				size_bytes: 237498,
			},
			"registry-projection-manifest.json": {
				sha256: "fff09dfb0d877b901edf6aea39f2f7753ca84f4c3588030b4aecb00394224282",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "ff10a1a116d4e95640ee49d99874c931fc35f3428ca2a0023b3236dc236721b3", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "bf7c15514e4e578953c38aec1112198449e4aeb7be47d71cf21b67555d4828b5",
				size_bytes: 9858200,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:5da5abed63484d73ce77467c8c65a96ecdf7e04c3db5d5bd821e0fa97991e015",
		provider_version: "v15.15.7",
		release_tag: "documentation-v15.15.7",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "3e073c8ea8241a58999c251621729f16030b653a",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:d30f9f9a1cd22b9ba948a7409b4aa6907eda743fb73415c72474bd2784e91af1",
		receipt_sha256: "783c3b2a91c8df567b29943db41ef382f8eb666752f0ec5d19e6e336a042b546",
		index: {
			sha256: "c5ac501b3895c952e9d2d671ee5dbcebd933b6dc2f9d15e135107abd34ba74ff",
			size_bytes: 668205056,
			gzip_sha256: "c802f65742ffd94153c5532ae4ace900152acfb7180328c872a3942fd107d549",
			gzip_size_bytes: 63345998,
		},
	},
} satisfies TerraformEmbeddedAssets;
