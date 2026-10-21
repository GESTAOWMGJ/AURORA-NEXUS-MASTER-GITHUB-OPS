// Synthetic transaction double around the REAL projection writer. No production datastore.
const fs = require('node:fs');
const { auroraDb } = require('../../src/firebase.ts');
const { refreshProjection } = require('../../src/auroraRuntime.ts');
const f = require('./invoice-advance.cjs')();
const filename = process.argv[2], mode = process.argv[3], base = `organizations/${f.orgId}`;
const sources = { ...f.source, glosses: [], auditFindings: [], actionItems: [] };
const snapshot = (value, id) => ({ exists: value !== undefined, id, data: () => value });
let state = JSON.parse(fs.readFileSync(filename, 'utf8'));
auroraDb.doc = path => ({ path });
auroraDb.collection = path => ({ limit: n => ({ collection: path, limit: n }) });
const pause = async stage => {
  if (mode !== stage) return;
  process.send({ stage });
  await new Promise(() => { process.on('message', () => {}); });
};
auroraDb.runTransaction = async callback => {
  const writes = [];
  const result = await callback({
    get: async ref => {
      if (ref.path === base) return snapshot({ active: true, projectionEnabled: true, projectionMode: 'SHADOW', projectionCompetence: f.competence });
      if (ref.path) { if (!ref.path.startsWith(base + '/')) throw Error('TENANT_ESCAPE'); return snapshot(state[ref.path]); }
      if (!ref.collection.startsWith(base + '/') || ref.limit !== 1001) throw Error('SOURCE_SCOPE');
      const records = sources[ref.collection.slice(base.length + 1)];
      if (!records) throw Error('UNKNOWN_SOURCE');
      return { size: records.length, docs: records.map(r => snapshot(r, r._documentId)) };
    },
    set: (ref, data) => { if (!ref.path.startsWith(base + '/dashboardSnapshots/')) throw Error('FINANCIAL_WRITE'); writes.push([ref.path, data]); },
    create: (ref, data) => {
      if (!ref.path.startsWith(base + '/dashboardSnapshotHistory/') && !ref.path.startsWith(base + '/auditEvents/')) throw Error('FINANCIAL_WRITE');
      if (state[ref.path]) throw Error('DUPLICATE_EFFECT'); writes.push([ref.path, data]);
    }
  });
  await pause('before-commit');
  state = { ...state, ...Object.fromEntries(writes) };
  fs.writeFileSync(filename + '.next', JSON.stringify(state)); fs.renameSync(filename + '.next', filename);
  await pause('after-commit');
  return result;
};
refreshProjection(f.orgId, { uid: 'synthetic-integration', role: 'system', source: 'INTEGRATION' })
  .then(r => { process.send({ stage: 'done', receipt: r.invoiceAdvanceReconciliation }); process.exit(0); })
  .catch(error => { console.error(error.message); process.exit(1); });
