const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const NOW = Date.parse('2026-10-20T12:00:00Z');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(options = {}) {
  const config = { schemaVersion: 1, enabled: true, sendEnabled: true, orgId: 'synthetic-org', organizationVerified: true,
    organizationEvidenceRef: 'binding-1', spreadsheetId: 'synthetic-sheet', scriptId: 'synthetic-script', executorEmail: 'operator@example.invalid',
    historyBaseline: { complete: true, reviewRef: 'baseline-1', reviewedBy: 'reviewer', reviewedAt: '2026-10-19T12:00:00Z' },
    owners: { 'schedule-owner': { id: 'schedule-owner', orgId: 'synthetic-org', active: true, verified: true,
      email: 'owner@example.invalid', verificationRef: 'contact-1' } },
    authorization: { id: 'grant-1', orgId: 'synthetic-org', actor: 'operator@example.invalid', active: true, revoked: false,
      scope: 'DOCUMENT_SANITATION', approvalRef: 'approval-1', approvedBy: 'approver', independentReviewRef: 'review-1', mfaVerified: true,
      validFrom: '2026-10-19T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', ownerIds: ['schedule-owner'],
      gapTypes: ['DOCUMENT_MISSING','SCHEDULE_VALIDATION_MISSING','SCHEDULE_EXECUTION_UNVERIFIED'], competences: ['2026-10'] } };
  const issue = { orgId: 'synthetic-org', ownerId: 'schedule-owner', competence: '2026-10', gapType: 'SCHEDULE_VALIDATION_MISSING',
    evidenceRef: 'finding-1', coverage: 'COMPLETE', history: { reviewedBy: 'reviewer', reviewRef: 'review-1', reviewedAt: '2026-10-20T11:00:00Z', legacyMessageIds: [] } };
  let state = options.state || { props: { AURORA_DOCUMENT_SANITATION_CONFIG: JSON.stringify(config), WMGJ_FIRESTORE_ORG_ID: config.orgId },
    queue: [['DATA_ENTRADA','ORIGEM','ID_ORIGEM','NOME','TIPO','STATUS','TENTATIVAS','PROXIMA_ACAO','ULTIMO_ERRO','OBSERVACAO']],
    findings: [['STATUS','SANITATION_JSON'],['OPEN',JSON.stringify(issue)]], messages: {}, drafts: {}, sends: 0, creates: 0, searches: 0 };
  let locked = false, ctx, hook = () => {}, failAt, hidden = false;
  const persist = () => { if (options.file) fs.writeFileSync(options.file, JSON.stringify(state)); };
  const event = point => { persist(); hook(point); if (options.crash === point) process.exit(73);
    if (failAt === point) { failAt = null; throw Error('private provider error with secret-like text'); } };
  const cfg = () => JSON.parse(state.props.AURORA_DOCUMENT_SANITATION_CONFIG);
  const currentIssue = () => JSON.parse(state.findings[1][1]);
  function sheet(kind) { return { getLastRow: () => state[kind].length, getDataRange: () => ({ getValues: () => clone(state[kind]) }),
    appendRow: row => { state[kind].push(clone(row)); event('append'); },
    getRange: (row,col) => ({ getValue: () => state[kind][row-1][col-1], setValue: value => {
      state[kind][row-1][col-1] = value;
      if (kind === 'queue' && col === 10) event('state:' + JSON.parse(value).stage);
    } }) }; }
  const sheets = { '15_FILA_PROCESSAMENTO': sheet('queue'), '11_PENDENCIAS_SANEAMENTO': sheet('findings') };
  function message(m) { return { getId: () => m.id, isDraft: () => !!m.draft, getFrom: () => m.from, getTo: () => m.to,
    getDate: () => new Date(m.date || NOW), getCc: () => m.cc || '', getBcc: () => m.bcc || '', getSubject: () => m.subject, getPlainBody: () => m.body,
    getAttachments: () => Array(m.attachments || 0).fill({}), getThread: () => thread(m.threadId) }; }
  function thread(id) { return { getId: () => id, getMessages: () => Object.values(state.messages).filter(m => m.threadId === id).map(message) }; }
  function draft(d) { return { getId: () => d.id, getMessage: () => message(d), send: () => {
    event('send:before');
    state.sends++; const sent = { ...d, id: (100000000 + state.sends).toString(16), draft: false };
    state.messages[sent.id] = sent; delete state.drafts[d.id]; event('send:after'); return message(sent);
  } }; }
  function runtime() {
    let owns = false;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
    const context = vm.createContext({ Date: Clock, console,
      Session: { getEffectiveUser: () => ({ getEmail: () => 'operator@example.invalid' }) },
      ScriptApp: { getScriptId: () => 'synthetic-script' },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => state.props[k] || null,
        setProperty: (k,v) => { state.props[k]=v; event('property'); } }) },
      SpreadsheetApp: { flush: () => event('flush') },
      LockService: { getScriptLock: () => ({ hasLock: () => owns, tryLock: () => { if (locked) return false; locked=owns=true; return true; },
        releaseLock: () => { locked=owns=false; } }) },
      Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (alg,v) => [...crypto.createHash(alg).update(v).digest()] },
      getConfigWMGJ_: () => ({ SPREADSHEET_ID: 'synthetic-sheet', SHEETS: { FILA:'15_FILA_PROCESSAMENTO', PENDENCIAS:'11_PENDENCIAS_SANEAMENTO' } }),
      getPlanilha: () => ({ getId: () => 'synthetic-sheet', getSheetByName: n => sheets[n] }),
      cabecalhoFilaWMGJ_V3_: () => state.queue[0],
      GmailApp: {
        search: q => { state.searches++; event('search'); const token=q.match(/"([^"]+)"/), contact=q.match(/\{from:([^ ]+)/);
          return hidden ? [] : [...new Set(Object.values(state.messages).filter(m=>token ? m.subject.includes(token[1]) : (!contact || m.from===contact[1] || m.to===contact[1])).map(m=>m.threadId))].map(thread); },
        getMessageById: id => { event('readMessage'); if (hidden || !state.messages[id]) throw Error('unknown private message'); return message(state.messages[id]); },
        getDraft: id => { if (!state.drafts[id]) throw Error('draft not found'); return draft(state.drafts[id]); },
        getDrafts: () => Object.values(state.drafts).map(draft),
        createDraft: (to,subject,body) => { event('draft:before'); state.creates++;
          const d={ id:'draft-'+state.creates, to, subject, body, from:'operator@example.invalid', draft:true, threadId:'thread-'+state.creates };
          state.drafts[d.id]=d; event('draft:after'); return draft(d); }
      }
    });
    for (const name of ['09D_REPLAY_MENSAGEM_GMAIL_WMGJ.gs','39_AURORA_DOCUMENT_SANITATION.gs'])
      vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),context,{filename:name});
    return context;
  }
  ctx=runtime();
  return { state, config: cfg, issue: currentIssue, setConfig: c => { state.props.AURORA_DOCUMENT_SANITATION_CONFIG=JSON.stringify(c); },
    setIssue: i => {state.findings[1][1]=JSON.stringify(i);}, run: (origin='PERIODIC') => clone(ctx.executarSaneamentoDocumentalAurora_(origin)),
    ctx: () => ctx, fail: p => { failAt=p; }, hook: fn => {hook=fn;}, hide: v => {hidden=v;},
    restart: () => {ctx=runtime();}, concurrent: () => runtime().executarSaneamentoDocumentalAurora_('PERIODIC'),
    ledger: () => JSON.parse(state.queue[1][9]),
    seed: (id='abcdef1234567890') => { state.messages[id]={id,from:cfg().executorEmail,to:cfg().owners['schedule-owner'].email,
      subject:'Previously sent request',body:'Private historic request',threadId:'legacy-thread',draft:false}; return id; }, persist };
}
module.exports={fixture};
if (require.main===module) {
 const file=process.argv[2], crash=process.argv[3];
 const f=fixture({file,crash,state:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):undefined});
 f.run(); f.persist();
}
