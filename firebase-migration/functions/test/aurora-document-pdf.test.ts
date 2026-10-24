import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDocumentIntakeEngine } from '../src/auroraDocumentIntakeCore.js';
import { PDF_TEXT_ASSETS } from '../src/auroraDocumentPdfAssets.js';
import { mapDocumentFactCandidates } from '../src/auroraDocumentFactMapping.js';
const require=createRequire(import.meta.url);
const {extractPdfText}=require('../../../aurora-coletor/document_pdf_node.cjs');

/** Small actual PDF with xref, pages and a standard font; no parser mock. */
export function syntheticPdf(texts:string[],imageOnly=false):Uint8Array {
  const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const children:number[]=[];
  for(const text of texts){
    const page=objects.length+1,content=page+1;children.push(page);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 3 0 R >> ${imageOnly?`/XObject << /Im0 ${page+2} 0 R >>`:''} >> /Contents ${content} 0 R >>`);
    const literal=text.replace(/[\\()]/g,'\\$&').replace(/[\u0080-\u00ff]/g,char=>'\\'+char.charCodeAt(0).toString(8).padStart(3,'0'));
    const stream=imageOnly?'q 20 0 0 20 0 0 cm /Im0 Do Q':`BT /F1 12 Tf 20 300 Td (${literal}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    if(imageOnly)objects.push('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nRGB\nendstream');
  }
  objects[1]=`<< /Type /Pages /Kids [${children.map(id=>id+' 0 R').join(' ')}] /Count ${texts.length} >>`;
  let pdf='%PDF-1.7\n',offsets=[0];
  for(const [index,body]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${body}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
const engine=createDocumentIntakeEngine();
test('real official PDF.js text import works in isolated Node worker without optional canvas/Wasm or network',async()=>{
  const bytes=syntheticPdf(['Aurora synthetic invoice text','Second page text']);
  const result=await engine.extract(bytes,'application/pdf',{extractPdfText});
  assert.equal(result.extraction.status,'PARTIAL');assert.equal(result.extraction.method,'PDF_TEXT');
  assert.equal(result.extraction.coverage.totalUnits,2);assert.equal(result.extraction.coverage.processedUnits,2);
  assert.match(result.text,/Aurora synthetic invoice text/);assert.match(result.text,/Second page text/);
  assert.equal(result.extraction.textSha256,createHash('sha256').update(result.text).digest('hex'));
  assert.deepEqual(mapDocumentFactCandidates(result).candidates,[]);
});
test('nontext PDF remains pending for OCR, with no invented text or complete page claim',async()=>{
  const result=await engine.extract(syntheticPdf([''],true),'application/pdf',{extractPdfText});
  assert.equal(result.extraction.status,'PENDING');assert.equal(result.extraction.code,'BACKEND_REQUIRED');
  assert.equal(result.text,'');assert.equal(result.extraction.textSha256,null);
});
test('real PDF WinAnsi text retains Portuguese accents as normalized Unicode',async()=>{
  const result=await engine.extract(syntheticPdf(['Gestão Café']),'application/pdf',{extractPdfText});
  assert.equal(result.extraction.status,'PARTIAL');assert.match(result.text,/Gestão Café/);
});
test('bounded PDF page budget fails closed before extracting text',async()=>{
  const result=await engine.extract(syntheticPdf(Array(33).fill('small')),'application/pdf',{extractPdfText});
  assert.equal(result.extraction.code,'LIMIT_EXCEEDED');assert.equal(result.text,'');assert.deepEqual(result.segments,[]);
});
test('malformed PDF returns a sanitized failure with no raw diagnostic',async()=>{
  const result=await engine.extract(Buffer.from('%PDF-1.7\nprivate-synthetic-error'),'application/pdf',{extractPdfText});
  assert.equal(result.extraction.status,'FAILED');assert.equal(result.extraction.code,'MALFORMED_DOCUMENT');
  assert.equal(JSON.stringify(result.extraction).includes('private-synthetic'),false);
});
test('password-protected actual PDF remains failed without prompting, guessing or exposing a password',async()=>{
  const raw=await readFile(new URL('./fixtures/document-intake/password-synthetic.pdf',import.meta.url));
  const result=await engine.extract(raw,'application/pdf',{extractPdfText});
  assert.equal(result.extraction.code,'ENCRYPTED_DOCUMENT');assert.equal(result.text,'');assert.equal(result.extraction.textSha256,null);
});
test('PDF adapter output is bounded and cannot promote total representation coverage',async()=>{
  const result=await engine.extract(syntheticPdf(['small']),'application/pdf',{extractPdfText:async()=>({schemaVersion:'aurora.pdf.text.result.v1',pages:1,
    segments:[{locator:'pdf/page[1]/item[1]',text:'a'.repeat(262145)}]})});
  assert.equal(result.extraction.status,'FAILED');assert.equal(result.text,'');
});
test('fixed PDF profile matches browser/Node bytes and retains complete upstream fonts/CMaps and notices',async()=>{
  for(const [name,pin]of Object.entries(PDF_TEXT_ASSETS.files)){
    const node=await readFile(new URL('../../../aurora-coletor/'+name,import.meta.url));
    const browser=await readFile(new URL('../../hosting/aurora-nexus/assets/document-intake/'+name,import.meta.url));
    assert.equal(node.length,pin.size);assert.equal(createHash('sha256').update(node).digest('hex'),pin.sha256);assert.deepEqual(node,browser);
  }
  const vendor=JSON.parse(await readFile(new URL('../../../aurora-coletor/document_pdf_vendor.json',import.meta.url),'utf8'));
  assert.equal(vendor.dataEntries.length,185);assert.equal(vendor.optionalCanvasRequired,false);assert.equal(vendor.wasmEnabled,false);
  assert.equal(vendor.runtimeDependencies.length,0);
});
