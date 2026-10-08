import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("compiled entry binds every deployable handler to the explicit runtime StringParam", () => {
  // Fresh process verifies actual SDK metadata and the production entry import order.
  // It neither invokes handlers nor resolves secrets/params nor contacts GCP.
  const script=`const entry=require('./lib/entry.js');
    const params=require('firebase-functions/params');
    console.log(JSON.stringify({handlers:Object.fromEntries(Object.entries(entry)
      .filter(([,handler])=>handler?.__endpoint)
      .map(([name,handler])=>[name,handler.__endpoint.serviceAccountEmail])),
      runtimeParam:params.declaredParams.find(param=>param.name==='AURORA_RUNTIME_SERVICE_ACCOUNT').toSpec()}));`;
  const result=spawnSync(process.execPath,["-e",script],{
    cwd:fileURLToPath(new URL("..",import.meta.url)),encoding:"utf8",timeout:15000
  });
  assert.equal(result.status,0,result.stderr);
  const metadata=JSON.parse(result.stdout.trim());
  assert.ok(Object.keys(metadata.handlers).length>=20);
  for (const [name,account] of Object.entries(metadata.handlers)) {
    assert.equal(account,"params.AURORA_RUNTIME_SERVICE_ACCOUNT",name);
  }
  assert.equal(metadata.runtimeParam.name,"AURORA_RUNTIME_SERVICE_ACCOUNT");
  assert.equal(metadata.runtimeParam.type,"string");
  assert.equal(metadata.runtimeParam.default,
    '{{ params.PROJECT_ID == "wmgj-hml-jfn-20260927" ? "299889357292-compute@developer.gserviceaccount.com" : "" }}');
  assert.equal(metadata.runtimeParam.input.text.nonEmpty,true);
});

