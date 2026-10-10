import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => readFileSync(path.join(root, name), 'utf8');
const canonical = 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
const legacy = 'GESTAOWMGJ/automacao-gestao-wmgj';
const cmd = read('tools/windows/RENEW_CLASPRC_HML.cmd');
const ps = read('tools/windows/RENEW_CLASPRC_HML.ps1');
const wif = read('tools/windows/BOOTSTRAP_AURORA_PROD_WIF.ps1');
const bash = read('scripts/configurar_credenciais_appscript.sh');
const rawUrl = `https://raw.githubusercontent.com/${canonical}/main/appsscript.json`;

test('all executable defaults target the canonical repository', () => {
  assert.equal(cmd.match(/^set "REPO=(.+)"$/m)?.[1], canonical);
  assert.equal(ps.match(/^\$Repo = "(.+)"$/m)?.[1], canonical);
  assert.equal(wif.match(/\[string\]\$Repository = "([^"]+)"/)?.[1], canonical);
  assert.equal(bash.match(/^REPO="(.+)"$/m)?.[1], canonical);
  for (const source of [cmd, ps, wif, bash]) assert.ok(!source.includes(legacy));
});

test('Windows manifest download and secret writes use the same repository variable', () => {
  const cmdUrl = cmd.match(/curl\.exe -fL (\S+) -o/)?.[1];
  const psUrl = ps.match(/Invoke-WebRequest -Uri "([^"]+)"/)?.[1];
  assert.equal(cmdUrl?.replace('%REPO%', canonical), rawUrl);
  assert.equal(psUrl?.replace('$Repo', canonical), rawUrl);
  assert.match(cmd, /secret set CLASPRC_JSON --repo "%REPO%"/);
  assert.match(cmd, /issue comment 46 --repo "%REPO%"/);
  assert.match(ps, /secret set CLASPRC_JSON --repo \$Repo/);
  for (const source of [cmd, ps]) {
    assert.ok(source.indexOf('run obterStatusWMGJ') < source.indexOf('secret set CLASPRC_JSON'));
    assert.match(source, /wmgj-hml-jfn-20260927/);
    assert.match(source, /@google\/clasp@3\.4\.1/);
  }
});

function wifContract(repository = wif.match(/\[string\]\$Repository = "([^"]+)"/)?.[1]) {
  // Render only the WIF contract string assignments; never execute the cloud bootstrap.
  const workflow = wif.match(/^\$productionWorkflowRef = "([^"]+)"$/m)?.[1]
    .replaceAll('$Repository', repository);
  const condition = wif.match(/^\$attributeCondition = "([^"]+)"$/m)?.[1]
    .replaceAll('$productionWorkflowRef', workflow)
    .replaceAll('$Repository', repository).replaceAll('$Environment', 'firebase-production');
  assert.ok(workflow && condition);
  return { workflow, condition };
}

function accepts(condition, claims) {
  // Deliberately restricted to the existing conjunction of exact CEL equalities.
  // This is an offline contract test, not a Google STS/OIDC integration test.
  return condition.split(' && ').every(term => {
    const match = /^assertion\.([a-z_]+)=='([^']+)'$/.exec(term);
    assert.ok(match, `Unexpected WIF predicate: ${term}`);
    return claims[match[1]] === match[2];
  });
}

test('WIF accepts the renamed repository and rejects old name, foreign repo and mismatched claims', () => {
  const { workflow, condition } = wifContract();
  const claims = { repository: canonical, ref: 'refs/heads/main',
    environment: 'firebase-production', workflow_ref: workflow };
  assert.equal(accepts(condition, claims), true);
  for (const invalid of [
    { repository: legacy }, { repository: 'OTHER/AURORA-NEXUS-MASTER-GITHUB-OPS' },
    { ref: 'refs/heads/feature' }, { environment: 'firebase-homologation' },
    { workflow_ref: workflow.replace(canonical, legacy) },
    { workflow_ref: workflow.replace('aurora-firebase-production.yml', 'other.yml') },
    { workflow_ref: undefined },
  ]) assert.equal(accepts(condition, { ...claims, ...invalid }), false);
  assert.match(wif, /providers create-oidc[\s\S]*--attribute-condition=\$attributeCondition/);
  assert.match(wif, /providers update-oidc[\s\S]*--attribute-condition=\$attributeCondition/);
  assert.match(wif, /attribute\.environment\/\$Environment/);
  assert.match(wif, /--role="roles\/iam.workloadIdentityUser" --member=\$principal/);
  assert.match(wif, /prevent_self_review = \$true/);
});

test('explicit WIF repository override remains supported without adding a legacy trust alias', () => {
  const repository = 'EXAMPLE/authorized-client';
  const { workflow, condition } = wifContract(repository);
  assert.equal(workflow, `${repository}/.github/workflows/aurora-firebase-production.yml@refs/heads/main`);
  assert.equal(accepts(condition, { repository, ref: 'refs/heads/main',
    environment: 'firebase-production', workflow_ref: workflow }), true);
  assert.equal(condition.includes(canonical), false);
  assert.equal(condition.includes(legacy), false);
  assert.match(wif, /"repos\/\$Repository\/environments\/\$Environment"/);
  assert.equal((wif.match(/--repo \$Repository/g) || []).length, 3);
});

test('historical Apps Script provenance keeps its original marker and public response contract', () => {
  const source = read('src/99_DEPLOY_SYNC_WMGJ.gs');
  assert.ok(source.includes(`"${legacy}@main"`));
  assert.match(source, /WMGJ_DEPLOY_SYNC_MARCADOR = "2026-07-13T20:37:00-03:00"/);
  assert.match(source, /origem: WMGJ_DEPLOY_SYNC_ORIGEM/);
});

for (const failFirst of [false, true]) {
  test(`Bash CLASP writes target canonical repo; fail-first=${failFirst}`, { skip: process.platform === 'win32' }, () => {
    const temp = mkdtempSync(path.join(tmpdir(), 'aurora-clasp-contract-'));
    try {
      writeFileSync(path.join(temp, '.clasprc.json'), '{"synthetic":"NEVER_PRINT_CREDENTIAL"}');
      writeFileSync(path.join(temp, 'gh'), `#!/usr/bin/env bash\nset -eu\nprintf '%s\\n' "$*" >> "$TEST_LOG"\nif [ "$1" = secret ] && [ "$2" = set ]; then\n  cat >/dev/null\n  if [ "$TEST_FAIL" = yes ]; then exit 9; fi\nfi\n`);
      writeFileSync(path.join(temp, 'clasp'), '#!/usr/bin/env bash\nexit 99\n');
      chmodSync(path.join(temp, 'gh'), 0o700);
      chmodSync(path.join(temp, 'clasp'), 0o700);
      const result = spawnSync('bash', [path.join(root, 'scripts/configurar_credenciais_appscript.sh')], {
        encoding: 'utf8', input: 'synthetic-script-id\n', timeout: 10000,
        env: { ...process.env, HOME: temp, PATH: `${temp}:${process.env.PATH}`,
          TEST_LOG: path.join(temp, 'calls'), TEST_FAIL: failFirst ? 'yes' : 'no' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, failFirst ? 9 : 0, result.stderr);
      const calls = readFileSync(path.join(temp, 'calls'), 'utf8').trim().split('\n');
      assert.deepEqual(calls, ['auth status', `secret set APPS_SCRIPT_ID --repo ${canonical}`,
        ...(failFirst ? [] : [`secret set CLASPRC_JSON --repo ${canonical}`, `secret list --repo ${canonical}`])]);
      assert.ok(!`${result.stdout}${result.stderr}`.includes('NEVER_PRINT_CREDENTIAL'));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}

test('native Windows CMD expands the download URL from its repository assignment', { skip: process.platform !== 'win32' }, () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'aurora-cmd-contract-'));
  try {
    const assignment = cmd.match(/^set "REPO=.+"$/m)?.[0];
    const url = cmd.match(/curl\.exe -fL (\S+) -o/)?.[1];
    assert.ok(assignment && url);
    const probe = path.join(temp, 'probe.cmd');
    // Only the assignment and URL expansion run. No renewal/cloud action runs.
    writeFileSync(probe, `@echo off\r\nsetlocal EnableExtensions EnableDelayedExpansion\r\n${assignment}\r\necho ${url}\r\n`);
    const result = spawnSync('cmd.exe', ['/d', '/c', probe], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), rawUrl);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('native PowerShell parses both scripts and expands their real WIF and raw assignments', { skip: process.platform !== 'win32' }, () => {
  const code = String.raw`
    $ErrorActionPreference = 'Stop'
    function Parse([string]$file) {
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) $file), [ref]$tokens, [ref]$errors)
      if ($errors.Count) { throw ($errors | Out-String) }
      return $ast
    }
    $renew = Parse 'tools/windows/RENEW_CLASPRC_HML.ps1'
    $bootstrap = Parse 'tools/windows/BOOTSTRAP_AURORA_PROD_WIF.ps1'
    $Repository = ($bootstrap.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Repository' }).DefaultValue.SafeGetValue()
    $Environment = ($bootstrap.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Environment' }).DefaultValue.SafeGetValue()
    $repoAssignment = ($renew.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$Repo'}, $true))[0]
    $repoLiteral = @($repoAssignment.Right.FindAll({param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst]}, $true))
    if ($repoLiteral.Count -ne 1) { throw 'Expected one literal repository assignment' }
    $Repo = $repoLiteral[0].SafeGetValue()
    $url = ($renew.FindAll({param($n) $n -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $n.Extent.Text.StartsWith('"https://raw.githubusercontent.com/')}, $true))[0]
    $expandedUrl = $ExecutionContext.InvokeCommand.ExpandString($url.Extent.Text.Trim('"'))
    # Execute ONLY these side-effect-free string assignments from the parsed AST.
    foreach ($name in @('$productionWorkflowRef', '$attributeMapping', '$attributeCondition')) {
      $assignment = ($bootstrap.FindAll({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq $name}, $true))[0]
      . ([scriptblock]::Create($assignment.Extent.Text))
    }
    @{repository=$Repository; url=$expandedUrl; workflow=$productionWorkflowRef; condition=$attributeCondition} | ConvertTo-Json -Compress
  `;
  // Windows PowerShell 5.1 is the compatibility floor for the renewal helper.
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
    cwd: root, encoding: 'utf8', timeout: 20000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.repository, canonical);
  assert.equal(actual.url, rawUrl);
  assert.equal(actual.workflow, wifContract().workflow);
  assert.equal(actual.condition, wifContract().condition);
});
