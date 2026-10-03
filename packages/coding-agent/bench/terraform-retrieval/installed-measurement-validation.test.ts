import {expect,test} from "bun:test";
import {terraformHash} from "../../src/internal-urls/terraform-documentation";
import {validateInstalledMeasurement} from "./installed-measurement-validation";
const uri="xcsh://terraform-documentation/?search=synthetic";
const expected={commit:"a".repeat(40),provider_source_commit:"b".repeat(40),index_sha256:"c".repeat(64),request_sha256:"d".repeat(64),requests:[uri]};
const report=()=>({schema_version:1,installed_resolver:true,qualification_passed:false,build:{commit:expected.commit},provider_source_commit:expected.provider_source_commit,index_sha256:expected.index_sha256,request_sha256:expected.request_sha256,platform:"linux",arch:"x64",repetitions:5,materialization_ms:20,model_network_ms:null,results:[{request:uri,discovery:"No results.",context:"",response_sha256:terraformHash("No results.\0"),discovery_times_ms:[1,2,3,4,5],context_times_ms:[],route_times_ms:[1,2,3,4,5],tool_calls:5,total_response_bytes:55,max_discovery_bytes:11,max_context_bytes:0}]});
test("installed report verifies complete response hashes and exact build/request provenance",()=>{expect(validateInstalledMeasurement(report(),expected)).toEqual([])});
test("a result cannot qualify with a stale build or altered request list",()=>{
 const r=report();r.build.commit="e".repeat(40);expect(validateInstalledMeasurement(r,expected)).toContain("Build commit mismatch");
 expect(validateInstalledMeasurement(report(),{...expected,requests:[uri,uri]})).toContain("Complete ordered request coverage required");
});
test("modified payloads or misleading metrics fail independently of a reported hash",()=>{
 const r=report();r.results[0]!.discovery="fabricated";expect(validateInstalledMeasurement(r,expected)).toContain("request-0: complete response hash mismatch");
 const q=report();q.results[0]!.route_times_ms=[NaN,1,1,1,1];expect(validateInstalledMeasurement(q,expected)).toContain("request-0: invalid five repetition timings");
 const v=report();v.results[0]!.tool_calls=1;expect(validateInstalledMeasurement(v,expected)).toContain("request-0: response accounting mismatch");
});
test("budget violations and missing selected-leaf context cannot be hidden",()=>{
 const r=report();r.results[0]!.discovery="x".repeat(4097);expect(validateInstalledMeasurement(r,expected)).toContain("request-0: discovery budget exceeded");
 const s=report();s.results[0]!.discovery="Selected leaf;\nRead: xcsh://terraform-documentation/documentation/fixture.md#section";expect(validateInstalledMeasurement(s,expected)).toContain("request-0: selected leaf requires complete context");
});
