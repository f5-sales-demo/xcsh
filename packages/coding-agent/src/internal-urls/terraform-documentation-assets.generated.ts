import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "6cd14f1f2ff6c76b763f916a3464556fef43aa5c72ffef35b1920e6beb72604b",
				size_bytes: 47572995,
			},
			"canonical-manifest.json": {
				sha256: "c16d89c8e1f2e983f867d5cbbd5607ac5b1c95c10331275f490a822d15a8e795",
				size_bytes: 7549865,
			},
			"manifest.json": {
				sha256: "d3f3132d6b5834be64f85cc5c7c9a04d2f31ad22ca3897ef9b19dac34a35081c",
				size_bytes: 75780013,
			},
			"publication.json": {
				sha256: "81c1d199826edc5bc3df299e597153d6aba8d9a73ed5f21e0f025981615f94ed",
				size_bytes: 1379,
			},
			"registry-documentation.tar.gz": {
				sha256: "3a3795a2cfce6be3fe2e6308108d70e46854e823af86e02473e9db226733abf3",
				size_bytes: 9964949,
			},
			"registry-manifest.json": {
				sha256: "9cffaea79fc6cbaf6c1f426a86f1cecc9b7cf275b18d68c65dbbeeead2202466",
				size_bytes: 235320,
			},
			"registry-projection-manifest.json": {
				sha256: "b87a36fe1b372886caa3fa8a5a66f232d42539349f191d3ce4d2714c2ed976fa",
				size_bytes: 275016,
			},
			SHA256SUMS: { sha256: "09eb52a46dd64849b01adeab13c3dfe7c610e88948c8b0bdb5ef9d01cd0cdf59", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "23ab4bd028a5a74183a9b3edec12246f28608f137849671ebe7de2bc2d62eccc",
				size_bytes: 10224123,
			},
		},
		document_count: 16366,
		provider_schema_digest: "sha256:057968f86e4ef0ae0087dd4d6097131e285b60998d97655ee1a02c00315f6b0f",
		provider_version: "v15.2.0",
		release_tag: "documentation-v15.2.0",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "4a6732d62dac10e5a4454ceea2f6dd32db6403c1",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:fb3399d426b86fc806bdce295180d1446d1c05db41b1ae48575b9b6c2409bc5e",
		receipt_sha256: "81c1d199826edc5bc3df299e597153d6aba8d9a73ed5f21e0f025981615f94ed",
		index: {
			sha256: "6de4f8410d0cec62c32a2e34ffa98f358f9b465a2ab4eed8efb13e11a08855d9",
			size_bytes: 687099904,
			gzip_sha256: "d2af0e2dafb3992dae82695cc728dcd4e7da1d0c3d0e6680b233079d63d80196",
			gzip_size_bytes: 64385778,
		},
	},
} satisfies TerraformEmbeddedAssets;
