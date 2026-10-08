import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { authenticatedOrganizationEnvironment } from "../src/auroraRuntimeEnvironment.ts";
import { auroraAuth, auroraDb } from "../src/firebase.ts";
import { auroraNexusBootstrap, auroraNexusNativeInsight, auroraNexusMasterEngine } from "../src/auroraRuntime.ts";

test("runtime environment never defaults an unknown or disabled organization to HML", () => {
  assert.equal(authenticatedOrganizationEnvironment({active:true, environment:"PRODUCTION"}), "PRODUCTION");
  assert.equal(authenticatedOrganizationEnvironment({active:true, environment:"HOMOLOGATION"}), "HOMOLOGATION");
  for (const value of [undefined, {active:false,environment:"PRODUCTION"}, {active:true},
    {active:true,environment:"production"}, {active:"true",environment:"HOMOLOGATION"}]) {
    assert.equal(authenticatedOrganizationEnvironment(value), "UNKNOWN");
  }
});

test("bootstrap, native insight and master label only the authenticated tenant metadata", async (t) => {
  const db:any=auroraDb, auth:any=auroraAuth, base="organizations/synthetic";
  let environment:unknown="PRODUCTION";
  const previous=process.env.AURORA_NEXUS_ALLOWED_EMAILS;
  process.env.AURORA_NEXUS_ALLOWED_EMAILS="synthetic@example.invalid";
  t.after(()=>{if(previous===undefined)delete process.env.AURORA_NEXUS_ALLOWED_EMAILS;
    else process.env.AURORA_NEXUS_ALLOWED_EMAILS=previous;});
  t.mock.method(auth,"verifySessionCookie",async()=>({uid:"synthetic-user",email:"synthetic@example.invalid",
    auroraOrgId:"synthetic",firebase:{}}));
  const stamp=Timestamp.fromDate(new Date("2026-10-08T00:00:00Z"));
  t.mock.method(db,"doc",(path:string)=>({get:async()=>{
    const value=path===base?{active:true,environment,projectionCompetence:"2026-10"}
      :path===`${base}/members/synthetic-user`?{active:true,role:"viewer",allFacilities:true,permissions:[]}
      :path===`${base}/dashboardSnapshots/current`?{orgId:"synthetic",competence:null,
        environment:"HOMOLOGATION",state:"SHADOW",generatedAt:stamp,
        nativeDataPlane:{storage:"FIRESTORE",sourceAccessDuringInference:false},
        dataQuality:{complete:true,sourcePresent:true},operations:{},audit:{},documentIntelligence:{},
        coverage:{},financial:{},financialCents:{},sources:[],alerts:[],pipeline:{}}
      :undefined;
    return {exists:value!==undefined,data:()=>value};
  }}));
  t.mock.method(db,"runTransaction",async(callback:any)=>callback({get:async(ref:any)=>ref.get()}));
  for (const [metadata, expected] of [["PRODUCTION","PRODUCTION"],["HOMOLOGATION","HOMOLOGATION"],[undefined,"UNKNOWN"]]) {
    environment=metadata;
    for (const [name, handler] of [["bootstrap",auroraNexusBootstrap],
      ["native",auroraNexusNativeInsight],["master",auroraNexusMasterEngine]] as const) {
      await t.test(`${name} ${expected}`,async()=>{
        let result:any, status=0;
        const req:any={method:"GET",query:{},get:(key:string)=>key==="cookie"?"__session=synthetic":undefined};
        const res:any={on(){return this;},set(){return this;},status(value:number){status=value;return this;},
          json(value:any){result=value;return this;}};
        await (handler as any)(req,res);
        assert.equal(status,200);assert.equal(result.environment,expected);
      });
    }
  }
});
