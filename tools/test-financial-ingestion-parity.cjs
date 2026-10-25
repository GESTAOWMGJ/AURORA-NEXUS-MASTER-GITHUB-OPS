'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const plain=value=>JSON.parse(JSON.stringify(value));
let validateEvent,temporary;
test.before(async()=>{
  temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-financial-policy-'));
  fs.writeFileSync(path.join(temporary,'package.json'),'{"type":"module"}');
  for(const name of ['types','policy','validation'])fs.writeFileSync(path.join(temporary,name+'.js'),
    stripTypeScriptTypes(fs.readFileSync(path.join(root,'firebase-migration/functions/src',name+'.ts'),'utf8'),{mode:'transform'}));
  ({validateEvent}=await import(pathToFileURL(path.join(temporary,'validation.js')).href));
});
test.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
function mapper(sheetName,headers,rows) {
  const events=[],logs=[];
  const context=vm.createContext({Date,Math,JSON,Object,Array,String,Number,Boolean,isFinite,
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_a,value)=>[...crypto.createHash('sha256').update(typeof value==='string'?value:Buffer.from(value)).digest()]},
    Session:{getEffectiveUser:()=>({getEmail:()=> 'owner@fixture.test'})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty(){throw Error('MUTATION_FORBIDDEN');}})}
  });
  for(const file of ['35_AURORA_FIRESTORE_BRIDGE_WMGJ.gs','36_AURORA_FIRESTORE_MIGRATION_WMGJ.gs'])vm.runInContext(fs.readFileSync(path.join(root,'src',file),'utf8'),context);
  context.wmgjFirestoreLog_=(...args)=>logs.push(args);
  context.wmgjFirestoreEnviarEventoComConfig_=event=>{events.push(plain(event));return {ok:true,accepted:false,dryRun:true};};
  const sheet={getLastRow:()=>rows.length+1,getLastColumn:()=>headers.length,getRange:(start,_col,count)=>({
    getDisplayValues:()=>start===1?[headers]:rows.slice(start-2,start-2+count),
    getValues:()=>start===1?[headers]:rows.slice(start-2,start-2+count)
  })};
  const spreadsheet={getId:()=> 'synthetic-sheet-00001',getSheetByName:name=>name===sheetName?sheet:null};
  const config=context.wmgjFirestoreMigrationMap_()[sheetName];
  const result=plain(context.wmgjFirestoreMigrarAba_(spreadsheet,sheetName,config,20,{orgId:'synthetic',dryRun:true,maxRows:20}));
  return {events,logs,result,context};
}
const invoiceHeaders=['CHAVE_ACESSO','NUMERO_NF','COMPETENCIA','STATUS_EXTRACAO','LINK_DRIVE','VALOR_SERVICO','VALOR_LIQUIDO','ISS_APURADO','SALDO_RECEBER_COMPROVADO','DESCRICAO_SERVICO','PRESTADOR_CNPJ','OBS_AUDITORIA'];
const invoiceRow=ref=>['1'.repeat(50),'12','08/2026','VALIDA_COMPLETA',ref,'100,00','95,00','5,00','0,00','PRIVATE_SERVICE_TEXT','12345678000195','PRIVATE_AUDIT_TEXT'];
const invoice=()=>mapper('06_NFS_E',invoiceHeaders,[invoiceRow('https://drive.google.com/file/d/synthetic-file-00001')]);
const validate=event=>validateEvent(event,Buffer.byteLength(JSON.stringify(event)));
test('all supported invoice origin locators pass the complete backend validator without raw source fields',()=>{
  for(const ref of ['https://drive.google.com/file/d/synthetic-file-00001','https://drive.google.com/open?id=synthetic-file-00001',
    'https://mail.google.com/mail/u/#all/abcdef1234567890','https://mail.google.com/mail/u/?authuser=owner%40fixture.test#all/abcdef1234567890',
    'GMAIL_ATTACHMENT:'+'1'.repeat(50)+'.pdf']) {
    const f=mapper('06_NFS_E',invoiceHeaders,[invoiceRow(ref)]);assert.equal(f.result.errors,0,JSON.stringify(f.logs));
    assert.equal(f.events.length,1);const event=f.events[0];assert.equal(validate(event).ok,true,JSON.stringify(validate(event).errors));
    assert.equal(event.entityKey,'06_NFS_E:'+'1'.repeat(50));assert.equal(event.competence,'2026-08');
    assert.equal(event.workflowState,'VALIDATED');assert.equal(event.record.totalCents,10000);
    assert.equal(event.record.receivableCents,null);assert.equal(event.record.reportedReceivableCents,0);
    assert.equal(event.record.financialMappingVersion,'v1.3.0-typed-financial');
    for(const privateValue of ['PRIVATE_SERVICE_TEXT','12345678000195','PRIVATE_AUDIT_TEXT','owner%40fixture.test'])assert.ok(!JSON.stringify(event).includes(privateValue));
    const raw=f.context.wmgjFirestoreRowObject_(invoiceHeaders,invoiceRow(ref));
    assert.equal(event.metadata.sourceRowHash,f.context.wmgjFirestoreHashString_(JSON.stringify(raw)));
    assert.equal(event.record.sourceRowHash,event.metadata.sourceRowHash);
  }
});
test('monthly summary, extracted movement and cash summary retain typed amounts and source identity',()=>{
  const fixtures=[
    ['05_FINANCEIRO_MENSAL',['COMPETENCIA','RECEITA_BRUTA','RECEBIDO','EM_ABERTO','DESPESA','RESULTADO'],['08/2026','100,00','0,00','100,00','10,00','90,00']],
    ['18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS',['COMPETENCIA','TIPO','VALOR','ID_DRIVE'],['08/2026','CREDITO','100,00','synthetic-file-00001']],
    ['19_RESUMO_FINANCEIRO_MENSAL',['COMPETENCIA','TOTAL_CREDITOS','TOTAL_DEBITOS','RESULTADO_LIQUIDO','VALOR_INDEFINIDO'],['08/2026','100,00','10,00','90,00','0,00']]
  ];
  for(const [name,headers,row] of fixtures){const f=mapper(name,headers,[row]);assert.equal(f.result.errors,0,JSON.stringify(f.logs));assert.equal(f.events.length,1);
    assert.equal(validate(f.events[0]).ok,true,JSON.stringify(validate(f.events[0]).errors));assert.equal(f.events[0].competence,'2026-08');
    assert.equal(f.events[0].record.aggregationRole,'CONTROL_ONLY');assert.equal(f.events[0].workflowState,'PENDING_HUMAN_REVIEW');}
});
test('the typed record rejects extra fields, untyped cents, prose and false receivable settlement',()=>{
  const mutations=[e=>e.record.description='PRIVATE',e=>e.record.totalCents='10000',e=>e.record.totalCents=1.2,
    e=>e.record.sourceReconciliationStatus='FREE TEXT',e=>e.record.sourceReconciliationStatus=['VALIDA'],
    e=>e.record.invoiceNumber='NF12',e=>e.record.receivableCents=10000,e=>e.record.fieldOrigins.totalCents.columns=['PRIVATE_SOURCE'],
    e=>e.record.originDocumentRef='https://evil.example/file',e=>e.record.financialRecordRole=['INVOICE'],
    e=>e.record.sanitized=false,e=>e.record.fieldOrigins.totalCents.extra='PRIVATE'];
  for(const change of mutations){const e=invoice().events[0];change(e);assert.equal(validate(e).ok,false);}
});
test('new fields cannot bypass generic policy by omitting the typed marker or changing their placement',()=>{
  const event=invoice().events[0];delete event.record.financialMappingVersion;assert.equal(validate(event).ok,false);
  const nested=invoice().events[0];nested.record={financial:nested.record};assert.equal(validate(nested).ok,false);
  const metadata=invoice().events[0];metadata.metadata.sourceRowHash='PRIVATE';assert.equal(validate(metadata).ok,false);
  const alias=invoice().events[0];alias.metadata.source_row_hash=alias.metadata.sourceRowHash;delete alias.metadata.sourceRowHash;assert.equal(validate(alias).ok,false);
});
test('clinical and narrative protections still reject labels, identifiers and free text',()=>{
  for(const change of [e=>e.sensitivity='CLINICAL_SENSITIVE',e=>e.record.paciente='synthetic',e=>e.record.body='private',
    e=>e.record.status='paciente: synthetic',e=>e.metadata.notes='private']){const e=invoice().events[0];change(e);assert.equal(validate(e).ok,false);}
});
function documentary() {
  const e=invoice().events[0];e.entityType='sourceDocument';e.eventType='DOCUMENT_UPSERT';e.entityKey='DRIVE:synthetic-file-00001';
  e.source={system:'DRIVE',sourceId:'synthetic-file-00001',contentHash:'a'.repeat(64),hashMethod:'content_sha256'};
  e.record={sanitized:true,extractionMethod:'google_docs_text',extractionComplete:true,nativeReady:false,
    extractionEvidence:{schemaVersion:1,contentSha256:'a'.repeat(64),textSha256:'b'.repeat(64),textLength:10,method:'google_docs_text',
      coverage:'TEXT_EXTRACTED_REVIEW_PENDING',sourceVersion:1,financialFactsApproved:false}};
  e.workflowState='PENDING_HUMAN_REVIEW';e.reviewState='PENDING';return e;
}
test('document extraction evidence passes only as exact structured hashes with matching source tuple',()=>{
  assert.equal(validate(documentary()).ok,true,JSON.stringify(validate(documentary()).errors));
  for(const change of [e=>e.record.extractionEvidence.text='private',e=>e.record.extractionEvidence.contentSha256='c'.repeat(64),
    e=>e.record.extractionEvidence.sourceVersion=2,e=>e.record.extractionEvidence.financialFactsApproved=true,
    e=>e.record.extractionEvidence.method='arbitrary narrative',e=>e.record.extractionEvidence.textLength=0,
    e=>e.record.extractionEvidence.textSha256='not-a-hash',e=>e.record.extraction_evidence=e.record.extractionEvidence]){
    const e=documentary();change(e);assert.equal(validate(e).ok,false);}
});
test('bounded source manifests are accepted only with manifest coverage and no financial approval',()=>{
  for(const method of ['google_sheets_manifest','zip_manifest']) {
    const e=documentary();
    e.record.extractionMethod=method;
    e.record.extractionEvidence.method=method;
    e.record.extractionEvidence.coverage='SOURCE_MANIFESTED_REVIEW_PENDING';
    assert.equal(validate(e).ok,true,JSON.stringify(validate(e).errors));
    for(const mutate of [
      x=>x.record.extractionEvidence.coverage='TEXT_EXTRACTED_REVIEW_PENDING',
      x=>x.record.extractionEvidence.financialFactsApproved=true,
      x=>x.record.nativeReady=true
    ]) {
      const bad=structuredClone(e);mutate(bad);assert.equal(validate(bad).ok,false);
    }
  }
});
test('text extraction methods cannot claim manifest-only coverage',()=>{
  const e=documentary();e.record.extractionEvidence.coverage='SOURCE_MANIFESTED_REVIEW_PENDING';
  assert.equal(validate(e).ok,false);
});
test('the real Drive bridge event with scoped extraction evidence passes validateEvent without schema shortcuts',()=>{
  const f=invoice(),c=f.context;
  c.wmgjFirestoreConfig_=()=>({orgId:'synthetic',dryRun:true});
  const file={getId:()=> 'synthetic-file-00001',getMimeType:()=> 'application/vnd.google-apps.document',
    getUrl:()=> 'https://drive.google.com/file/d/synthetic-file-00001/view',
    getBlob:()=>({getBytes:()=>[1,2,3,4]}),getLastUpdated:()=>new Date('2026-01-01T00:00:00.000Z')};
  const event=plain(c.wmgjFirestoreEventoArquivo_(file,{categoria:'outro',tipo_documento:'documento_extraido_pendente_revisao',
    confianca:0,competencia:null,valor_total:null,atendimentos:null,metodo_extracao:'google_docs_text',
    status:'PENDING_HUMAN_REVIEW',origem_classificacao:'aurora_drive_acquisition_v1',nivel_risco:'medio'},
  {sourceContext:'authorized-drive-full-review',sourceSystem:'DRIVE',originConnector:'DRIVE_FOLDER',mirrorRequired:true,
    sourceRegistryVersion:'1',pipelineVersion:'drive-continuation-v1'}));
  event.record.extractionEvidence={schemaVersion:1,contentSha256:event.source.contentHash,textSha256:'b'.repeat(64),
    textLength:10,method:'google_docs_text',coverage:'TEXT_EXTRACTED_REVIEW_PENDING',sourceVersion:event.sourceVersion,financialFactsApproved:false};
  assert.equal(validate(event).ok,true,JSON.stringify(validate(event).errors));
  assert.equal(event.record.nativeReady,false);assert.equal(event.reviewState,'PENDING');
});
