'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const sensitive = text => /-----BEGIN .*PRIVATE KEY|\bBearer\s+[\w.-]+|\bsk-[a-zA-Z0-9]{12,}|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/i.test(text);
function assertInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(k => !['key', 'prompt', 'classification', 'flow'].includes(k)))
    fail('MOTOR_FIELDS_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(input.key || '')) fail('MOTOR_KEY_INVALID');
  if (!['PUBLIC', 'INTERNAL'].includes(input.classification)) fail('MOTOR_CLASSIFICATION_REJECTED');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 8 || input.prompt.length > 6000)
    fail('MOTOR_PROMPT_INVALID');
  if (!Array.isArray(input.flow) || input.flow.length > 30
      || input.flow.some(step => typeof step !== 'string' || step.length > 500))
    fail('MOTOR_FLOW_INVALID');
  // Apply the existing local server's sensitive-input boundary to every persisted field.
  const text = JSON.stringify(input);
  if (/-----BEGIN .*PRIVATE KEY|\bBearer\s+[\w.-]+|\bsk-[a-zA-Z0-9]{12,}|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/i.test(text))
    fail('MOTOR_SENSITIVE_INPUT_REJECTED');
}
function atomicWrite(file, value) {
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function runLearningCycle({ stateDir, orgId, input, request, receiptKey, now = () => new Date().toISOString() }) {
  if (!path.isAbsolute(stateDir) || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(orgId || ''))
    fail('MOTOR_IDENTITY_INVALID');
  if (typeof request !== 'function' || typeof receiptKey !== 'string' || receiptKey.length < 40)
    fail('MOTOR_AUTHENTICATED_ADAPTER_REQUIRED');
  assertInput(input);
  const identityFile = path.join(stateDir, 'organization.txt');
  if (!fs.existsSync(identityFile) || fs.readFileSync(identityFile, 'utf8').trim() !== orgId)
    fail('MOTOR_TENANT_MISMATCH');
  const inputHash = hash(JSON.stringify({ orgId, ...input }));
  const recordId = hash(orgId + '\n' + input.key);
  const directory = path.join(stateDir, 'learning', orgId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, recordId + '.json'), lock = file + '.lock';
  const readExisting = () => {
    if (!fs.existsSync(file)) return null;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (record.orgId !== orgId || record.recordId !== recordId || record.inputHash !== inputHash
        || record.learning?.orgId !== orgId || record.learning?.recordId !== recordId
        || record.learning?.inputHash !== inputHash || record.learning?.scope !== 'TENANT_PRIVATE')
      fail('MOTOR_SCOPE_OR_KEY_CONFLICT');
    const expected = crypto.createHmac('sha256', receiptKey).update(JSON.stringify(record.learning)).digest('hex');
    if (record.receipt?.authentication !== expected || record.receipt?.learningSha256 !== hash(JSON.stringify(record.learning)))
      fail('MOTOR_RECEIPT_INVALID');
    return { duplicate: true, record, file };
  };
  const existing = readExisting(); if (existing) return existing;
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') fail('MOTOR_CYCLE_IN_PROGRESS'); throw error; }
  try {
    const repeated = readExisting(); if (repeated) return repeated;
    const result = await request({ prompt: input.prompt, classification: input.classification });
    if (result?.state !== 'PROPOSAL_ONLY' || result.applied !== false
        || typeof result.proposal?.text !== 'string' || result.proposal.text.length > 50000
        || typeof result.proposalId !== 'string') fail('MOTOR_PROPOSAL_CONTRACT_INVALID');
    if (sensitive(result.proposal.text)) fail('MOTOR_SENSITIVE_OUTPUT_REJECTED');
    const learning = {
      inputHash,
      schemaVersion: 'aurora.motor.learning.v1', recordId, orgId,
      scope: 'TENANT_PRIVATE', state: 'PROPOSED', classification: input.classification,
      prompt: input.prompt, response: result.proposal.text, flow: input.flow,
      proposalId: result.proposalId, knowledge: result.knowledge || null,
      model: result.proposal.model || null, at: now(),
      applied: false, weightsTraining: false, crossTenantPromotion: false,
      cloudSyncVerified: false
    };
    const record = {
      recordId, orgId, inputHash, learning,
      receipt: { scheme: 'HMAC-SHA256-LOCAL-CONTROL',
        authentication: crypto.createHmac('sha256', receiptKey).update(JSON.stringify(learning)).digest('hex'),
        learningSha256: hash(JSON.stringify(learning)) }
    };
    atomicWrite(file, record);
    const verified = readExisting();
    return { ...verified, duplicate: false };
  } finally { fs.rmdirSync(lock); }
}
async function main() {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) fail('MOTOR_ABSOLUTE_INPUT_REQUIRED');
  const stateDir = process.env.AURORA_MASTER_STATE;
  if (!stateDir || !path.isAbsolute(stateDir)) fail('MOTOR_EXPLICIT_STATE_REQUIRED');
  const orgId = fs.readFileSync(path.join(stateDir, 'organization.txt'), 'utf8').trim();
  const receiptKey = fs.readFileSync(path.join(stateDir, 'control.key'), 'utf8').trim();
  // Bound untrusted disk input before allocating/parsing JSON.
  const inputPath = process.argv[2];
  const stat = fs.lstatSync(inputPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024)
    fail('MOTOR_INPUT_FILE_REJECTED');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  // Bind the authenticated loopback server's tenant to this local state.
  const endpoint = 'http://127.0.0.1:38765';
  const headers = { Authorization: 'Bearer ' + receiptKey, 'Content-Type': 'application/json', 'X-Aurora-Local': '1' };
  const status = await fetch(endpoint + '/api/status', {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: 'Bearer ' + receiptKey }
  });
  if (!status.ok) fail('MOTOR_SERVICE_AUTH_REJECTED');
  const service = await status.json();
  if (service?.orgId !== orgId) fail('MOTOR_SERVICE_TENANT_MISMATCH');
  const result = await runLearningCycle({ stateDir, orgId, input, receiptKey, request: async body => {
    const response = await fetch(endpoint + '/api/improve', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(190000),
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) fail('MOTOR_LOCAL_REQUEST_' + response.status);
    return response.json();
  } });
  // Never emit the private prompt, response or control credential.
  console.log(JSON.stringify({
    recordId: result.record.recordId, orgId, state: result.record.learning.state,
    duplicate: result.duplicate, receipt: result.record.receipt,
    applied: false, cloudSyncVerified: false
  }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { runLearningCycle, assertInput };
