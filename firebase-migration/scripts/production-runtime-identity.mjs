// Inspect compiled SDK endpoint definitions only; never invoke handlers or cloud APIs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = 'wmgj-prod-jfn-20261005';
const account = `aurora-prod-runtime@${project}.iam.gserviceaccount.com`;
try {
  const content = fs.readFileSync(path.join(root, `functions/.env.${project}`), 'utf8').trim();
  assert.equal(content, `AURORA_RUNTIME_SERVICE_ACCOUNT=${account}`);
  const functions = await import(pathToFileURL(path.join(root, 'functions/lib/index.js')).href);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.production.json'), 'utf8'));
  const required = new Set(['ingestWmgjEvent', 'runtimeHealth', ...config.hosting.rewrites.map(route => route.function.functionId)]);
  for (const handler of required) {
    const endpoint = functions[handler]?.__endpoint;
    assert(endpoint, 'COMPILED_ENDPOINT_REQUIRED');
    // Firebase StringParam serializes to CEL; its project-specific value is fixed above.
    assert.equal(endpoint.serviceAccountEmail, 'params.AURORA_RUNTIME_SERVICE_ACCOUNT');
  }
  console.log(JSON.stringify({ok: true, gate: 'COMPILED_PRODUCTION_RUNTIME_IDENTITY', projectId: project, runtimeServiceAccount: account, handlers: required.size}));
} catch {
  console.error(JSON.stringify({ok: false, gate: 'COMPILED_PRODUCTION_RUNTIME_IDENTITY', code: 'APPROVED_RUNTIME_IDENTITY_NOT_PROVEN'}));
  process.exitCode = 41;
}
