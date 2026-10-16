#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface ReleaseIdentity { commit: string; version: string; runId: string; }
interface Provenance {
 schemaVersion: number; platform: string; arch: string; version: string;
 source: { repository: string; commit: string; workflow: string; runId: string };
 binary: { name: string; size: number; sha256: string };
}
interface Pin { index: { gzip_size_bytes: number; gzip_sha256: string }; }
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Recover existing release bytes only. Publication separately verifies the uncompressed SQLite pin. */
export function recoverPinnedIndex(binary: Buffer, provenance: Provenance, pin: Pin, identity: ReleaseIdentity): Buffer {
 if (!/^[a-f0-9]{40}$/.test(identity.commit) || !/^\d+\.\d+\.\d+$/.test(identity.version) || !/^[1-9]\d*$/.test(identity.runId)
  || provenance?.schemaVersion !== 1 || provenance.platform !== "linux" || provenance.arch !== "x64"
  || provenance.version !== identity.version || provenance.source?.repository !== "f5-sales-demo/xcsh"
  || provenance.source.commit !== identity.commit || provenance.source.workflow !== "ci.yml" || provenance.source.runId !== identity.runId
  || provenance.binary?.name !== "xcsh-linux-x64") throw new Error("Published native release identity mismatch");
 if (binary.length !== provenance.binary.size || hash(binary) !== provenance.binary.sha256)
  throw new Error("Published native binary does not match provenance");
 const size = pin?.index?.gzip_size_bytes;
 const digest = pin?.index?.gzip_sha256;
 if (!Number.isSafeInteger(size) || size <= 0 || size > binary.length || !/^[a-f0-9]{64}$/.test(digest ?? ""))
  throw new Error("Malformed compressed index pin");
 const magic = Buffer.from([0x1f, 0x8b, 0x08]);
 let offset = binary.indexOf(magic);
 while (offset >= 0 && offset + size <= binary.length) {
  const candidate = binary.subarray(offset, offset + size);
  if (hash(candidate) === digest) return Buffer.from(candidate);
  offset = binary.indexOf(magic, offset + 1);
 }
 throw new Error("Exact pinned corpus bytes absent from published native binary");
}

if (import.meta.main) {
 const [binaryPath, provenancePath, pinPath, commit, version, runId, output] = process.argv.slice(2);
 if (!binaryPath || !provenancePath || !pinPath || !commit || !version || !runId || !output)
  throw new Error("Usage: recover-prebuilt-npm-index.ts BINARY PROVENANCE PIN COMMIT VERSION RUN_ID OUTPUT");
 const recovered = recoverPinnedIndex(await readFile(binaryPath), await Bun.file(provenancePath).json(), await Bun.file(pinPath).json(), { commit, version, runId });
 await mkdir(dirname(output), { recursive: true });
 const temporary = `${output}.recovery-${process.pid}`;
 await writeFile(temporary, recovered);
 await rename(temporary, output);
 console.log(`Recovered ${recovered.length} exact pinned corpus bytes from published ${version}`);
}
