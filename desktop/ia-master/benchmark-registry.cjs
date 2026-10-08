'use strict';
// Reproducible local-only benchmark. No model calls and no customer business data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const baseline = require(process.env.AURORA_BENCH_BASELINE);
const candidate = require('./knowledge-registry.cjs');
const corpusFile = process.env.AURORA_BENCH_CORPUS;
if (!corpusFile || !path.isAbsolute(corpusFile)) throw Error('EXPLICIT_CORPUS_REQUIRED');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quantile = (values, p) => [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))];
function measure(module, file, prompt, count) {
  for (let i=0;i<25;i++) module.selectKnowledge(module.loadRegistry(file), prompt);
  const timings=[]; let result;
  for (let i=0;i<count;i++) { const t=performance.now(); result=module.selectKnowledge(module.loadRegistry(file), prompt); timings.push(performance.now()-t); }
  return { iterations:count, p50Ms:quantile(timings,.5), p95Ms:quantile(timings,.95), meanMs:timings.reduce((a,b)=>a+b)/count,
    selectedIds:result.recordIds, contextBytes:Buffer.byteLength(result.context), loadedCount:module.loadRegistry(file).records.length };
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aurora-registry-benchmark-'));
try {
  const synthetic=path.join(tmp,'synthetic.json');
  const records=Array.from({length:1000},(_,i)=>({id:'SYNTH-'+String(i).padStart(4,'0'),version:'1.0.0',title:'Synthetic idempotency validation',knowledgeState:'REGISTERED',technicalState:'SPECIFIED',runtimeVerified:false,prompt:{text:'Synthetic validation with evidence and rollback.'},procedure:['Inspect synthetic fixture.','Prevent duplicate execution.'],limits:['No live business data.'],regression:{state:'NOT_RUN'},sourceRefs:['SYNTHETIC']}));
  fs.writeFileSync(synthetic,JSON.stringify({schemaVersion:'1.0.0',version:'1.0.0',classification:'INTERNAL_SANITIZED_METHODS',recordCount:1000,records}));
  const cases=[{name:'existing_sanitized_20',file:corpusFile,prompt:'KH-020 executor duplicado rotina nativa',count:300},{name:'synthetic_1000',file:synthetic,prompt:'SYNTH-0999 idempotency duplicate',count:100}];
  const results=cases.map(c=>{const old=measure(baseline,c.file,c.prompt,c.count),updated=measure(candidate,c.file,c.prompt,c.count);return {name:c.name,corpusHash:sha(c.file),baseline:old,candidate:updated,p50Speedup:old.p50Ms/updated.p50Ms};});
  const report={at:new Date().toISOString(),host:os.hostname(),node:process.version,scope:'REGISTRY_LOAD_AND_CONTEXT_SELECTION_NOT_MODEL_INFERENCE',baselineModuleHash:sha(process.env.AURORA_BENCH_BASELINE),candidateModuleHash:sha(path.join(__dirname,'knowledge-registry.cjs')),results};
  if(process.env.AURORA_BENCH_OUTPUT) fs.writeFileSync(process.env.AURORA_BENCH_OUTPUT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
