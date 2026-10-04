import {expect,test} from "bun:test";import {parseProviderIdentity,identityTokens} from "./provider-identity-parser";
test("provider spans retain unknown and malformed identities without choosing prose alternatives",()=>{for(const q of ["Do not modify state for xcsh_missing_fixture resource like origin pool","xcsh_missing_fixture (resource)","resource named \"xcsh_missing_fixture\"","xcsh_missing_fixture.instance"]){expect(parseProviderIdentity(q).providerNames).toEqual(["missing_fixture"]);}expect(parseProviderIdentity("xcsh_123widget resource").identities[0]?.valid).toBe(false);expect(parseProviderIdentity("xcsh_missing-widget resource").identities[0]?.valid).toBe(false);});
test("variables functions quotedvalues and rejected identities retain classified evidence",()=>{for(const q of ["env.XCSH_REGION","var.xcsh_region","xcsh_helper ()","description is \"xcsh_missing_fixture\"","description is \x27xcsh_missing_fixture\x27","not xcsh_missing_fixture"]){expect(parseProviderIdentity(q).providerNames).toEqual([]);expect(parseProviderIdentity(q).identities).toHaveLength(1);}expect(parseProviderIdentity("Do not use xcsh_origin_pool but find xcsh_missing_fixture resource").providerNames).toEqual(["missing_fixture"]);});
test("explicit roles exclude quotes and rejectedroles while ephemeralresource is one role",()=>{for(const q of ["xcsh_origin_pool resource not a data source","xcsh_origin_pool resource excluding data source","xcsh_origin_pool resource description is \"xcsh_missing data source\"","xcsh_origin_pool resource label is \x27data source\x27"]){expect(parseProviderIdentity(q).explicitRole).toBe("resources");}expect(parseProviderIdentity("ephemeral resource xcsh_fixture").explicitRole).toBe("ephemeral-resources");expect(parseProviderIdentity("resource or data source xcsh_fixture").conflictingRoles).toBe(true);});
test("token spans refer to original string without deleting quoted or Unicodecontent",()=>{const text="界 \"xcsh_fixture\" resource";for(const t of identityTokens(text)){expect(text.slice(t.start,t.end).toLowerCase()).toBe(t.text);}});

test("apostrophes inside a quotation do not expose quoted values as identities",()=>{expect(parseProviderIdentity("description is \"owner\x27s xcsh_missing_fixture\"").providerNames).toEqual([]);expect(parseProviderIdentity("description is \"owner\x27s data source\"; xcsh_fixture resource").explicitRole).toBe("resources");});
test("example scope ends at sentence boundary and affirmative role resumes after but",()=>{expect(parseProviderIdentity("For example xcsh_sample. Find xcsh_missing_fixture resource").providerNames).toEqual(["missing_fixture"]);expect(parseProviderIdentity("not a data source but resource xcsh_fixture").explicitRole).toBe("resources");});

test("environmentlabels and data instance syntax carry correct identity kinds androles",()=>{expect(parseProviderIdentity("Use xcsh_region environment variable").providerNames).toEqual([]);expect(parseProviderIdentity("Read data.xcsh_origin_pool.example").explicitRole).toBe("data-sources");});

test("complete malformed reference spans never truncate into valid identities",()=>{
 for(const text of ["xcsh_missing$widget","xcsh_missing/widget","xcsh_missing-widget"]){const p=parseProviderIdentity(text+" resource");expect(p.identities).toHaveLength(1);expect(p.identities[0]?.valid).toBe(false);expect(text).toContain(p.identities[0]!.name);}
});
test("nested variables and actual calls remain outside provider identity",()=>{
 for(const text of ["var.settings.xcsh_region","module.app.xcsh_region","xcsh_helper(resource)","provider::xcsh::xcsh_helper ()"]){expect(parseProviderIdentity(text).providerNames).toEqual([]);}
 expect(parseProviderIdentity("xcsh_missing_fixture (resource)").providerNames).toEqual(["missing_fixture"]);
});
test("opaque quoted spans cannot create sentence or contrast boundaries",()=>{
 for(const text of ['description is "but xcsh_unknown"','"example; xcsh_unknown"','description is "owner’s xcsh_unknown"','description is "escaped \\" quote xcsh_unknown"']){expect(parseProviderIdentity(text).providerNames).toEqual([]);}
 expect(parseProviderIdentity('description is blue and find "xcsh_unknown" resource').providerNames).toEqual(["unknown"]);
});
test("rejection binds a provider noun phrase rather than every later identifier",()=>{
 for(const text of ["do not use resource xcsh_bad","not the xcsh_bad resource"]){expect(parseProviderIdentity(text).providerNames).toEqual([]);}
 expect(parseProviderIdentity("Do not modify state for xcsh_unknown resource").providerNames).toEqual(["unknown"]);
 expect(parseProviderIdentity("resources or data sources").conflictingRoles).toBe(true);
 expect(parseProviderIdentity("data.xcsh_unknown.instance.id").explicitRole).toBe("data-sources");
});

test("prose colons preserve declared resource role over a field named action",()=>{
 expect(parseProviderIdentity("Terraform fixture resource: find the good-bot action").explicitRole).toBe("resources");
 expect(parseProviderIdentity("Terraform fixture resource: action or data source").conflictingRoles).toBe(true);
});

test("traversals retain quoted indexes and classify nested variable roots",()=>{
 expect(parseProviderIdentity('var.settings["key"].xcsh_region').providerNames).toEqual([]);
 const p=parseProviderIdentity('xcsh_unknown.instance["key"].id');expect(p.providerNames).toEqual(["unknown"]);expect(p.identities[0]?.valid).toBe(true);expect(p.identities[0]?.end).toBe('xcsh_unknown.instance["key"].id'.length);
});
test("balanced calls hide argument identities and malformed calls retain evidence",()=>{
 expect(parseProviderIdentity('xcsh_helper (resource, xcsh_unknown)').providerNames).toEqual([]);
 expect(parseProviderIdentity('xcsh_helper (nested("xcsh_unknown"), data.xcsh_fixture)').identities).toHaveLength(1);
 expect(identityTokens('xcsh_helper (nested("xcsh_unknown"), data.xcsh_fixture)')[0]?.call).toBe(true);
});
test("named malformed identities remain blocking while later value modifiers do not inherit named scope",()=>{
 for(const text of ['resource named "xcsh_unknown$widget"','resource named "xcsh_unknown/widget"']){const p=parseProviderIdentity(text);expect(p.identities[0]?.classification).toBe("provider");expect(p.identities[0]?.valid).toBe(false);}
 expect(parseProviderIdentity('resource named "xcsh_unknown" description is "xcsh_other"').providerNames).toEqual(["unknown"]);
 expect(parseProviderIdentity('do not use the resource named xcsh_bad').providerNames).toEqual([]);
 expect(parseProviderIdentity('ephemeral resources xcsh_unknown').explicitRole).toBe("ephemeral-resources");
});

test("field nouns do not manufacture provider role conflicts",()=>{
 expect(parseProviderIdentity("Find the action field on resource xcsh_fixture").explicitRole).toBe("resources");
 expect(parseProviderIdentity("Find resource or action xcsh_fixture").conflictingRoles).toBe(true);
 expect(parseProviderIdentity("Read data.xcsh_fixture fields including an action value").explicitRole).toBe("data-sources");
});

test("compound role noun phrases bind names and coordinated rejection",()=>{
 expect(parseProviderIdentity('do not use data sources named xcsh_bad').providerNames).toEqual([]);
 expect(parseProviderIdentity('not xcsh_bad or xcsh_other resource').providerNames).toEqual([]);
 expect(parseProviderIdentity('data source named "xcsh_unknown"').providerNames).toEqual(["unknown"]);
 const malformed=parseProviderIdentity('resource named "xcsh_bad');expect(malformed.providerNames).toEqual(["bad"]);expect(malformed.identities[0]?.valid).toBe(false);
 expect(parseProviderIdentity('resource xcsh_good but action xcsh_other').conflictingRoles).toBe(true);
});
test("call argument vocabulary cannot manufacture a resource role",()=>{
 expect(parseProviderIdentity('xcsh_helper(resource)').providerNames).toEqual([]);
 expect(parseProviderIdentity('xcsh_helper(resource)').explicitRole).toBeUndefined();
 expect(parseProviderIdentity('xcsh_helper(resource)').identities[0]?.end).toBe('xcsh_helper(resource)'.length);
});

test("parenthetical prose retains provider evidence instead of becoming an opaque call",()=>{
 for(const q of ["Find (for resource xcsh_unknown)","Find fields (resource xcsh_unknown)","Find resource (xcsh_unknown)"]){expect(parseProviderIdentity(q).providerNames).toEqual(["unknown"]);expect(parseProviderIdentity(q).explicitRole).toBe("resources");}
});

test("identity noun phrases bind quoted prefix and compound suffix roles",()=>{
 for(const q of ['resource "xcsh_unknown"','"xcsh_unknown" data source','resource named "XCSH_UNKNOWN"']){expect(parseProviderIdentity(q).providerNames).toEqual(["unknown"]);expect(parseProviderIdentity(q).nounPhrases[0]?.role).toBeDefined();}
 for(const q of ['description for "xcsh_unknown"','description is "xcsh_unknown" resource'])expect(parseProviderIdentity(q).providerNames).toEqual([]);
});
test("role aggregation is independent of occurrence order",()=>{
 expect(parseProviderIdentity('resource xcsh_good; action').conflictingRoles).toBe(true);
 expect(parseProviderIdentity('action; resource xcsh_good').conflictingRoles).toBe(true);
});
test("compound parenthetical roles preserve identities while calls keep complete spans",()=>{
 for(const q of ['xcsh_unknown (data source)','xcsh_unknown (ephemeral resource)'])expect(parseProviderIdentity(q).providerNames).toEqual(["unknown"]);
 const c=parseProviderIdentity('xcsh_helper ()');expect(c.identities[0]?.name).toBe("helper");expect(c.identities[0]?.classification).toBe("function");
});

test("negation scope spans noun modifiers but ends at a relation or new request",()=>{
 for(const text of ["do not use the unsupported resource xcsh_bad","not the old external data source named xcsh_bad","excluding the obsolete provider xcsh_bad"]){expect(parseProviderIdentity(text).providerNames).toEqual([]);expect(parseProviderIdentity(text).identities[0]?.polarity).toBe("rejected");}
 for(const text of ["Do not modify state for xcsh_unknown resource","Without changing state, find xcsh_unknown resource","Not this setting; inspect xcsh_unknown resource"]){expect(parseProviderIdentity(text).providerNames).toEqual(["unknown"]);}
});
test("value and request phrase ownership follows the latest governing word",()=>{
 expect(parseProviderIdentity('Find xcsh_good resource description is "xcsh_bad"').providerNames).toEqual(["good"]);
 expect(parseProviderIdentity('Description is blue and find "xcsh_unknown" resource').providerNames).toEqual(["unknown"]);
});

test("coordination starts a new provider phrase without inheriting value or negation",()=>{
 expect(parseProviderIdentity('Find resource xcsh_good with description "blue" and resource "xcsh_unknown"').providerNames).toEqual(["good","unknown"]);
 expect(parseProviderIdentity('Do not use xcsh_bad and use xcsh_unknown resource').providerNames).toEqual(["unknown"]);
 expect(parseProviderIdentity('Do not use resources of type xcsh_unknown').providerNames).toEqual([]);
 expect(parseProviderIdentity('Find resource xcsh_good with description xcsh_literal').providerNames).toEqual(["good"]);
});

test("complete role phrases bind determiners type labels and alternative rejection",()=>{
 expect(parseProviderIdentity('Find resource of type "xcsh_unknown"').providerNames).toEqual(["unknown"]);
 expect(parseProviderIdentity('Find resource xcsh_good with description blue and the resource named "xcsh_unknown"').providerNames).toEqual(["good","unknown"]);
 expect(parseProviderIdentity('Do not use resource xcsh_bad or resource xcsh_unknown').providerNames).toEqual([]);
 const ephemeral=parseProviderIdentity('Find ephemeral resource named "xcsh_unknown"');expect(ephemeral.identities[0]?.role).toBe("ephemeral-resources");expect(ephemeral.explicitRole).toBe("ephemeral-resources");
});

test("clause ownership governs role aggregation and coordinated provider phrases",()=>{
 expect(parseProviderIdentity('Do not use resource xcsh_bad and resource xcsh_unknown').providerNames).toEqual([]);
 for(const q of ['Find resource xcsh_good with description blue or the resource named "xcsh_unknown"','Find resource xcsh_good with description blue or the resource named "xcsh_unknown$widget"']){expect(parseProviderIdentity(q).identities[1]?.classification).toBe("provider");}
 expect(parseProviderIdentity('Find resource xcsh_good with description data source').explicitRole).toBe("resources");
 const reference=parseProviderIdentity('Read data.xcsh_unknown.instance');expect(reference.identities[0]?.role).toBe("data-sources");expect(reference.explicitRole).toBe("data-sources");
});

test("reference alternatives start provider phrases while verbs in values remain value content",()=>{
 const reference=parseProviderIdentity('Find resource xcsh_good with description blue or data.xcsh_unknown.instance');expect(reference.providerNames).toEqual(["good","unknown"]);expect(reference.identities[1]?.classification).toBe("provider");expect(reference.identities[1]?.role).toBe("data-sources");
 expect(parseProviderIdentity('Find resource xcsh_good with description containing the words find xcsh_literal').providerNames).toEqual(["good"]);
});
test("phrase matrix separates coordinated requests from value words across equivalent role forms",()=>{
 for(const coordination of ["and","or"]){for(const role of ["resource","data source","action","ephemeral resource"]){
 const result=parseProviderIdentity(`Find resource xcsh_good with description blue ${coordination} the ${role} named "xcsh_unknown"`);expect(result.providerNames).toEqual(["good","unknown"]);
 }}
 for(const verb of ["find","locate","read","inspect"]){expect(parseProviderIdentity(`Find resource xcsh_good with description containing ${verb} xcsh_literal`).providerNames).toEqual(["good"]);}
});

test("quoted identity-first alternatives bind all suffix roles after coordination",()=>{
 for(const conjunction of ["and","or"]){for(const role of ["resource","data source","action","ephemeral resource"]){
 const parsed=parseProviderIdentity(`Find resource xcsh_good with description blue ${conjunction} "xcsh_unknown" ${role}`);expect(parsed.providerNames).toEqual(["good","unknown"]);if(role!=="resource")expect(parsed.conflictingRoles).toBe(true);
 }}
 expect(parseProviderIdentity('Find resource xcsh_good with description blue or "xcsh_literal"').providerNames).toEqual(["good"]);
});

test("an action mentioned in a field question is not a provider-role declaration",()=>{
 expect(parseProviderIdentity("In a managed xcsh_fixture resource, which property specifies the action on detection?").explicitRole).toBe("resources");
 expect(parseProviderIdentity("Which property specifies action xcsh_fixture?").explicitRole).toBe("actions");
});

test("a field request's provider relation ends descriptive value scope",()=>{
 expect(parseProviderIdentity("Find description field for xcsh_unknown resource").providerNames).toEqual(["unknown"]);
 expect(parseProviderIdentity("Find resource xcsh_good with description xcsh_literal").providerNames).toEqual(["good"]);
});

test("role noun phrases remain separate from field actions and descriptive ephemeral names",()=>{
 expect(parseProviderIdentity("Terraform app_firewall resource: find good bot action in protection").explicitRole).toBe("resources");
 expect(parseProviderIdentity("Locate malicious bot action inside protection on an app_firewall resource").explicitRole).toBe("resources");
 expect(parseProviderIdentity("Find the token returned by the ephemeral Artifact Registry token resource").explicitRole).toBe("ephemeral-resources");
});

test("accepted identity role evidence agrees with aggregate roles for description-field relations",()=>{
 expect(parseProviderIdentity("Find description for xcsh_unknown resource").providerNames).toEqual(["unknown"]);
 const field=parseProviderIdentity("Find description field for xcsh_origin_pool data source");expect(field.identities[0]?.role).toBe("data-sources");expect(field.explicitRole).toBe("data-sources");
 expect(parseProviderIdentity("Find description field for xcsh_origin_pool resource and data source").conflictingRoles).toBe(true);
});
