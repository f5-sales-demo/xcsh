import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		schema_version: 2,
		retrieval_metadata_version: 1,
		source_root: "documentation",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		release_tag: "documentation-v12.3.1",
		provider_version: "v12.3.1",
		source_commit: "2f59e49f839f5da493bc716669c427aa0f16445a",
		document_count: 18958,
		provider_schema_digest: "sha256:e93f7e38d36f867af35587962cdc3c5282fd19efd6d50da0ec22d86812ee056f",
		spec_pin_digest: "sha256:442a6f7ed6e6f9010cd38e0a636e997c70358deccd3ce493d233d9ed86c49d27",
		receipt_sha256: "da1e6c3148a7083e8b374f45a3f8a5d04d3275a349aa348e2015ec60f1c039bd",
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "bae941671a76b16c5e279a76eb9c48794196e42bfdd72cd5594d9cf26c79c00f",
				size_bytes: 58341258,
			},
			"canonical-manifest.json": {
				sha256: "6a99d0536ddf758f176fa64f309db5d7039830219989a8b3ff5801c41811b791",
				size_bytes: 8784019,
			},
			"manifest.json": {
				sha256: "8c25198a4d17a1f362b8433b999a2af1516f3430ce957aab1a5654899107b89d",
				size_bytes: 82086005,
			},
			"publication.json": {
				sha256: "da1e6c3148a7083e8b374f45a3f8a5d04d3275a349aa348e2015ec60f1c039bd",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "cd4618beca157f3331aeba3eef85ac5cb797489ece8d6b2ca354c3b9f046d933",
				size_bytes: 15082569,
			},
			"registry-manifest.json": {
				sha256: "21b2d40b5749840f904f826cc1505a914876cef9c898b8eff9d9fef1efd05ff7",
				size_bytes: 251853,
			},
			"registry-projection-manifest.json": {
				sha256: "a73e4e8782c98e9b647f3c122fabcaa8f7eab30b78040af7223c4fb5b8ad4f0e",
				size_bytes: 303877,
			},
			SHA256SUMS: { sha256: "e6943da32f0112acbb4d195174b30c28f5be875bcd248c0f2ae3a6963fd5cd8d", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "494137e3aadf6350b1f357b7b9c064936b57886309ad210c81c1fd2a2a03e724",
				size_bytes: 11751784,
			},
		},
		index: {
			sha256: "a4c05b0d77e8f2cf7c4c2cd8fb22dcb904efa48f1e0a23c218be845ba5aede7d",
			size_bytes: 781434880,
			gzip_sha256: "8453c709295174edd520e8c8f785a9e9fc362676756acce2768d895f7e1bee1d",
			gzip_size_bytes: 70980995,
		},
	},
} satisfies TerraformEmbeddedAssets;
