'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Worker:NativeWorker}=require('node:worker_threads');
const source=path.resolve(__dirname,'..');
test('lost backend response reaches real deadline and terminates the real disposable Node worker',async()=>{
  const workers=[],options=[];let ended;
  class WaitingWorker extends NativeWorker {
    constructor(url,settings){super(url,settings);workers.push(this);options.push(settings);ended=new Promise(resolve=>this.once('exit',resolve));}
    postMessage(){/* Deliberately withhold the synthetic request: real worker waits idle. */}
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(source,'document_pdf_node.cjs'),'utf8'),{
    __dirname:source,module,exports:module.exports,process,Uint8Array,Promise,Error,Object,Number,clearTimeout,setTimeout,
    require:name=>name==='node:worker_threads'?{Worker:WaitingWorker}:name==='./document_pdf_pins.cjs'?require('../document_pdf_pins.cjs'):require(name)
  },{filename:'document_pdf_node.cjs'});
  await assert.rejects(module.exports.extractPdfText(new Uint8Array(Buffer.from('%PDF-1.7 synthetic'))),/LIMIT_EXCEEDED/);
  await ended;assert.equal(workers.length,1);assert.equal(workers[0].threadId,-1);
  assert.deepEqual(Object.keys(options[0].env),['TZ']);assert.equal(options[0].env.TZ,'UTC');
  assert.equal(options[0].resourceLimits.maxOldGenerationSizeMb,128);assert.equal(options[0].resourceLimits.stackSizeMb,4);
});
