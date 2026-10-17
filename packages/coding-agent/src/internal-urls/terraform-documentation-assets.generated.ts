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
				sha256: "e83dccfc23bdacc2aac466c9ae3266a95b7e7a4cc55acae809005033cbf805b3",
				size_bytes: 7565728,
			},
			"manifest.json": {
				sha256: "0035443163e9a5e55922ebe83da704f2b93b79697e09d7dbb6f3465f2773539c",
				size_bytes: 70477563,
			},
			"publication.json": {
				sha256: "bcf94d78697713a45dcf56c48dafffbed575ec4f2460bd5647dd1f690286523c",
				size_bytes: 1380,
			},
			"registry-documentation.tar.gz": {
				sha256: "91e43d5a1fca338b5410729233e0111eb9b33744cca009bd4add0569fbb33304",
				size_bytes: 9981461,
			},
			"registry-manifest.json": {
				sha256: "f653a61694439e6a8f0f995f6c3ba0eeb4008a88614cf9a49651416d4f40dabb",
				size_bytes: 237498,
			},
			"registry-projection-manifest.json": {
				sha256: "febeac9c6a7da373e7c9aadeccadd6a607487463f869eef28f857fbf94012411",
				size_bytes: 276722,
			},
			SHA256SUMS: { sha256: "ed378086c3b0d6608a1b2746223c52cbe9628769e9ed603b465b399cd51e4aaa", size_bytes: 723 },
			"terraform-docs.tar.gz": {
				sha256: "e50ea87ee3ee3d1dbc50108f0ba5d3c0da8c8000cb5102a73ed2e82023063248",
				size_bytes: 9859081,
			},
		},
		document_count: 16403,
		provider_schema_digest: "sha256:a43a21ec82c017926d35acc6efc3b0a8740fd394357a09aa0e63e65503eb7aff",
		provider_version: "v15.10.4",
		release_tag: "documentation-v15.10.4",
		retrieval_metadata_version: 1,
		schema_version: 2,
		source_commit: "db7d75e2bde724d7f19b01be8db586492cfeef26",
		source_repository: "f5-sales-demo/terraform-provider-xcsh",
		source_root: "documentation",
		spec_pin_digest: "sha256:d5e8f282045e20f8be00960c9e0ed5287ab3532b8da7d4b559f1cea17fd51bca",
		receipt_sha256: "bcf94d78697713a45dcf56c48dafffbed575ec4f2460bd5647dd1f690286523c",
		index: {
			sha256: "8d3e05a4b840a84e9afd977bc2ef229d1d3743da1a2783ac5c31480a4ea1c31e",
			size_bytes: 668176384,
			gzip_sha256: "eec2956203636e47a89fa6900621223096e58cb3757986f5c682cc8a91229d8b",
			gzip_size_bytes: 63487325,
		},
	},
} satisfies TerraformEmbeddedAssets;
