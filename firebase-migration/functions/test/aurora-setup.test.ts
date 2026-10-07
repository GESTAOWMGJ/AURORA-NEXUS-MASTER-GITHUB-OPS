import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPage } from '../src/auroraSetup.ts';
test('setup escapes organization identity and never exposes credential inputs',()=>{
 const html=setupPage({orgId:'<script>alert(1)</script>',mfaVerified:false});
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(!html.includes('type="password"'));
 assert.ok(html.includes('Segundo fator não confirmado'));
});
test('setup separates membership, network proof and physical installation',()=>{
 const html=setupPage({orgId:'synthetic',mfaVerified:true});
 assert.ok(html.includes('Segundo fator confirmado'));
 assert.ok(html.includes("fetch('/api/bootstrap'"));
 assert.ok(html.includes("cache:'no-store'"));
 assert.ok(html.includes('não comprova ingestão ou sincronização'));
 assert.ok(html.includes('ainda não está disponível'));
});

import {companyEntry,isCompanySlug} from '../src/auroraTenantEntry.ts';
test('setup is a reserved application route, never a tenant selector',()=>{assert.equal(companyEntry('/setup'),null);assert.equal(isCompanySlug('setup'),false);});
