import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const script = `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const library=process.argv[2]==='cjs'?createRequire(import.meta.url)('./index.cjs'):await import('./index.js');
const {F5Core,getCapabilities}=library;
let revision='1',resource;const requests=[],receipts=[];
const host={getContext:()=>({active:true,workspaceId:'node-workspace',contextId:'node-context',revision,apiUrl:'https://example.invalid',namespace:'default'}),
 getCredentials:async()=>({apiToken:'node-synthetic-credential'}),approve:async p=>({approved:true,planHash:p.hash}),persist:async r=>receipts.push(r),
 transport:{request:async r=>{requests.push(r);if(r.method==='GET')return resource?{httpStatus:200,body:resource}:{httpStatus:404,body:{}};
 if(r.method==='DELETE'){resource=undefined;return{httpStatus:200,body:{}};}
 resource={...r.body,system_metadata:{uid:'node-uid',resource_version:String(requests.length)}};return{httpStatus:200,body:resource};}}};
const core=new F5Core(host),binding=await core.bind('node-conversation');
const object={kind:'http_loadbalancer',metadata:{name:'node-runtime',namespace:'default'},spec:{domains:['example.invalid'],routes:[],origin_pools:[]}};
assert.equal((await core.validate(binding,[object]))[0].valid,true);
assert.equal((await core.validate(binding,[{...object,spec:{...object.spec,http:{port:'invalid'}}}]))[0].valid,false);
assert.equal(requests.length,0);
const describe=await core.describe(binding,'http_loadbalancer',{field:'spec.more_option.custom_errors'});
assert.equal(describe.fields[0].constraints.constraintType,'map');
const plan=await core.plan(binding,'create',[object]);assert.equal((await core.execute(binding,plan.id)).results[0].status,'created');
assert.equal((await core.inspect(binding,'http_loadbalancer','node-runtime')).resource.metadata.name,'node-runtime');
const update=await core.plan(binding,'update',[{...object,spec:{...object.spec,domains:['updated.invalid']}}]);
assert.equal((await core.execute(binding,update.id)).results[0].status,'updated');
const deletion=await core.plan(binding,'delete',[object]);assert.equal((await core.execute(binding,deletion.id)).results[0].status,'deleted');
await assert.rejects(core.execute(binding,plan.id),{code:'PLAN_CONSUMED'});
assert.equal(JSON.stringify(receipts).includes('node-synthetic-credential'),false);
core.dispose();console.log(JSON.stringify({runtime:process.version,format:process.argv[2],specification:getCapabilities().specificationVersion,hash:getCapabilities().specificationHash,writes:requests.filter(r=>r.method!=='GET').length,standalone:true}));
`;

for (const format of ["esm", "cjs"] as const) {
	test(`standalone Node ${format} bundle performs actual specification-backed operations`, () => {
		const directory = mkdtempSync(path.join(os.tmpdir(), "xcsh-node-core-"));
		try {
			for (const name of ["index.js", "index.cjs"])
				copyFileSync(new URL(`../dist/${name}`, import.meta.url), path.join(directory, name));
			writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
			writeFileSync(path.join(directory, "scenario.mjs"), script);
			const node = Bun.which("node");
			if (!node) throw Error("A Node development runtime is required for this cross-runtime test");
			const result = Bun.spawnSync([node, path.join(directory, "scenario.mjs"), format], {
				cwd: directory,
				env: { ...process.env, PATH: directory, XCSH_API_URL: "", XCSH_API_TOKEN: "", XCSH_NAMESPACE: "" },
				stdout: "pipe",
				stderr: "pipe",
				timeout: 15000,
			});
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
			const receipt = JSON.parse(result.stdout.toString());
			expect(receipt).toMatchObject({ format, standalone: true, writes: 3, specification: "12.5.1" });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 20000);
}

test("standalone package declarations support Node ESM and CommonJS consumers", () => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "xcsh-node-core-types-"));
	try {
		const packageDirectory = path.join(directory, "node_modules/@f5-sales-demo/xcsh-f5-core");
		mkdirSync(path.join(packageDirectory, "dist"), { recursive: true });
		copyFileSync(new URL("../package.json", import.meta.url), path.join(packageDirectory, "package.json"));
		for (const name of ["index.d.ts", "index.d.cts"]) {
			const declarations = readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
			expect(declarations).not.toContain("@f5-sales-demo/pi-resource-management");
			writeFileSync(path.join(packageDirectory, "dist", name), declarations);
		}
		const consumer = `import { F5Core, getCapabilities, type CoreHost } from "@f5-sales-demo/xcsh-f5-core";
const host: CoreHost = {
getContext: () => ({active:true,workspaceId:"workspace",contextId:"context",revision:"1",apiUrl:"https://example.invalid",namespace:"default"}),
getCredentials: async () => ({apiToken:"synthetic-credential"}),
approve: async plan => ({approved:false,planHash:plan.hash}),persist: async () => {},
};
new F5Core(host).dispose(); getCapabilities();`;
		for (const extension of ["mts", "cts"]) writeFileSync(path.join(directory, `consumer.${extension}`), consumer);
		const compiler = path.resolve(import.meta.dir, "../../../node_modules/.bin/tsgo");
		for (const resolution of ["Node16", "NodeNext"]) {
			const result = Bun.spawnSync(
				[
					compiler,
					"--noEmit",
					"--strict",
					"--module",
					resolution,
					"--moduleResolution",
					resolution,
					"--target",
					"ES2022",
					"consumer.mts",
					"consumer.cts",
				],
				{ cwd: directory, stdout: "pipe", stderr: "pipe", timeout: 15000 },
			);
			expect(result.stdout.toString()).toBe("");
			expect(result.stderr.toString()).toBe("");
			expect(result.exitCode).toBe(0);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 20000);
