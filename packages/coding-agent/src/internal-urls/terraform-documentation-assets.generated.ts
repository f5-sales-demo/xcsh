import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with {
	type: "file",
};
import type { TerraformEmbeddedAssets } from "./terraform-documentation";
export const EMBEDDED_TERRAFORM_DOCUMENTATION = {
	indexGzipPath,
	pin: {
		assets: {
			"canonical-documentation.tar.gz": {
				sha256: "5685b82a97d40a66ca6c74744225be3c09b800a049bd53e2896b2867df350245",
				size_bytes: 46322487,
			},
			"canonical-manifest.json": {
				sha256: "d13e25e474c293e34c2a70f87b8a8c8a8bdd06827dbb559001f028d12021e626",
				size_bytes: 7565728,
			},
			"manifest.json": {
				sha256: "ecad67404878752c4effea56def2f45d6b29a4ed7c048eded341ec2b3089ff5f",
				size_bytes: 70477563,
			},
			"publication.json": {
				sha256: "f791e0d841999a360d7edf5db0fe8de67f78b592ccd37242487309a9471c5406",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "91e43d5a1fca338b5410729233e0111eb9b33744cca009bd4add0569fbb33304",
				size_bytes: 9981461,
			},
			"registry-manifest.json": {
				sha256: "a3298ab75faa6af4d18a40ef1f5982bcd7a91eecb716c7820aa78929413e2890",
				size_bytes: 237498,
			},
			"registry-projection-manifest.json": {
				sha256: "febeac9c6a7da373e7c9aadeccadd6a607487463f869eef28f857fbf94012411",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "e8a947236b72c437fccbd2a7dcc5d5b9392c20e85a196b8fb632a7789c92e949", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "e50ea87ee3ee3d1dbc50108f0ba5d3c0da8c8000cb5102a73ed2e82023063248",
				size_bytes: 9859081,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:a43a21ec82c017926d35acc6efc3b0a8740fd394357a09aa0e63e65503eb7aff",
		provider_version: "v15.10.1",
		release_tag: "documentation-v15.10.1",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "3b82ead113ce654da8c20e4c550fffe80c7db1fa",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:d5e8f282045e20f8be00960c9e0ed5287ab3532b8da7d4b559f1cea17fd51bca",
		receipt_sha256: "f791e0d841999a360d7edf5db0fe8de67f78b592ccd37242487309a9471c5406",
		index: {
			sha256: "6d71322c4e60dbb35ea8f63062d0966af7fd6c15a4769534ccc26306554fddd6",
			size_bytes: 668176384,
			gzip_sha256: "280468bed7fe1e00c9eb93fa40755c716d090a6b12e69e2179eda76aabb9ab07",
			gzip_size_bytes: 63487318,
		},
	},
} satisfies TerraformEmbeddedAssets;
