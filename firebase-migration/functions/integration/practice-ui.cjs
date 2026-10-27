// Synthetic browser integration: real page + reducer + encrypted storage, mocked
// transport and identity. This is not an authenticated HML/provider acceptance test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {chromium} = require(process.env.AURORA_PLAYWRIGHT_MODULE || 'playwright');
const {practicePage} = require('../lib/auroraPracticeView.js');
const {practiceConfirmationPage,practiceWebsite} = require('../lib/auroraPracticeWorkspaceView.js');
const {createPracticeOperations,practiceCipher} = require('../lib/auroraPracticeOperations.js');
const actor={uid:'synthetic-owner',orgId:'synthetic-practice',role:'practice_owner',mfaVerified:true,allFacilities:true,email:'owner@example.invalid',facilityIds:[],permissions:[]};
const base='organizations/'+actor.orgId,rows=new Map([[base,{active:true,profile:'PERSONALITE',environment:'HOMOLOGATION',practiceOperations:{enabled:true,dataMode:'SYNTHETIC'}}],[base+'/members/'+actor.uid,{...actor,active:true,profileVersion:1,profileState:'READY'}]]);
const keys=new Map();
const key={keyResource:'projects/synthetic-project/locations/southamerica-east1/keyRings/test/cryptoKeys/test',wrapKey:async b=>{const tag=randomBytes(32);keys.set(tag.toString('hex'),Buffer.from(b));return {ciphertext:tag};},unwrapKey:async b=>Buffer.from(keys.get(b.toString('hex')))};
let lock=Promise.resolve();
const store={transaction:async body=>{const previous=lock;let release;lock=new Promise(r=>release=r);await previous;const draft=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));try{let wrote=false;const result=await body({read:async p=>{assert.equal(wrote,false);return structuredClone(draft.get(p));},create:(p,d)=>{wrote=true;assert.equal(draft.has(p),false);draft.set(p,structuredClone(d));},update:(p,d)=>{wrote=true;assert.ok(draft.has(p));draft.set(p,{...draft.get(p),...structuredClone(d)});}});rows.clear();draft.forEach((v,k)=>rows.set(k,v));return result;}finally{release();}}};
const engine=createPracticeOperations(store,practiceCipher(()=>key));
const output=process.env.AURORA_PRACTICE_ARTIFACT_DIR;
if(!output)throw Error('Set an explicit synthetic artifact directory');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.AURORA_PRACTICE_BROWSER?{executablePath:process.env.AURORA_PRACTICE_BROWSER}:{})});
 try{
 const context=await browser.newContext({viewport:{width:1365,height:1000}}),errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!=='https://synthetic.aurora.invalid'){await route.abort();return;}
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  try{
   if(u.pathname==='/aurora-icon.svg')return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync(path.join(__dirname,'../../hosting/aurora-nexus/aurora-icon.svg'))});
   if(/^\/assets\/fonts\/(atkinson-hyperlegible-next|source-serif-4-(regular|semibold))\.woff2$/.test(u.pathname))return route.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(__dirname,'../../hosting/aurora-nexus',u.pathname))});
   if(u.pathname==='/portal')return route.fulfill({contentType:'text/html',body:practicePage(actor,'synthetic-csrf','synthetic-logout')});
   if(u.pathname==='/api/user-profiles')return json({profiles:[],currentAdminUid:actor.uid});
   if(u.pathname==='/practice-confirm')return route.fulfill({contentType:'text/html',body:practiceConfirmationPage()});
   if(u.pathname==='/api/practice-confirm'){const b=req.postDataJSON();return json(await engine.confirm(b.orgId,b.appointmentId,b.token));}
   if(u.pathname==='/api/practice'){
    if(req.method()==='GET')return json({...await engine.read(actor),orgId:actor.orgId,csrf:'synthetic-csrf'});
    const b=req.postDataJSON();
    if(b.action==='ASK')return json(await engine.answer(actor,b.question));
    if(b.action==='EXPORT_WEBSITE'){const s=await engine.read(actor);assert.equal(s.website.approvedHash,s.websiteContentHash);return json({html:practiceWebsite(s),published:false});}
    return json(await engine.mutate(actor,b));
   }
   return json({code:'NOT_FOUND'},404);
  }catch(e){return json({code:e.code||'TEST_ERROR'},e.status||503);}
 });
 const page=await context.newPage();await page.goto('https://synthetic.aurora.invalid/portal');await page.getByText('Ambiente de teste · use somente dados fictícios.',{exact:true}).waitFor();
 async function fill(action,values){const f=page.locator('[data-practice="'+action+'"]');await f.locator('..').locator('summary').click();for(const [name,value]of Object.entries(values)){const field=f.locator('[name="'+name+'"]');if(typeof value==='boolean')await field.setChecked(value);else await field.fill(value);}const response=page.waitForResponse(r=>r.url().endsWith('/api/practice')&&r.request().method()==='POST');const updated=page.waitForResponse(r=>r.url().endsWith('/api/practice')&&r.request().method()==='GET');await f.locator('button').click();const result=await response;assert.equal(result.status(),200,await result.text());await updated;await page.waitForFunction(()=>document.getElementById('p-state').textContent.startsWith('Alteração confirmada.'));}
 await fill('SAVE_BUSINESS',{name:'Consultório Sintético',profession:'Psicologia',registration:'REGISTRO-FICTICIO',publicEmail:'office@example.invalid',publicPhone:'',publicAddress:'',timezone:'America/Sao_Paulo',hours:'Segunda a sexta, 8h às 18h',cancellationPolicy:'Avise com 24 horas de antecedência.',servicesText:'Consulta | 50 | 200.00'});
 await fill('ADD_CONTACT',{name:'Contato Sintético',email:'person@example.invalid',phone:'',messageConsent:true});
 const starts=new Date(Date.now()+86400000);starts.setSeconds(0,0);
 const book=page.locator('[data-practice="BOOK"]');await book.locator('..').locator('summary').click();await book.locator('[name=startsAt]').fill(starts.toISOString().slice(0,16));await book.locator('button').click();await page.locator('#p-appointments').getByText(/Contato Sintético/).waitFor();
 await page.getByRole('button',{name:'Preparar lembrete',exact:true}).click();await page.locator('#p-drafts').getByText('Rascunho · não enviado').waitFor();
 await page.getByRole('button',{name:'Link de confirmação',exact:true}).click();await page.waitForFunction(()=>document.getElementById('p-confirm-link').textContent.includes('https://'));
 const url=(await page.locator('#p-confirm-link').textContent()).match(/https:\/\/\S+/)[0];
 const confirmation=await context.newPage();await confirmation.goto(url);assert.equal(new URL(confirmation.url()).hash,'');await confirmation.getByRole('button',{name:'Confirmar presença'}).click();await confirmation.getByText('Presença confirmada. Obrigado!').waitFor();await confirmation.close();
 await page.getByRole('button',{name:'Atualizar painel'}).click();await page.getByText('Ambiente de teste · use somente dados fictícios.',{exact:true}).waitFor();
 await fill('ADD_CHARGE',{amount:'200',dueAt:starts.toISOString().slice(0,16)});await page.locator('#p-charges').getByText(/A receber/).waitFor();
 await fill('SAVE_KNOWLEDGE',{question:'Onde estacionar?',answer:'Estacionamento na rua.'});await page.locator('#p-ask input').fill('Onde estacionar?');await page.locator('#p-ask button').click();await page.locator('#p-answer').getByText('Estacionamento na rua.').waitFor();
 await fill('SAVE_WEBSITE',{headline:'Cuidado e escuta',about:'Apresentação fictícia para homologação.',contactLabel:'Entre em contato',desiredDomain:'exemplo.com.br'});await page.getByRole('button',{name:'Aprovar apresentação'}).click();await page.getByText('Apresentação aprovada para download.').waitFor();
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar website aprovado'}).click();const download=await downloadEvent;await download.saveAs(path.join(output,'website-sintetico.html'));
 for(const size of [{width:1365,height:1000},{width:390,height:844}]){
  await page.setViewportSize(size);await page.evaluate(()=>{for(const d of document.querySelectorAll('details'))d.open=false;scrollTo({top:0,left:0,behavior:'instant'});});
  await page.waitForFunction(()=>scrollY===0);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('nav a').first().evaluate(n=>getComputedStyle(n).color),'rgb(18, 63, 54)');
  assert.ok(await page.locator('.entry-brand img').evaluate(n=>n.complete&&n.naturalWidth>0),'brand asset unavailable');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  await page.screenshot({path:path.join(output,'personalite-'+size.width+'.png')});
 }
 await context.setOffline(true);await page.getByText('Sem conexão. Últimos dados visíveis; alterações pausadas.').waitFor();assert.equal(await page.locator('#p-ask button').isDisabled(),true);await context.setOffline(false);await page.getByText('Ambiente de teste · use somente dados fictícios.',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.equal((await engine.read(actor)).appointments[0].status,'CONFIRMED');
 rows.set(base+'/members/'+actor.uid,{...rows.get(base+'/members/'+actor.uid),active:false});await page.getByRole('button',{name:'Atualizar painel'}).click();await page.waitForFunction(()=>document.getElementById('p-state').dataset.state==='error');
 assert.equal(await page.locator('#p-answer').textContent(),'');assert.equal(await page.locator('#p-confirm-link').textContent(),'');assert.equal(await page.locator('#p-appointments li').count(),0);assert.equal(await page.locator('#p-ask button').isDisabled(),true);
 const receipt={status:'PASSED',transport:'MOCKED',identity:'SYNTHETIC',storage:'IN_MEMORY_ENCRYPTED',viewports:[1365,390],checks:['business','contact','booking','reminder','confirmation','charge','knowledge','website approval/export','offline/reconnect','no overflow','no page errors','navigation contrast','brand asset','revocation clears private view']};fs.writeFileSync(path.join(output,'ui-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
