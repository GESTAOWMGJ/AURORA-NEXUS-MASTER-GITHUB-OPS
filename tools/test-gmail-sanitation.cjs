const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const {fixture}=require('./fixtures/sanitation-runtime.cjs');
const result=f=>f.run().results?.[0]?.code;
test('disabled by default: no queue, mailbox or effects',()=>{
 const f=fixture();delete f.state.props.AURORA_DOCUMENT_SANITATION_CONFIG;
 assert.equal(f.run().code,'SANITATION_DISABLED');assert.equal(f.state.queue.length,1);assert.equal(f.state.searches,0);
});
test('audit, financial closing and periodic share one durable issue and receipt',()=>{
 const f=fixture();f.state.findings.push([...f.state.findings[1]]);
 for(const origin of ['DOCUMENT_AUDIT','FINANCIAL_CLOSING','PERIODIC']){assert.equal(f.run(origin).ok,true);f.restart();}
 assert.equal(f.state.sends,1);assert.equal(f.state.creates,1);assert.equal(f.state.queue.length,2);
 assert.equal(f.ledger().messageId,Object.keys(f.state.messages)[0]);assert.equal(f.state.findings[1][0],'OPEN');
});
for(const [name,mutate] of [
 ['revocation',c=>c.authorization.revoked=true],['expired grant',c=>c.authorization.expiresAt='2026-10-20T11:00:00Z'],
 ['future grant',c=>c.authorization.validFrom='2026-10-21T00:00:00Z'],['owner outside scope',c=>c.authorization.ownerIds=[]],
 ['competence outside scope',c=>c.authorization.competences=[]],['gap outside scope',c=>c.authorization.gapTypes=[]],
 ['unverified owner',c=>c.owners['schedule-owner'].verified=false],['contact tenant mismatch',c=>c.owners['schedule-owner'].orgId='tenant-b'],
 ['authority tenant mismatch',c=>c.authorization.orgId='tenant-b'],['organization not verified',c=>c.organizationVerified=false],
 ['no independent review',c=>delete c.authorization.independentReviewRef],['no MFA receipt',c=>c.authorization.mfaVerified=false],
 ['wrong actor',c=>c.executorEmail='attacker@example.invalid'],['wrong script',c=>c.scriptId='elsewhere'],
 ['wrong sheet',c=>c.spreadsheetId='elsewhere'],['history not reviewed',c=>c.historyBaseline.complete=false],
 ['recipient injection',c=>c.owners['schedule-owner'].email='a@example.invalid,b@example.invalid']]) {
 test(name+' blocks without external effects',()=>{const f=fixture(),c=f.config();mutate(c);f.setConfig(c);assert.equal(f.run().ok,false);assert.equal(f.state.sends,0);assert.equal(f.state.creates,0);});
}
test('same identifiers in separate organizations have different keys and cannot relabel state',()=>{
 const a=fixture(),b=fixture();const c=b.config();c.orgId=c.authorization.orgId=c.owners['schedule-owner'].orgId='org-b';b.setConfig(c);
 b.state.props.WMGJ_FIRESTORE_ORG_ID='org-b';const i=b.issue();i.orgId='org-b';b.setIssue(i);a.run();b.run();
 assert.notEqual(a.ledger().key,b.ledger().key);assert.equal(a.state.sends,1);assert.equal(b.state.sends,1);
 b.state.queue[1][9]=a.state.queue[1][9];assert.equal(result(b),'SANITATION_STATE_OR_DESTINATION_CONFLICT');assert.equal(b.state.sends,1);
});
test('finding from another tenant and unknown document coverage cannot be inferred away',()=>{
 for(const change of [i=>i.orgId='org-b',i=>i.coverage='UNKNOWN',i=>delete i.history,i=>delete i.evidenceRef]){
  const f=fixture(),i=f.issue();change(i);f.setIssue(i);assert.equal(f.run().ok,false);assert.equal(f.state.creates,0);
 }
});
test('previous external request is reconciled, preserves thread and suppresses a new send',()=>{
 const f=fixture(),id=f.seed(),i=f.issue();i.history.legacyMessageIds=[id];f.setIssue(i);
 assert.equal(result(f),'SENT');f.restart();assert.equal(result(f),'SENT');assert.equal(f.state.sends,0);assert.equal(f.state.creates,0);
 assert.equal(f.ledger().messageId,id);assert.equal(f.ledger().threadId,'legacy-thread');
});
test('reply with attachments requires review and never closes or re-sends the finding',()=>{
 const f=fixture(),id=f.seed(),i=f.issue();i.history.legacyMessageIds=[id];f.setIssue(i);
 f.state.messages['abcdef1122334455']={id:'abcdef1122334455',from:'owner@example.invalid',to:'operator@example.invalid',subject:'Reply',body:'partial',threadId:'legacy-thread',attachments:2};
 assert.equal(result(f),'RESPONSE_REVIEW');assert.equal(f.ledger().responses[0].attachmentCount,2);assert.equal(f.state.sends,0);assert.equal(f.state.findings[1][0],'OPEN');
});
test('unavailable historical communication is unknown coverage, not absence',()=>{
 const f=fixture(),i=f.issue();i.history.legacyMessageIds=['abcdef1234567890'];f.setIssue(i);
 assert.equal(result(f),'SANITATION_COVERAGE_OR_RUNTIME_UNKNOWN');assert.equal(f.state.creates,0);
});
test('foreign recipient in legacy history cannot suppress or authorize a send',()=>{
 const f=fixture(),id=f.seed(),i=f.issue();i.history.legacyMessageIds=[id];f.setIssue(i);f.state.messages[id].to='other@example.invalid';
 assert.equal(result(f),'SANITATION_HISTORY_MISMATCH');assert.equal(f.state.sends,0);
});
test('live concurrent invocation cannot own the same external effect',()=>{
 const f=fixture();let competing;f.hook(point=>{if(point==='send:before')competing=f.concurrent();});
 assert.equal(result(f),'SENT');assert.equal(competing.ok,false);assert.equal(f.state.sends,1);
});
for(const stage of ['search','state:DRAFT_READY','state:SEND_STARTED']) test('revocation at '+stage+' prevents send',()=>{
 const f=fixture();let revoked=false;f.hook(point=>{if(point===stage&&!revoked){revoked=true;const c=f.config();c.authorization.revoked=true;f.setConfig(c);}});
 assert.equal(f.run().ok,false);assert.equal(f.state.sends,0);
});
test('new reply during preparation suppresses dispatch',()=>{
 const f=fixture();f.hook(p=>{if(p==='state:DRAFT_READY'){
  const d=Object.values(f.state.drafts)[0];f.state.messages.abcdef1122334455={...d,id:'abcdef1122334455',from:'owner@example.invalid',to:'operator@example.invalid',draft:false};
 }});assert.equal(result(f),'RESPONSE_REVIEW');assert.equal(f.state.sends,0);
});
test('closing a finding during preparation prevents send',()=>{
 const f=fixture();f.hook(p=>{if(p==='state:DRAFT_READY')f.state.findings[1][0]='RESOLVED';});
 assert.equal(result(f),'SANITATION_FINDING_CHANGED');assert.equal(f.state.sends,0);
});
for(const point of ['draft:after','state:DRAFT_READY','send:after','state:SENT']) test('restart reconciles ambiguous failure at '+point,()=>{
 const f=fixture();f.fail(point);f.run();f.restart();f.run();f.restart();f.run();
 assert.equal(f.state.creates,1);assert.equal(f.state.sends,1);assert.equal(f.ledger().stage,'SENT');
 assert.ok(!JSON.stringify(f.state.queue).includes('private provider error'));
});
test('timeout before provider acceptance remains unknown and never blindly retries',()=>{
 const f=fixture();f.fail('send:before');assert.equal(result(f),'UNKNOWN');
 for(let i=0;i<4;i++){f.restart();assert.equal(result(f),'UNKNOWN');}
 assert.equal(f.state.sends,0);assert.equal(f.state.creates,1);
});
test('delayed provider search cannot be treated as a negative delivery proof',()=>{
 const f=fixture();f.fail('send:after');f.run();f.hide(true);f.restart();assert.equal(result(f),'UNKNOWN');assert.equal(f.state.sends,1);
 f.hide(false);f.restart();assert.equal(result(f),'SENT');assert.equal(f.state.sends,1);
});
test('changed destination after reservation blocks instead of duplicating to new contact',()=>{
 const f=fixture();f.fail('send:after');f.run();const c=f.config();c.owners['schedule-owner'].email='new@example.invalid';f.setConfig(c);
 assert.equal(result(f),'SANITATION_STATE_OR_DESTINATION_CONFLICT');assert.equal(f.state.sends,1);
});
test('edited draft cannot introduce new body, CC, BCC, recipient or attachments',()=>{
 for(const change of [d=>d.body='changed',d=>d.cc='other@example.invalid',d=>d.bcc='other@example.invalid',d=>d.to='other@example.invalid',d=>d.attachments=1]){
  const f=fixture();f.fail('state:DRAFT_READY');f.run();change(Object.values(f.state.drafts)[0]);f.restart();
  assert.equal(result(f),'SANITATION_DRAFT_CHANGED');assert.equal(f.state.sends,0);
 }
});
test('schema mismatch and duplicate queue identities fail closed',()=>{
 const f=fixture();f.state.findings[0][1]='UNMAPPED';assert.equal(f.run().code,'SANITATION_SCHEMA_MISMATCH');assert.equal(f.state.sends,0);
 const g=fixture();g.run();g.state.queue.push([...g.state.queue[1]]);assert.equal(result(g),'SANITATION_QUEUE_CONFLICT');assert.equal(g.state.sends,1);
});
test('bounded batches rotate beyond completed rows without starving the sixth issue',()=>{
 const f=fixture(),c=f.config();for(let n=1;n<=6;n++){
  const owner='owner-'+n;c.owners[owner]={...c.owners['schedule-owner'],id:owner,email:owner+'@example.invalid'};c.authorization.ownerIds.push(owner);
  const i=f.issue();i.ownerId=owner;f.state.findings.push(['OPEN',JSON.stringify(i)]);
 }f.setConfig(c);f.run();f.run();assert.equal(f.state.sends,7);
});
for(const point of ['state:DRAFT_CREATING','draft:after','state:SEND_STARTED','send:after']) test('actual process death at '+point+' keeps persisted effect identity',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-sanitation-')),file=path.join(dir,'state.json');
 try{
  const harness=path.join(__dirname,'fixtures/sanitation-runtime.cjs');
  const first=spawnSync(process.execPath,[harness,file,point]);assert.equal(first.status,73);
  for(let n=0;n<2;n++)assert.equal(spawnSync(process.execPath,[harness,file]).status,0);
  const s=JSON.parse(fs.readFileSync(file));assert.equal(s.sends,point==='state:SEND_STARTED'||point==='state:DRAFT_CREATING'?0:1);
  assert.ok(s.creates<=1);assert.equal(s.queue.length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('untagged manual correspondence after baseline blocks until mapped and reviewed',()=>{
 const f=fixture();f.seed();assert.equal(result(f),'SANITATION_UNLINKED_CORRESPONDENCE_REVIEW');assert.equal(f.state.sends,0);
 const i=f.issue();i.history.legacyMessageIds=['abcdef1234567890'];f.setIssue(i);assert.equal(result(f),'SENT');assert.equal(f.state.sends,0);
});
test('all real operational entry points invoke the same sanitation ledger',()=>{
 const vm=require('node:vm'),f=fixture(),c=f.ctx();
 for(const name of ['06_AUTOMACAO_APPSCRIPT_WMGJ.gs','33_ROTINA_INGESTAO_AUDITORIA_NF_WMGJ.gs','11_ORQUESTRADOR_GMAIL_FISCAL_FINANCEIRO_WMGJ.gs'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),c);
 for(const name of ['prepararPipelineConfiavelWMGJ_V3','processarFilaFonteCanonicaWMGJ_','executarRoboGmailDashboardWMGJ',
  'aplicarLabelGmailParaIngestaoWMGJ_','executarIndexacaoGmailOperacionalWMGJ_','auditarArquivosIndexadosOperacionalWMGJ',
  'confrontarSolicitacoesNfComAtendimentosWMGJ','notificarResumoIngestaoAuditoriaNfWMGJ_',
  'chamarIndexacaoGmailAmplaWMGJ_','chamarParserNotasFiscaisXmlWMGJ_','chamarPipelineDocumentalFinanceiroWMGJ_',
  'chamarRelatorioExecutivoSociosWMGJ_','getPlanilhaWMGJ_Orquestrador_','garantirAbaControleCiclosWMGJ_']) c[name]=()=>({ok:true});
 for(const name of ['registrarStatusAutomacaoWMGJ_','registrarLogAutomacaoWMGJ_','registrarStatusIngestaoAuditoriaNfWMGJ_',
  'registrarLogIngestaoAuditoriaNfWMGJ_','registrarEventoCicloWMGJ_','registrarResumoCicloWMGJ_','aplicarFormatacaoControleCiclosWMGJ_']) c[name]=()=>{};
 c.Logger={log(){}};c.montarIdCicloWMGJ_=()=> 'synthetic-cycle';
 assert.equal(c.executarAutomacaoOperacionalWMGJ().saneamento.results[0].code,'SENT');
 assert.equal(c.executarRotinaDiariaIngestaoAuditoriaNfWMGJ().saneamento.results[0].code,'SENT');
 const financial=c.executarCicloCompletoGmailFiscalFinanceiroWMGJ({});
 assert.equal(financial.etapas.saneamento.ok,true);assert.equal(f.state.sends,1);assert.equal(f.state.queue.length,2);
});

test('draft changed after reservation is revalidated before dispatch',()=>{
 const f=fixture();f.hook(p=>{if(p==='state:SEND_STARTED')Object.values(f.state.drafts)[0].bcc='other@example.invalid';});
 assert.equal(result(f),'SANITATION_DRAFT_CHANGED');assert.equal(f.state.sends,0);
});
