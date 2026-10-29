import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { medicalPartnerPublicPage } from "../src/auroraMedicalPartnerView.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const assetDir = resolve(root,"hosting/aurora-nexus/arquivos/wmgj");
const manifest = JSON.parse(readFileSync(resolve(assetDir,"manifest.json"),"utf8"));
const source = medicalPartnerPublicPage();

test("AURORA-CRED-MED-001 only public, approved blank files are hosted", () => {
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.module,"AURORA-CRED-MED-001");
  assert.equal(manifest.scope,"PUBLIC_BLANK_TEMPLATES_ONLY");
  const expected = ["ficha-pre-cadastro-medico.pdf","termo-pre-credenciamento-medico.pdf","guia-pre-cadastro-medico.mp4","manifest.json"];
  assert.deepEqual(readdirSync(assetDir).sort(),expected.sort());
  assert.equal(manifest.files.length,2);
  assert.equal(manifest.videoAssets.length,1);
  assert.equal(new Set([...manifest.files,...manifest.videoAssets].map((x:any)=>x.name)).size,3);
});

test("PDFs reais com bytes íntegros, links existentes e SHA-256", () => {
  for(const item of manifest.files) {
    assert.equal(item.mimeType,"application/pdf");
    assert.match(item.name,/^[a-z-]+\.pdf$/);
    const f=resolve(assetDir,item.name), bytes=readFileSync(f);
    assert.equal(bytes.subarray(0,5).toString(),"%PDF-");
    assert.ok(bytes.includes(Buffer.from("%%EOF")));
    assert.ok(bytes.includes(Buffer.from("xref")));
    assert.equal(bytes.length,item.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),item.sha256);
    assert.ok(source.includes('/arquivos/wmgj/'+item.name));
  }
  assert.doesNotMatch(source,/sandbox:\/mnt\/data/);
});

test("MP4 real: container, H264, faststart, arquivo íntegro e link existente", () => {
  const [item] = manifest.videoAssets;
  assert.equal(item.mimeType,"video/mp4");
  assert.equal(item.streamable,true);
  const bytes=readFileSync(resolve(assetDir,item.name));
  assert.equal(bytes.subarray(4,8).toString(),"ftyp");
  const moov=bytes.indexOf(Buffer.from("moov"));
  const mdat=bytes.indexOf(Buffer.from("mdat"));
  assert.ok(moov>0 && mdat>moov,"MP4 must place moov before mdat");
  assert.ok(bytes.includes(Buffer.from("avc1")),"H264 video codec required");
  assert.ok(bytes.length>1024 && bytes.length<500000);
  assert.equal(bytes.length,item.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),item.sha256);
  assert.ok(source.includes('/arquivos/wmgj/'+item.name));
});

test("Hosting delivers proper PDF/MP4 disposition without changing AuthGate", () => {
  for(const name of ["firebase.json","firebase.production.json"]) {
    const config=JSON.parse(readFileSync(resolve(root,name),"utf8"));
    assert.equal(config.hosting.public,"hosting/aurora-nexus");
    for (const [suffix,mime] of [["pdf","application/pdf"],["mp4","video/mp4"]]) {
      const head=config.hosting.headers.find((x:any)=>x.source==="/arquivos/wmgj/*."+suffix);
      assert.ok(head,name+": missing "+suffix+" download rule");
      assert.ok(head.headers.some((x:any)=>x.key==="Content-Type"&&x.value===mime));
      assert.ok(head.headers.some((x:any)=>x.key==="Content-Disposition"&&x.value==="attachment"));
    }
    assert.ok(config.hosting.rewrites.some((x:any)=>x.source==="/wmgj/medicos"&&x.function?.functionId==="auroraNexusMedicalPartners"));
    assert.ok(config.hosting.rewrites.some((x:any)=>x.source==="**"&&x.function?.functionId==="auroraNexusAuthGate"));
    assert.ok(statSync(resolve(assetDir,"ficha-pre-cadastro-medico.pdf")).isFile());
  }
});
