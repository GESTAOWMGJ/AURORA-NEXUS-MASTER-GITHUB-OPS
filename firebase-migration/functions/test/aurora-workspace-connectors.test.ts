import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceConnectorReadback,workspaceConnectorSection} from '../src/auroraWorkspaceConnectors.ts';
import {setupPage} from '../src/auroraSetup.ts';
import {readFileSync} from 'node:fs';
const agent=(state='CONNECTED_REPORTED',providerState='READ_CONFIRMED')=>({state,providers:[{provider:'NOTION',state:providerState,coverageLimited:true,token:'synthetic-secret',pageId:'private-page'}]});
test('first login lists both connectors pending without inheriting a ChatGPT grant',()=>{
 const statuses=workspaceConnectorReadback([]);assert.deepEqual(statuses.map(x=>[x.provider,x.state]),[['NOTION','NOT_CONFIGURED'],['SLACK','NOT_CONFIGURED']]);
 const html=setupPage({orgId:'synthetic-org',mfaVerified:true});assert.match(html,/workspace-connector-NOTION/);assert.match(html,/workspace-connector-SLACK/);assert.match(html,/Cada empresa autoriza seu próprio acesso/);
 assert.doesNotMatch(workspaceConnectorSection(),/type="password"|apiKey|access_token|onclick=/);
});
test('fresh read is reported only and cannot attest installation or synchronization',()=>{
 const status=workspaceConnectorReadback([agent()])[0]!;assert.equal(status.state,'READ_REPORTED');assert.equal(status.coverageLimited,true);
 assert.equal(status.fullSynchronizationVerified,false);assert.equal(status.physicalInstallationVerified,false);assert.equal(status.sourceMutationAllowed,false);
 assert.doesNotMatch(JSON.stringify(status),/synthetic-secret|private-page/);
});
test('revoked or stale agent never leaves a connector connected',()=>{
 assert.equal(workspaceConnectorReadback([agent('OFFLINE_OR_STALE')])[0]!.state,'STALE');
 assert.equal(workspaceConnectorReadback([agent('CONNECTED_REPORTED','CONNECTION_PENDING')])[0]!.state,'CONNECTION_PENDING');
 assert.equal(workspaceConnectorReadback([])[0]!.state,'NOT_CONFIGURED');
});
test('workspace providers use the existing authenticated report and clear on logout',()=>{
 const runtime=readFileSync(new URL('../src/auroraIntegrationRuntime.ts',import.meta.url),'utf8');assert.match(runtime,/'IMAP','NOTION','SLACK'/);assert.match(runtime,/workspaceConnectorReadback\(agents/);
 const front=readFileSync(new URL('../src/auroraFrontend.ts',import.meta.url),'utf8');assert.match(front,/function stopSessionView\(\).*workspace-connector-/);assert.match(front,/workspaceConnectorSection\(\)/);
});

test('setup readback is tenant bound and aborts on exit without provider credentials in the browser',async()=>{
 const {workspaceConnectorSetupClient}=await import('../src/auroraWorkspaceConnectors.ts');
 const {createContext,Script}=await import('node:vm');const {setImmediate}=await import('node:timers/promises');
 const nodes=new Map(['NOTION','SLACK'].map(provider=>['workspace-connector-'+provider,{textContent:''}]));const handlers=new Map();
 const calls:any[]=[];new Script(workspaceConnectorSetupClient('synthetic-org',true)).runInContext(createContext({AbortController,setTimeout:()=>1,clearTimeout(){},document:{getElementById:(id:string)=>nodes.get(id)},window:{addEventListener:(name:string,fn:()=>void)=>handlers.set(name,fn)},fetch:async(url:string,options:any)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true,orgId:'other-org',workspaceConnectors:[{provider:'NOTION',state:'READ_REPORTED'}]})}}}));
 await setImmediate();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/integration-keys');assert.doesNotMatch(JSON.stringify(calls),/Bearer|apiKey/);
 assert.match(nodes.get('workspace-connector-NOTION')!.textContent,/não reconfirmada/);handlers.get('pagehide')();assert.match(nodes.get('workspace-connector-NOTION')!.textContent,/Sessão encerrada/);
 assert.equal(workspaceConnectorSetupClient('synthetic-org',false),'');
});
