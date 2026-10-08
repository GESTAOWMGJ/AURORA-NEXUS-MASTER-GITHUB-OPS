'use strict';

const codes = new Set([
  'AURORA_CONNECTOR_STATUS_PENDING', 'AURORA_CONNECTOR_STATUS_TENANT_INVALID',
  'AURORA_CONNECTOR_STATUS_TENANT_MISMATCH', 'AURORA_CONNECTOR_STATUS_CONFIG_READ_FAILED',
  'AURORA_CONNECTOR_STATUS_REGISTRY_INVALID', 'AURORA_CONNECTOR_STATUS_SOURCE_ACCESS_UNAVAILABLE',
  'AURORA_CONNECTOR_STATUS_TRIGGER_READ_FAILED', 'AURORA_CONNECTOR_STATUS_READ_COMPLETE'
]);
const flags = ['ok', 'tenantConfigured', 'tenantMatches', 'configurationRead', 'configurationValid',
  'endpointConfigured', 'hmacConfigured', 'mirrorRequired', 'dryRun', 'registryConfigured',
  'registryValid', 'legacySourceSelected', 'sourceAccessChecked', 'triggerRead',
  'firstIngestionVerified', 'operationalReady'];
const handlers = ['operational', 'legacyQueue', 'fiscal', 'watchdog', 'other'];
const reject = () => { throw new Error('AURORA_CONNECTOR_STATUS_OUTPUT_REJECTED'); };
const count = (value, max) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= max);

function sanitizeConnectorStatus(envelope) {
  const value = envelope?.response;
  if (envelope?.error != null || !value || typeof value !== 'object' || Array.isArray(value) || !codes.has(value.code)) reject();
  if (!flags.every(key => typeof value[key] === 'boolean')) reject();
  if (value.firstIngestionVerified || value.operationalReady
    || value.ok !== (value.code === 'AURORA_CONNECTOR_STATUS_READ_COMPLETE')) reject();
  if (!count(value.sourceCount, 12) || !count(value.reachableSourceCount, 12)
    || !count(value.triggerCount, 100) || !value.handlerCounts || Array.isArray(value.handlerCounts)
    || !handlers.every(key => count(value.handlerCounts[key], 100))) reject();
  if ((value.registryValid && value.sourceCount === null) || (!value.registryValid && value.sourceCount !== null)) reject();
  if (value.sourceAccessChecked ? (value.reachableSourceCount === null || value.sourceCount === null
    || value.reachableSourceCount > value.sourceCount) : value.reachableSourceCount !== null) reject();
  if (value.triggerRead ? (value.triggerCount === null || handlers.some(key => value.handlerCounts[key] === null)
    || handlers.reduce((sum, key) => sum + value.handlerCounts[key], 0) !== value.triggerCount)
    : (value.triggerCount !== null || handlers.some(key => value.handlerCounts[key] !== null))) reject();
  if (!value.tenantMatches && (value.configurationRead || value.registryValid || value.sourceAccessChecked || value.triggerRead)) reject();
  if (value.configurationValid && (!value.configurationRead || !value.tenantMatches
    || !value.endpointConfigured || !value.hmacConfigured)) reject();
  return Object.fromEntries([
    ['code', value.code], ...flags.map(key => [key, value[key]]),
    ['sourceCount', value.sourceCount], ['reachableSourceCount', value.reachableSourceCount],
    ['triggerCount', value.triggerCount],
    ['handlerCounts', Object.fromEntries(handlers.map(key => [key, value.handlerCounts[key]]))]
  ]);
}

module.exports = {sanitizeConnectorStatus};
if (require.main === module) {
  try {
    const fs = require('node:fs');
    if (process.argv.length !== 3 || fs.statSync(process.argv[2]).size > 65536) reject();
    const safe = sanitizeConnectorStatus(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(safe) + '\n');
  } catch {
    process.stderr.write('AURORA_CONNECTOR_STATUS_OUTPUT_REJECTED\n');
    process.exitCode = 1;
  }
}
