'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'src');
const workflowPath = path.join(root, '.github', 'workflows', 'deploy-appscript.yml');
const automationPath = path.join(srcDir, '06_AUTOMACAO_APPSCRIPT_WMGJ.gs');
const legacyTriggerPath = path.join(srcDir, '02_AUTOMACAO_GATILHOS_WMGJ.gs');
const forbiddenStarterWorkflows = [
  path.join(root, '.github', 'workflows', 'docker-image.yml'),
  path.join(root, '.github', 'workflows', 'ios.yml')
];

const errors = [];
const warnings = [];

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, predicate));
    if (entry.isFile() && (!predicate || predicate(full))) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function collectTopLevelVars(text, fileRel) {
  const owners = [];
  let depth = 0;
  let inString = null;
  let inLineComment = false;
  let inBlockComment = false;
  let token = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      token = '';
      continue;
    }

    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      token = '';
      continue;
    }

    if (depth !== 0) {
      token = '';
      continue;
    }

    if (/[$A-Za-z0-9_]/.test(ch)) {
      token += ch;
      continue;
    }

    if (token === 'var' || token === 'let' || token === 'const') {
      let j = i;
      while (/\s/.test(text[j] || '')) j++;

      const names = [];
      let name = '';
      let localDepth = 0;

      for (; j < text.length; j++) {
        const c = text[j];
        if (c === ';' && localDepth === 0) break;

        if ((c === ',' && localDepth === 0) || c === '=') {
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
          name = '';

          if (c === '=') {
            j++;
            while (j < text.length) {
              const v = text[j];
              if ('([{'.includes(v)) localDepth++;
              if (')]}'.includes(v)) localDepth = Math.max(0, localDepth - 1);
              if ((v === ',' || v === ';') && localDepth === 0) {
                j--;
                break;
              }
              j++;
            }
          }
          continue;
        }

        if (/[$A-Za-z0-9_]/.test(c)) name += c;
        else if (!/\s/.test(c)) name = '';
      }

      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
      names.forEach(name => owners.push([name, fileRel]));
      i = j;
    }

    token = '';
  }

  return owners;
}

function auditApiSecurity(srcGsFiles) {
  const allSrc = srcGsFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const corePath = path.join(srcDir, '00_CORE_WMGJ.gs');
  const core = fs.existsSync(corePath) ? fs.readFileSync(corePath, 'utf8') : '';
  const mutableCommands = ['run', 'runWMGJ', 'operacao_total', 'gmail', 'gmail_bancario', 'organizar', 'dashboard', 'conciliar'];

  if (!core.includes('function validarAutorizacaoApiWMGJ_')) {
    errors.push('API sem validarAutorizacaoApiWMGJ_ em 00_CORE_WMGJ.gs. Comandos mutaveis precisam de token.');
  }

  if (!core.includes('WMGJ_API_TOKEN')) {
    errors.push('API sem leitura de WMGJ_API_TOKEN em ScriptProperties.');
  }

  if (!core.includes('function comandoRequerAutorizacaoApiWMGJ_')) {
    errors.push('API sem lista central de comandos mutaveis protegidos.');
  }

  if (!core.includes('API_TOKEN_AUSENTE_OU_INVALIDO')) {
    errors.push('API sem retorno padronizado para token ausente ou invalido.');
  }

  if (!core.includes('function executarComandoMutavelComTravaWMGJ_')) {
    errors.push('API sem wrapper de trava compartilhada para comandos mutaveis.');
  }

  if (!core.includes('compararSegredoTempoConstanteWMGJ_')) {
    errors.push('API sem comparacao de token por digest em tempo constante.');
  }

  mutableCommands.forEach(command => {
    if (!core.includes(command)) warnings.push('Comando mutavel esperado nao encontrado na API: ' + command);
  });

  const dangerousDirectPatterns = [
    /if\s*\(\s*comando\s*===\s*['"]run['"][\s\S]{0,160}return\s+runWMGJ\s*\(/,
    /if\s*\(\s*comando\s*===\s*['"]gmail['"][\s\S]{0,160}return\s+importarGmailWMGJ\s*\(/,
    /if\s*\(\s*comando\s*===\s*['"]organizar['"][\s\S]{0,160}return\s+organizarPastasWMGJ\s*\(/,
    /if\s*\(\s*comando\s*===\s*['"]dashboard['"][\s\S]{0,160}return\s+atualizarDashboardWMGJ\s*\(/
  ];

  if (dangerousDirectPatterns.some(pattern => pattern.test(core)) && !core.includes('comandoRequerAutorizacaoApiWMGJ_(comando)')) {
    errors.push('API parece expor comandos mutaveis diretamente sem gate de autorizacao.');
  }

  if (allSrc.includes('doPost(e)') && !core.includes('validarAutorizacaoApiWMGJ_')) {
    errors.push('doPost encontrado sem camada de autorizacao no core.');
  }
}

function formatOwners(owners) {
  const counts = new Map();
  owners.forEach(owner => counts.set(owner, (counts.get(owner) || 0) + 1));
  return Array.from(counts.entries()).map(([owner, count]) => owner + (count > 1 ? ' (' + count + 'x)' : '')).join(', ');
}

function auditConcurrencyAndTriggerSafety() {
  const automation = fs.existsSync(automationPath) ? fs.readFileSync(automationPath, 'utf8') : '';
  const legacyTriggers = fs.existsSync(legacyTriggerPath) ? fs.readFileSync(legacyTriggerPath, 'utf8') : '';
  const allSource = srcGsFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

  if (!automation.includes('function executarAutomacaoOperacionalWMGJSemTrava_')) {
    errors.push('Automacao principal sem separacao explicita entre entrypoint travado e implementacao interna.');
  }
  if (!automation.includes('return executarComTravaConcorrenciaWMGJ_(')) {
    errors.push('Automacao principal nao usa a trava de concorrencia compartilhada.');
  }
  [
    'rodarCicloCompletoGmailFiscalFinanceiroWMGJ',
    'rodarCicloCompletoGmailFiscalFinanceiroWMGJ_Teste20',
    'rodarRotinaDiariaIngestaoAuditoriaNfWMGJ',
    'executarAutomacaoWMGJBlindada',
    'executarAutomacaoWMGJBlindada_Teste20'
  ].forEach(name => {
    if (!automation.includes(name + ': true')) {
      errors.push('Gatilho paralelo antigo nao esta no inventario de remocao: ' + name);
    }
  });
  if (!legacyTriggers.includes("executarAutomacaoOperacionalWMGJ_Legado_('jobRelatorioMensalWMGJ')")) {
    errors.push('Relatorio mensal legado ainda pode executar logica paralela fora do entrypoint canonico.');
  }

  const allowedTriggerArguments = new Set(["WMGJ_FUNCAO_AUTOMACAO_PRINCIPAL", "'rodarWatchdogWMGJ'"]);
  const triggerCallPattern = /ScriptApp\.newTrigger\(\s*([^\r\n)]+)\s*\)/g;
  let match;
  while ((match = triggerCallPattern.exec(allSource)) !== null) {
    const argument = match[1].trim();
    if (!allowedTriggerArguments.has(argument)) {
      errors.push('Criacao de gatilho fora da allowlist canonica: ScriptApp.newTrigger(' + argument + ')');
    }
  }
  if (!allSource.includes('INSTALADOR_OPERACIONAL_LEGADO_DESATIVADO')) {
    errors.push('Instaladores operacionais legados nao possuem bloqueio fail-closed.');
  }

  forbiddenStarterWorkflows.forEach(file => {
    if (fs.existsSync(file)) {
      errors.push('Workflow starter sem artefato correspondente precisa ser removido: ' + rel(file));
    }
  });
}

if (!fs.existsSync(srcDir)) errors.push('Diretorio src/ nao encontrado.');

const srcGsFiles = listFiles(srcDir, file => file.endsWith('.gs')).sort();
if (!srcGsFiles.length) errors.push('Nenhum arquivo .gs encontrado em src/.');

const allGsFiles = listFiles(root, file => file.endsWith('.gs')).sort();
const nonSrcGsFiles = allGsFiles.filter(file => !rel(file).startsWith('src/'));
if (nonSrcGsFiles.length) warnings.push('Arquivos .gs fora de src/ sao legado/nao publicados: ' + nonSrcGsFiles.map(rel).join(', '));

const functionOwners = new Map();
const globalVarOwners = new Map();
const spreadsheetIdOccurrences = [];

for (const file of srcGsFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const fileRel = rel(file);
  let match;

  const functionRegex = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((match = functionRegex.exec(text)) !== null) {
    const name = match[1];
    if (!functionOwners.has(name)) functionOwners.set(name, []);
    functionOwners.get(name).push(fileRel);
  }

  for (const [name, owner] of collectTopLevelVars(text, fileRel)) {
    if (!globalVarOwners.has(name)) globalVarOwners.set(name, []);
    globalVarOwners.get(name).push(owner);
  }

  const literalRegex = /15LgI2U2dtM7vnrxFsiQMPTvBapBDg5ftgGttx7Pw0Cw/g;
  while ((match = literalRegex.exec(text)) !== null) spreadsheetIdOccurrences.push(fileRel);
}

for (const [name, owners] of functionOwners.entries()) {
  if (owners.length > 1) errors.push('Funcao duplicada em src/: ' + name + ' aparece em ' + formatOwners(owners));
}

for (const [name, owners] of globalVarOwners.entries()) {
  if (owners.length > 1) errors.push('Variavel global duplicada em src/: ' + name + ' aparece em ' + formatOwners(owners));
}

const uniqueSpreadsheetOwners = Array.from(new Set(spreadsheetIdOccurrences));
if (uniqueSpreadsheetOwners.length > 1) {
  errors.push('ID da planilha mestre aparece em multiplos arquivos src/: ' + uniqueSpreadsheetOwners.join(', ') + '. Use getConfigWMGJ_().SPREADSHEET_ID como fonte unica.');
}

auditApiSecurity(srcGsFiles);
auditConcurrencyAndTriggerSafety();

if (fs.existsSync(workflowPath)) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const commandLines = workflow.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('cp '));
  if (!commandLines.includes('cp src/*.gs build-appscript/')) errors.push('Workflow nao copia src/*.gs para build-appscript/.');
  if (commandLines.some(line => line.includes('apps-script') || line.includes('appsscript/'))) {
    errors.push('Workflow tenta copiar apps-script/appsscript. Essas pastas sao legado.');
  }
  if (!workflow.includes('node tools/audit-appscript.js')) errors.push('Workflow nao executa tools/audit-appscript.js antes do deploy.');
  if (!workflow.includes('group: deploy-appscript-wmgj') || !workflow.includes('cancel-in-progress: false')) {
    errors.push('Workflow de deploy nao serializa publicacoes concorrentes.');
  }
  if (!workflow.includes('run_runtime_diagnostics:') || !workflow.includes('inputs.run_runtime_diagnostics')) {
    errors.push('Diagnosticos de runtime do deploy nao possuem gate manual explicito.');
  }
  if (workflow.includes('rodarCicloCompletoGmailFiscalFinanceiroWMGJ') || workflow.includes('rodarRoboGmailDashboardWMGJ_Teste20')) {
    errors.push('Workflow de deploy executa ciclo operacional; deploy de codigo nao deve ingerir ou reprocessar dados.');
  }
  if (workflow.includes('run: clasp run instalarGatilhoAutomacaoWMGJ') && !workflow.includes("github.event_name == 'workflow_dispatch'")) {
    errors.push('Workflow reinstala gatilho sem gate manual explicito.');
  }
}

console.log('AUDITORIA_APPSCRIPT_WMGJ');
console.log(JSON.stringify({ ok: errors.length === 0, srcFiles: srcGsFiles.map(rel), legacyGsFiles: nonSrcGsFiles.map(rel), warnings, errors }, null, 2));

if (warnings.length) console.warn('WARNINGS:\n' + warnings.map(w => '- ' + w).join('\n'));
if (errors.length) {
  console.error('ERROS:\n' + errors.map(e => '- ' + e).join('\n'));
  process.exit(1);
}
