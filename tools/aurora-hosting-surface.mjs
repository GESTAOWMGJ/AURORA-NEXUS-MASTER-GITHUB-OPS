/** Exact Hosting -> deployed-function closure. No credentials or cloud mutations. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const regionPattern = /^[a-z]+-[a-z]+[0-9]+$/;
function object(v) {return v !== null && typeof v === 'object' && !Array.isArray(v);}
export function requirements(config) {
  if (!object(config) || !object(config.hosting) || !Array.isArray(config.hosting.rewrites)) throw new Error('Single explicit Hosting configuration required');
  const map = new Map();
  for (const rule of config.hosting.rewrites) {
    if (!object(rule)) throw new Error('Invalid rewrite');
    if (!Object.hasOwn(rule, 'function')) continue;
    const f = rule.function;
    if (!object(f) || !idPattern.test(f.functionId ?? '') || !regionPattern.test(f.region ?? '')) throw new Error('Explicit functionId and region required');
    const existing = map.get(f.functionId);
    if (existing && existing.region !== f.region) throw new Error('Conflicting regions');
    map.set(f.functionId, {id: f.functionId, region: f.region});
  }
  if (!map.size) throw new Error('No function-backed routes');
  return [...map.values()].sort((a,b) => a.id.localeCompare(b.id));
}
export function deployedFunctions(payload) {
  if (object(payload) && payload.status && payload.status !== 'success') throw new Error('Cloud listing failed');
  const rows = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(rows)) throw new Error('Expected Firebase CLI result array');
  const map = new Map();
  for (const row of rows) {
    if (!object(row)) throw new Error('Invalid function record');
    let id = row.id, region = row.region;
    const named = typeof row.name === 'string' && row.name.match(/^projects\/[^/]+\/locations\/([^/]+)\/functions\/([^/]+)$/);
    if (named) {
      if ((id && id !== named[2]) || (region && region !== named[1])) throw new Error('Conflicting function identity');
      id = named[2]; region = named[1];
    }
    if (typeof id !== 'string' || typeof region !== 'string' || !idPattern.test(id) || !regionPattern.test(region)) throw new Error('Missing exact deployed identity');
    const key = `${id}@${region}`;
    if (map.has(key)) throw new Error('Duplicate deployed identity');
    map.set(key, {id, region, active: row.state === undefined || row.state === 'ACTIVE'});
  }
  return map;
}
export function assess(config, payload) {
  const required = requirements(config), deployed = deployedFunctions(payload);
  const missing = required.filter(f => !deployed.get(`${f.id}@${f.region}`)?.active);
  return {schemaVersion:1, gate:'HOSTING_FUNCTION_CLOSURE', ok:missing.length === 0, required, requiredCount:required.length, deployedCount:deployed.size, missing, productionMutation:false};
}
export function targets(config) {return requirements(config).map(f => `functions:${f.id}`).join(',');}
function json(path) {
  if (fs.statSync(path).size > 2_000_000) throw new Error('Input too large');
  return JSON.parse(fs.readFileSync(path, 'utf8').replace(/^\uFEFF/,''));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, configFile, deployedFile, ...extra] = process.argv.slice(2);
    if (extra.length || !configFile) throw new Error('Usage: targets CONFIG | check CONFIG FUNCTIONS');
    if (command === 'targets' && !deployedFile) console.log(targets(json(configFile)));
    else if (command === 'check' && deployedFile) {
      const result = assess(json(configFile),json(deployedFile));
      console.log(JSON.stringify(result,null,2)); if (!result.ok) process.exitCode=1;
    } else throw new Error('Invalid command');
  } catch (error) {console.error(JSON.stringify({gate:'HOSTING_FUNCTION_CLOSURE_INVALID',ok:false,error:error.message})); process.exitCode=2;}
}
