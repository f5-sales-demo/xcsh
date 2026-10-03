import {terraformHash} from "../../src/internal-urls/terraform-documentation";
export interface InstalledMeasurementIdentity {commit:string;provider_source_commit:string;index_sha256:string;request_sha256:string;requests:string[]}
export function validateInstalledMeasurement(report:any,expected:InstalledMeasurementIdentity):string[]{
 const errors:string[]=[];const fail=(ok:boolean,message:string)=>{if(!ok)errors.push(message)};
 fail(report?.schema_version===1&&report.installed_resolver===true&&report.qualification_passed===false,"Installed measurement envelope required");
 fail(report?.build?.commit===expected.commit,"Build commit mismatch");
 fail(report?.provider_source_commit===expected.provider_source_commit,"Provider source mismatch");
 fail(report?.index_sha256===expected.index_sha256,"Index mismatch");fail(report?.request_sha256===expected.request_sha256,"Request file mismatch");
 fail(["linux","darwin"].includes(report?.platform)&&typeof report?.arch==="string","Supported installed platform required");
 fail(report?.repetitions===5&&Number.isFinite(report?.materialization_ms)&&report.materialization_ms>=0&&report.model_network_ms===null,"Five offline resolver repetitions required");
 const rows=Array.isArray(report?.results)?report.results:[];
 fail(rows.length===expected.requests.length&&rows.every((r:any,i:number)=>r.request===expected.requests[i]),"Complete ordered request coverage required");
 const times=(a:any,n:number)=>Array.isArray(a)&&a.length===n&&a.every((t:any)=>Number.isFinite(t)&&t>=0);
 for(const [index,row] of rows.entries()){
  const prefix=`request-${index}: `;const check=(ok:boolean,message:string)=>fail(ok,prefix+message);
  if(typeof row.discovery!=="string"||typeof row.context!=="string"){check(false,"complete response text required");continue;}
  const discoveryBytes=Buffer.byteLength(row.discovery),contextBytes=Buffer.byteLength(row.context);
  const selected=row.discovery.includes("Selected leaf;");
  check(discoveryBytes<=4096,"discovery budget exceeded");check(contextBytes<=16384,"context budget exceeded");
  check(!selected||contextBytes>0,"selected leaf requires complete context");check(selected||contextBytes===0,"unselected response has unexpected context");
  check(row.response_sha256===terraformHash(`${row.discovery}\0${row.context}`),"complete response hash mismatch");
  check(times(row.discovery_times_ms,5)&&times(row.context_times_ms,selected?5:0)&&times(row.route_times_ms,5),"invalid five repetition timings");
  check(row.tool_calls===(selected?10:5)&&row.total_response_bytes===(discoveryBytes+contextBytes)*5&&row.max_discovery_bytes===discoveryBytes&&row.max_context_bytes===contextBytes,"response accounting mismatch");
 }
 return errors;
}
