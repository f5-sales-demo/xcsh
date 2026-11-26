import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "9b29e17ff1dada1cdbc826d78a54f0c86c6390f9df779862d0051145465f1cbd",
				size_bytes: 46322493,
			},
			"canonical-manifest.json": {
				sha256: "3747e8e8fdf32d173ed0ced828f1ef96c2271dcb4b11b07ae2583d58468afc89",
				size_bytes: 7565728,
			},
			"manifest.json": {
				sha256: "bf015939e83afc93a4842ba6c22d569e88a98b488de78cc3045c9d07e5a28b1a",
				size_bytes: 70478860,
			},
			"publication.json": {
				sha256: "4c92e9692d97801faab92f354d0f5a2fbba62e2e98a4ca55ee9325703bb4554a",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "8dc572310e731147a28f860d75a9b1e04bf64c24087708ca5109434b83a11eda",
				size_bytes: 9982254,
			},
			"registry-manifest.json": {
				sha256: "8687f17a6f0df3ab1ab2d50f1d6ea65e498a090142e825debcf1106c19411ce1",
				size_bytes: 237498,
			},
			"registry-projection-manifest.json": {
				sha256: "581badafac5bcd5911c57a84d7516298850e5b7da4797adff0bd35405ce90d1d",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "e26686b586731c95bcaa8ce052f9fc16f26c6e58fabf08a381c4d66b5c62c27d", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "68e0b5510ad97f0a057caedf81dd9e54c36f8f115007d19ceb94b3c3a805d48c",
				size_bytes: 9857727,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:e62318985676da5dc8f5d2d35ccc26c58c5f11f463e5627995ce95f8658f6b43",
		provider_version: "v15.17.9",
		release_tag: "documentation-v15.17.9",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "aabc6849b33b286f282ec2a90d0d08337ab77e47",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:b750ce4b9c0ad9c90dad992a893773bacfb3aeff7598bc37194f3037f353c949",
		receipt_sha256: "4c92e9692d97801faab92f354d0f5a2fbba62e2e98a4ca55ee9325703bb4554a",
		index: {
			sha256: "6e7891eb508681c91d9b4e16299c951fd7f4ce30b5412dd7ebd4c7b83265423d",
			size_bytes: 668192768,
			gzip_sha256: "32778b75ecf0d9d0e83eb514bd2ee9633e3ee29cc7ee5354cde870b0ade0db66",
			gzip_size_bytes: 63344910,
		},
	},
} satisfies TerraformEmbeddedAssets;
