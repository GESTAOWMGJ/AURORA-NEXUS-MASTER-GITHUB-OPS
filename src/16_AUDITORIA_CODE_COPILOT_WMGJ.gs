/**
 * Melhorias operacionais WMGJ conforme plano de auditoria Code Copilot.
 *
 * Este módulo adiciona:
 * - modelo padronizado de escala em 07_ESCALA;
 * - produtividade médica agregada em 03_PRODUTIVIDADE_MEDICO;
 * - conferência de produtividade médico x unidade;
 * - completude mensal de escala, NFS-e e extrato;
 * - conciliação NFS-e x extrato Bradesco;
 * - validações básicas de CNPJ, competência, datas e valores;
 * - notificações por e-mail e logs operacionais.
 */

var WMGJ_AUDITORIA_CODE_COPILOT = {
  ESCALA: '07_ESCALA',
  PROD_MEDICO: '03_PRODUTIVIDADE_MEDICO',
  EXTRATOS: '08_EXTRATOS_BRADESCO',
  PROD_UNIDADE: '02_PRODUTIVIDADE_MENSAL',
  FINANCEIRO: '05_FINANCEIRO_MENSAL',
  NFSE: '06_NFS_E',
  PENDENCIAS: '11_PENDENCIAS_SANEAMENTO',
  LOG: '10_LOG_AUTOMACAO',
  OPERADOR_PADRAO: 'joao@example.com'
};

function executarMelhoriasAuditoriaCodeCopilotWMGJ(competencia) {
  var comp = competencia || obterCompetenciaAtualWMGJ_();
  garantirEstruturaAuditoriaCodeCopilotWMGJ();

  var resultados = [];
  resultados.push(calcularProdutividadeIndividualWMGJ(comp));
  resultados.push(verificarCompletudeMensalWMGJ(comp));
  resultados.push(conciliarFinanceiroAuditoriaWMGJ(comp));

  registrarLogWMGJ_('OK', 'auditoria_code_copilot', 'AppsScript', 'Melhorias executadas para ' + comp);
  return {
    ok: resultados.every(function(r) { return r && r.ok !== false; }),
    etapa: 'executarMelhoriasAuditoriaCodeCopilotWMGJ',
    competencia: comp,
    resultados: resultados,
    atualizadoEm: new Date().toISOString()
  };
}

function garantirEstruturaAuditoriaCodeCopilotWMGJ() {
  var ss = getPlanilha();

  obterOuCriarAba_(ss, WMGJ_AUDITORIA_CODE_COPILOT.ESCALA, [
    'COMPETENCIA', 'DATA', 'MEDICO', 'UNIDADE', 'ESPECIALIDADE', 'ATENDIMENTOS_DIARIOS',
    'FONTE_ARQUIVO', 'HASH_REGISTRO', 'VALIDACAO', 'IMPORTADO_EM'
  ]);

  obterOuCriarAba_(ss, WMGJ_AUDITORIA_CODE_COPILOT.PROD_MEDICO, [
    'CHAVE', 'COMPETENCIA', 'MEDICO', 'UNIDADE', 'ESPECIALIDADE', 'ATENDIMENTOS',
    'VALIDACAO', 'ULTIMA_ATUALIZACAO'
  ]);

  obterOuCriarAba_(ss, WMGJ_AUDITORIA_CODE_COPILOT.EXTRATOS, [
    'COMPETENCIA', 'DATA', 'HISTORICO', 'VALOR', 'DOCUMENTO', 'ORIGEM_ARQUIVO',
    'HASH_REGISTRO', 'IMPORTADO_EM'
  ]);

  registrarLogWMGJ_('OK', 'garantirEstruturaAuditoriaCodeCopilotWMGJ', 'AppsScript', 'Abas de auditoria garantidas');
  return { ok: true, etapa: 'garantirEstruturaAuditoriaCodeCopilotWMGJ' };
}

function processarEscalaWMGJ(conteudoCsv, competencia, nomeArquivo) {
  garantirEstruturaAuditoriaCodeCopilotWMGJ();

  var comp = validarCompetenciaWMGJ_(competencia || obterCompetenciaAtualWMGJ_());
  var ss = getPlanilha();
  var escala = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.ESCALA);
  var prodMedico = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.PROD_MEDICO);
  var linhas = Utilities.parseCsv(conteudoCsv || '');
  var importadas = 0;
  var rejeitadas = 0;

  linhas.slice(1).forEach(function(row) {
    var data = normalizarDataWMGJ_(row[0]);
    var medico = limparTextoWMGJ_(row[1]);
    var unidade = limparTextoWMGJ_(row[2]);
    var especialidade = limparTextoWMGJ_(row[3]);
    var atendimentos = normalizarNumeroWMGJ_(row[4]);
    var validacao = validarLinhaEscalaWMGJ_(data, medico, unidade, especialidade, atendimentos);
    var hash = gerarHashWMGJ_([comp, data, medico, unidade, especialidade, atendimentos, nomeArquivo].join('|'));

    if (validacao !== 'OK') {
      rejeitadas++;
      registrarPendenciaAuditoriaWMGJ_(comp, 'ESCALA_INVALIDA', nomeArquivo || '', validacao);
    }

    escala.appendRow([
      comp, data, medico, unidade, especialidade, atendimentos,
      nomeArquivo || '', hash, validacao, new Date()
    ]);

    if (validacao === 'OK') {
      atualizarProdutividadeMedicoWMGJ_(prodMedico, comp, medico, unidade, especialidade, atendimentos);
      importadas++;
    }
  });

  registrarLogWMGJ_('OK', 'processarEscalaWMGJ', 'AppsScript', 'Importadas: ' + importadas + '; rejeitadas: ' + rejeitadas);
  return { ok: true, etapa: 'processarEscalaWMGJ', competencia: comp, importadas: importadas, rejeitadas: rejeitadas };
}

function atualizarProdutividadeMedicoWMGJ_(sheet, comp, medico, unidade, especialidade, atendimentos) {
  var chave = [comp, medico, unidade, especialidade].join('|');
  var dados = sheet.getDataRange().getValues();

  for (var i = 1; i < dados.length; i++) {
    if (dados[i][0] === chave) {
      sheet.getRange(i + 1, 6).setValue((Number(dados[i][5]) || 0) + atendimentos);
      sheet.getRange(i + 1, 7).setValue('OK');
      sheet.getRange(i + 1, 8).setValue(new Date());
      return;
    }
  }

  sheet.appendRow([chave, comp, medico, unidade, especialidade, atendimentos, 'OK', new Date()]);
}

function calcularProdutividadeIndividualWMGJ(competencia) {
  garantirEstruturaAuditoriaCodeCopilotWMGJ();

  var comp = competencia || obterCompetenciaAtualWMGJ_();
  var ss = getPlanilha();
  var unidadeSheet = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.PROD_UNIDADE);
  var medicoSheet = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.PROD_MEDICO);

  if (!unidadeSheet || !medicoSheet) {
    return { ok: false, etapa: 'calcularProdutividadeIndividualWMGJ', erro: 'Abas de produtividade ausentes' };
  }

  var unidade = lerObjetosWMGJ_(unidadeSheet);
  var medico = lerObjetosWMGJ_(medicoSheet);
  var esperadoPorChave = {};
  var observadoPorChave = {};

  unidade.forEach(function(r) {
    var c = r.COMPETENCIA || r.COMPETENCIA_ASSISTENCIAL;
    if (String(c) !== String(comp)) return;
    var chave = [c, r.UNIDADE, r.ESPECIALIDADE].join('|');
    esperadoPorChave[chave] = normalizarNumeroWMGJ_(r.REALIZADAS || r.ATENDIMENTOS || r.QUANTIDADE);
  });

  medico.forEach(function(r) {
    var c = r.COMPETENCIA;
    if (String(c) !== String(comp)) return;
    var chave = [c, r.UNIDADE, r.ESPECIALIDADE].join('|');
    observadoPorChave[chave] = (observadoPorChave[chave] || 0) + normalizarNumeroWMGJ_(r.ATENDIMENTOS);
  });

  var divergencias = [];
  Object.keys(esperadoPorChave).forEach(function(chave) {
    var esperado = esperadoPorChave[chave] || 0;
    var observado = observadoPorChave[chave] || 0;
    if (esperado !== observado) {
      divergencias.push({ chave: chave, esperado: esperado, observado: observado, diferenca: esperado - observado });
      registrarPendenciaAuditoriaWMGJ_(comp, 'DIVERGENCIA_PRODUTIVIDADE', chave, 'Esperado ' + esperado + ', observado ' + observado);
    }
  });

  if (divergencias.length) {
    enviarNotificacaoAuditoriaWMGJ_('WMGJ - divergências de produtividade ' + comp, JSON.stringify(divergencias, null, 2));
  }

  return { ok: true, etapa: 'calcularProdutividadeIndividualWMGJ', competencia: comp, divergencias: divergencias.length };
}

function verificarCompletudeMensalWMGJ(competencia) {
  garantirEstruturaAuditoriaCodeCopilotWMGJ();

  var comp = competencia || obterCompetenciaAtualWMGJ_();
  var ss = getPlanilha();
  var requisitos = [
    { nome: 'Escala', aba: WMGJ_AUDITORIA_CODE_COPILOT.ESCALA },
    { nome: 'NFS-e', aba: WMGJ_AUDITORIA_CODE_COPILOT.NFSE },
    { nome: 'Extrato Bradesco', aba: WMGJ_AUDITORIA_CODE_COPILOT.EXTRATOS }
  ];
  var ausentes = [];

  requisitos.forEach(function(req) {
    var sheet = ss.getSheetByName(req.aba);
    if (!sheet || !abaTemCompetenciaWMGJ_(sheet, comp)) {
      ausentes.push(req.nome);
      registrarPendenciaAuditoriaWMGJ_(comp, 'DOCUMENTO_AUSENTE', req.nome, 'Sem registros para competência');
    }
  });

  if (ausentes.length) {
    enviarNotificacaoAuditoriaWMGJ_('WMGJ - dados incompletos ' + comp, 'Itens ausentes: ' + ausentes.join(', '));
  }

  return { ok: true, etapa: 'verificarCompletudeMensalWMGJ', competencia: comp, ausentes: ausentes };
}

function conciliarFinanceiroAuditoriaWMGJ(competencia) {
  garantirEstruturaAuditoriaCodeCopilotWMGJ();

  var comp = competencia || obterCompetenciaAtualWMGJ_();
  var ss = getPlanilha();
  var nfSheet = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.NFSE);
  var extSheet = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.EXTRATOS);
  var finSheet = ss.getSheetByName(WMGJ_AUDITORIA_CODE_COPILOT.FINANCEIRO);

  if (!nfSheet || !extSheet || !finSheet) {
    return { ok: false, etapa: 'conciliarFinanceiroAuditoriaWMGJ', erro: 'Abas financeiras ausentes' };
  }

  var nfs = lerObjetosWMGJ_(nfSheet);
  var extratos = lerObjetosWMGJ_(extSheet);
  var indiceExtrato = {};
  var conciliadas = 0;
  var pendentes = 0;

  extratos.forEach(function(e) {
    var c = e.COMPETENCIA || comp;
    if (String(c) !== String(comp)) return;
    var valor = normalizarNumeroWMGJ_(e.VALOR);
    var data = normalizarDataWMGJ_(e.DATA);
    var chave = [data, valor.toFixed(2)].join('|');
    indiceExtrato[chave] = (indiceExtrato[chave] || 0) + valor;
  });

  nfs.forEach(function(nf) {
    var c = nf.COMPETENCIA || nf.COMPETENCIA_ASSISTENCIAL || nf.COMPETENCIA_NF;
    if (String(c) !== String(comp)) return;

    var valor = normalizarNumeroWMGJ_(nf.VALOR_SERVICO || nf.VALOR || nf.RECEITA_BRUTA);
    var data = normalizarDataWMGJ_(nf.DATA || nf.DATA_EMISSAO || nf.DATA_COMPETENCIA_NF);
    var unidade = nf.UNIDADE || nf.TOMADOR || '';
    var especialidade = nf.ESPECIALIDADE || '';
    var chave = [data, valor.toFixed(2)].join('|');
    var recebido = Math.min(indiceExtrato[chave] || 0, valor);
    var emAberto = Math.max(valor - recebido, 0);

    if (emAberto > 0) {
      pendentes++;
      registrarPendenciaAuditoriaWMGJ_(comp, 'NFSE_EM_ABERTO', chave, 'Valor em aberto: ' + emAberto.toFixed(2));
    } else {
      conciliadas++;
    }

    atualizarFinanceiroEmAbertoWMGJ_(finSheet, comp, unidade, especialidade, emAberto);
  });

  if (pendentes) {
    enviarNotificacaoAuditoriaWMGJ_('WMGJ - NFS-e em aberto ' + comp, 'Notas pendentes ou divergentes: ' + pendentes);
  }

  return { ok: true, etapa: 'conciliarFinanceiroAuditoriaWMGJ', competencia: comp, conciliadas: conciliadas, pendentes: pendentes };
}

function atualizarFinanceiroEmAbertoWMGJ_(sheet, comp, unidade, especialidade, emAberto) {
  var dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return false;

  var h = dados[0];
  var idxComp = indiceCabecalhoWMGJ_(h, ['COMPETENCIA_ASSISTENCIAL', 'COMPETENCIA']);
  var idxUnidade = indiceCabecalhoWMGJ_(h, ['UNIDADE']);
  var idxEsp = indiceCabecalhoWMGJ_(h, ['ESPECIALIDADE']);
  var idxAberto = indiceCabecalhoWMGJ_(h, ['EM_ABERTO']);

  if (idxComp < 0 || idxAberto < 0) return false;

  for (var i = 1; i < dados.length; i++) {
    var mesmaComp = String(dados[i][idxComp]) === String(comp);
    var mesmaUnidade = idxUnidade < 0 || !unidade || String(dados[i][idxUnidade]) === String(unidade);
    var mesmaEsp = idxEsp < 0 || !especialidade || String(dados[i][idxEsp]) === String(especialidade);
    if (mesmaComp && mesmaUnidade && mesmaEsp) {
      sheet.getRange(i + 1, idxAberto + 1).setValue(emAberto);
      return true;
    }
  }
  return false;
}

function instalarGatilhosAuditoriaCodeCopilotWMGJ() {
  removerGatilhosAuditoriaCodeCopilotWMGJ_();

  ScriptApp.newTrigger('rotinaMensalAuditoriaCodeCopilotWMGJ')
    .timeBased()
    .onMonthDay(5)
    .atHour(8)
    .create();

  registrarLogWMGJ_('OK', 'instalarGatilhosAuditoriaCodeCopilotWMGJ', 'AppsScript', 'Gatilho mensal instalado');
  return { ok: true, etapa: 'instalarGatilhosAuditoriaCodeCopilotWMGJ' };
}

function rotinaMensalAuditoriaCodeCopilotWMGJ() {
  return executarMelhoriasAuditoriaCodeCopilotWMGJ(obterCompetenciaAnteriorWMGJ_());
}

function removerGatilhosAuditoriaCodeCopilotWMGJ_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === 'rotinaMensalAuditoriaCodeCopilotWMGJ') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function registrarPendenciaAuditoriaWMGJ_(competencia, tipo, referencia, detalhe) {
  var ss = getPlanilha();
  var sheet = obterOuCriarAba_(ss, WMGJ_AUDITORIA_CODE_COPILOT.PENDENCIAS, [
    'DATA_REGISTRO', 'COMPETENCIA', 'TIPO', 'REFERENCIA', 'DETALHE', 'STATUS'
  ]);
  sheet.appendRow([new Date(), competencia || '', tipo || '', referencia || '', detalhe || '', 'ABERTA']);
}

function enviarNotificacaoAuditoriaWMGJ_(assunto, mensagem) {
  var cfg = getConfigWMGJ_();
  var email = (cfg.OPERADOR_EMAIL || cfg.operadorEmail || WMGJ_AUDITORIA_CODE_COPILOT.OPERADOR_PADRAO);
  GmailApp.sendEmail(email, assunto, mensagem);
  registrarLogWMGJ_('EMAIL', assunto, 'AppsScript', 'Notificação enviada para ' + email);
}

function lerObjetosWMGJ_(sheet) {
  var dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  var headers = dados[0].map(function(h) { return String(h || '').trim(); });
  return dados.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function abaTemCompetenciaWMGJ_(sheet, competencia) {
  var dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return false;
  var headers = dados[0];
  var idx = indiceCabecalhoWMGJ_(headers, ['COMPETENCIA', 'COMPETENCIA_ASSISTENCIAL', 'COMPETENCIA_NF']);
  if (idx < 0) idx = 0;
  return dados.slice(1).some(function(row) { return String(row[idx]) === String(competencia); });
}

function validarLinhaEscalaWMGJ_(data, medico, unidade, especialidade, atendimentos) {
  if (!data) return 'DATA_INVALIDA';
  if (!medico) return 'MEDICO_AUSENTE';
  if (!unidade) return 'UNIDADE_AUSENTE';
  if (!especialidade) return 'ESPECIALIDADE_AUSENTE';
  if (!(atendimentos >= 0)) return 'ATENDIMENTOS_INVALIDOS';
  return 'OK';
}

function validarCompetenciaWMGJ_(competencia) {
  var comp = String(competencia || '').trim();
  if (!/^\d{4}-\d{2}$/.test(comp)) throw new Error('Competência inválida. Use YYYY-MM.');
  return comp;
}

function validarCnpjWMGJ_(cnpj) {
  var v = String(cnpj || '').replace(/\D/g, '');
  if (v.length !== 14 || /^(\d)\1+$/.test(v)) return false;
  var calc = function(base, pesos) {
    var soma = 0;
    for (var i = 0; i < pesos.length; i++) soma += Number(base[i]) * pesos[i];
    var resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  var d1 = calc(v, [5,4,3,2,9,8,7,6,5,4,3,2]);
  var d2 = calc(v, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(v[12]) && d2 === Number(v[13]);
}

function indiceCabecalhoWMGJ_(headers, nomes) {
  var norm = headers.map(function(h) { return String(h || '').trim().toUpperCase(); });
  for (var i = 0; i < nomes.length; i++) {
    var idx = norm.indexOf(String(nomes[i]).toUpperCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function limparTextoWMGJ_(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim();
}

function normalizarNumeroWMGJ_(valor) {
  if (typeof valor === 'number') return valor;
  var texto = String(valor || '0').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  return Number(texto) || 0;
}

function normalizarDataWMGJ_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(valor || '').trim();
  if (!s) return '';
  var mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return mIso[1] + '-' + mIso[2] + '-' + mIso[3];
  var mBr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mBr) return mBr[3] + '-' + ('0' + mBr[2]).slice(-2) + '-' + ('0' + mBr[1]).slice(-2);
  return s;
}

function obterCompetenciaAtualWMGJ_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function obterCompetenciaAnteriorWMGJ_() {
  var d = new Date();
  d.setMonth(d.getMonth() - 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
}

function gerarHashWMGJ_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto || '');
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}
