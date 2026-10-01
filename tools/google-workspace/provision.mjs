#!/usr/bin/env node
import process from 'node:process';
import { google } from 'googleapis';

const desiredAliases = [
  'contato@drjoaodefreitas.com.br',
  'agendamento@drjoaodefreitas.com.br',
  'financeiro@drjoaodefreitas.com.br',
  'privacidade@drjoaodefreitas.com.br',
  'admin@drjoaodefreitas.com.br',
];

const domain = process.env.WORKSPACE_DOMAIN || 'drjoaodefreitas.com.br';
const primaryEmail = process.env.WORKSPACE_PRIMARY_USER || `joao@${domain}`;
const impersonatedAdmin = process.env.GOOGLE_ADMIN_IMPERSONATE || primaryEmail;
const apply = process.argv.includes('--apply');
const offlinePlan = process.argv.includes('--offline-plan');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function loadCredentials() {
  if (process.env.GITHUB_ACTIONS === 'true') fail('Legacy Google Workspace JSON credentials are forbidden in GitHub Actions.');
  if (process.env.GOOGLE_WORKSPACE_LEGACY_JSON_BREAKGLASS !== 'true') {
    fail('Legacy DWD JSON use is disabled by default. Set GOOGLE_WORKSPACE_LEGACY_JSON_BREAKGLASS=true only for an approved local break-glass session.');
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) fail('GOOGLE_SERVICE_ACCOUNT_JSON is required.');
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      fail('GOOGLE_SERVICE_ACCOUNT_JSON is neither valid JSON nor base64 JSON.');
    }
  }
}

async function main() {
  if (offlinePlan) {
    console.log(JSON.stringify({
      step: 'offline-plan',
      domain,
      primaryEmail,
      desiredAliases,
      remoteStateQueried: false,
      mutationAllowed: false,
      legacyJsonCredentialUsed: false,
    }, null, 2));
    console.log('OFFLINE_PLAN_OK: no Google credential loaded and no remote change attempted.');
    return;
  }

  const credentials = loadCredentials();
  const scopes = [
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
    'https://www.googleapis.com/auth/admin.directory.domain.readonly',
    apply
      ? 'https://www.googleapis.com/auth/admin.directory.user.alias'
      : 'https://www.googleapis.com/auth/admin.directory.user.alias.readonly',
  ];
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    subject: impersonatedAdmin,
    scopes,
  });

  const directory = google.admin({ version: 'directory_v1', auth });

  const domainResponse = await directory.domains.get({ customer: 'my_customer', domainName: domain });
  console.log(JSON.stringify({ step: 'domain', domain: domainResponse.data.domainName, verified: domainResponse.data.verified }, null, 2));
  if (!domainResponse.data.verified) fail(`Domain ${domain} is not verified in Google Workspace.`);

  const userResponse = await directory.users.get({ userKey: primaryEmail, projection: 'basic' });
  console.log(JSON.stringify({ step: 'primary-user', primaryEmail: userResponse.data.primaryEmail, suspended: userResponse.data.suspended }, null, 2));
  if (userResponse.data.suspended) fail(`Primary user ${primaryEmail} is suspended.`);

  const aliasesResponse = await directory.users.aliases.list({ userKey: primaryEmail });
  const existing = new Set((aliasesResponse.data.aliases || []).map((item) => String(item.alias).toLowerCase()));
  const missing = desiredAliases.filter((alias) => !existing.has(alias.toLowerCase()));

  console.log(JSON.stringify({ step: 'aliases-plan', existing: [...existing].sort(), missing, mode: apply ? 'apply' : 'plan' }, null, 2));

  if (!apply) {
    console.log('PLAN_OK: no changes applied. Re-run with --apply after protected approval.');
    return;
  }

  for (const alias of missing) {
    await directory.users.aliases.insert({ userKey: primaryEmail, requestBody: { alias } });
    console.log(JSON.stringify({ step: 'alias-created', alias, primaryEmail }));
  }

  const finalResponse = await directory.users.aliases.list({ userKey: primaryEmail });
  const finalAliases = (finalResponse.data.aliases || []).map((item) => item.alias).sort();
  const stillMissing = desiredAliases.filter((alias) => !finalAliases.includes(alias));
  if (stillMissing.length) fail(`Provisioning verification failed; missing aliases: ${stillMissing.join(', ')}`);

  console.log(JSON.stringify({ ok: true, domain, primaryEmail, aliases: finalAliases }, null, 2));
}

main().catch((error) => {
  const detail = error?.response?.data || error?.message || String(error);
  console.error('PROVISIONING_FAILED');
  console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
});
