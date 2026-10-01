/**
 * WMGJ — Dashboard Financeiro Canônico
 * Versão: v1.0.0-dashboard-financeiro
 *
 * Fonte: 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS
 * Destinos:
 * - 19_RESUMO_FINANCEIRO_MENSAL
 * - 09_INDICADORES_DASHBOARD
 * - 05_DASHBOARD
 * - 10_LOG_AUTOMACAO
 * - 15_STATUS_AUTOMACAO
 */

var WMGJ_DASHBOARD_FINANCEIRO_VERSAO = 'v1.0.0-dashboard-financeiro';

function atualizarDashboardFinanceiro() {
  var ss = obterPlanilhaDashboardFinanceiroWMGJ_();
  var abaLancamentos = ss.getSheetByName('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS');
  if (!abaLancamentos) throw new Error('Aba 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS não encontrada.');

  var dados = abaLancamentos.getDataRange().getValues();
  var cabecalho = dados[0] || [];
  var idxCompetencia = cabecalho.indexOf('COMPETENCIA');
  var idxTipo = cabecalho.indexOf('TIPO');
  var idxValor = cabecalho.indexOf('VALOR');
  var idxSinal = cabecalho.indexOf('SINAL');

  if (idxCompetencia < 0 || idxTipo < 0 || idxValor < 0 || idxSinal < 0) {
    throw new Error('Cabeçalho financeiro inválido em 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS.');
  }

  var resumo = {};
  var totalCreditos = 0;
  var totalDebitos = 0;
  var totalIndefinido = 0;
  var totalLancamentos = 0;
  var totalRevisar = 0;

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var competencia = normalizarCompetenciaDashboardFinanceiroWMGJ_(linha[idxCompetencia]);
    if (!competencia) continue;

    var tipo = String(linha[idxTipo] || '').toUpperCase().trim();
    var valor = normalizarValorFinanceiroWMGJ_(linha[idxValor]);
    var sinal = Number(linha[idxSinal] || 0);

    if (!resumo[competencia]) {
      resumo[competencia] = {
        competencia: competencia,
        creditos: 0,
        debitos: 0,
        indefinido: 0,
        qtd: 0,
        revisar: 0
      };
    }

    resumo[competencia].qtd++;
    totalLancamentos++;

    if (tipo === 'CREDITO' || tipo === 'CRÉDITO' || sinal > 0 && tipo !== 'INDEFINIDO') {
      resumo[competencia].creditos += valor;
      totalCreditos += valor;
    } else if (tipo === 'DEBITO' || tipo === 'DÉBITO' || sinal < 0) {
      resumo[competencia].debitos += valor;
      totalDebitos += valor;
    } else {
      resumo[competencia].indefinido += valor;
      resumo[competencia].revisar++;
      totalIndefinido += valor;
      totalRevisar++;
    }
  }

  var competencias = Object.keys(resumo).sort();
  var linhasResumo = [[
    'COMPETENCIA',
    'TOTAL_CREDITOS',
    'TOTAL_DEBITOS',
    'RESULTADO_LIQUIDO',
    'VALOR_INDEFINIDO',
    'QTD_LANCAMENTOS',
    'QTD_REVISAR',
    'VERSAO',
    'ATUALIZADO_EM'
  ]];

  var atualizadoEm = new Date();
  competencias.forEach(function(comp) {
    var item = resumo[comp];
    linhasResumo.push([
      comp,
      item.creditos,
      item.debitos,
      item.creditos - item.debitos,
      item.indefinido,
      item.qtd,
      item.revisar,
      WMGJ_DASHBOARD_FINANCEIRO_VERSAO,
      atualizadoEm
    ]);
  });

  var resultadoLiquido = totalCreditos - totalDebitos;
  atualizarAbaResumoFinanceiroWMGJ_(ss, linhasResumo);
  atualizarIndicadoresFinanceirosWMGJ_(ss, totalCreditos, totalDebitos, resultadoLiquido, totalIndefinido, totalLancamentos, totalRevisar, atualizadoEm);
  atualizarAbaDashboardFinanceiroWMGJ_(ss, totalCreditos, totalDebitos, resultadoLiquido, totalIndefinido, totalLancamentos, totalRevisar, competencias.length, atualizadoEm);

  var resultado = {
    ok: true,
    versao: WMGJ_DASHBOARD_FINANCEIRO_VERSAO,
    etapa: 'atualizarDashboardFinanceiro',
    competencias: competencias.length,
    totalCreditos: totalCreditos,
    totalDebitos: totalDebitos,
    resultadoLiquido: resultadoLiquido,
    totalIndefinido: totalIndefinido,
    totalLancamentos: totalLancamentos,
    totalRevisar: totalRevisar,
    atualizadoEm: atualizadoEm.toISOString()
  };

  registrarStatusDashboardFinanceiroWMGJ_(resultado);
  registrarLogDashboardFinanceiroWMGJ_('OK', 'atualizarDashboardFinanceiro', resultado);
  return resultado;
}

function gerarResumoFinanceiroMensalWMGJ() {
  return atualizarDashboardFinanceiro();
}

function diagnosticarDashboardFinanceiroWMGJ() {
  var ss = obterPlanilhaDashboardFinanceiroWMGJ_();
  var resultado = {
    ok: true,
    versao: WMGJ_DASHBOARD_FINANCEIRO_VERSAO,
    etapa: 'diagnosticarDashboardFinanceiroWMGJ',
    spreadsheetId: ss.getId(),
    planilha: ss.getName(),
    abas: {
      lancamentos: !!ss.getSheetByName('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS'),
      resumoMensal: !!ss.getSheetByName('19_RESUMO_FINANCEIRO_MENSAL'),
      indicadores: !!ss.getSheetByName('09_INDICADORES_DASHBOARD'),
      dashboard: !!ss.getSheetByName('05_DASHBOARD')
    },
    diagnosticadoEm: new Date().toISOString()
  };
  registrarStatusDashboardFinanceiroWMGJ_(resultado);
  registrarLogDashboardFinanceiroWMGJ_('OK', 'diagnosticarDashboardFinanceiroWMGJ', resultado);
  return resultado;
}

function atualizarAbaResumoFinanceiroWMGJ_(ss, linhasResumo) {
  var aba = obterOuCriarAbaDashboardFinanceiroWMGJ_(ss, '19_RESUMO_FINANCEIRO_MENSAL');
  aba.clearContents();
  aba.getRange(1, 1, linhasResumo.length, linhasResumo[0].length).setValues(linhasResumo);
  aba.setFrozenRows(1);
  if (linhasResumo.length > 1) {
    aba.getRange(2, 2, linhasResumo.length - 1, 4).setNumberFormat('R$ #,##0.00');
    aba.getRange(2, 9, linhasResumo.length - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  }
  aba.autoResizeColumns(1, linhasResumo[0].length);
}

function atualizarIndicadoresFinanceirosWMGJ_(ss, creditos, debitos, resultado, indefinido, qtd, revisar, atualizadoEm) {
  var aba = obterOuCriarAbaDashboardFinanceiroWMGJ_(ss, '09_INDICADORES_DASHBOARD');
  var linhas = [
    ['INDICADOR', 'VALOR', 'ATUALIZADO_EM'],
    ['RECEITA_BRUTA', creditos, atualizadoEm],
    ['DESPESA', debitos, atualizadoEm],
    ['RESULTADO', resultado, atualizadoEm],
    ['VALOR_INDEFINIDO_A_REVISAR', indefinido, atualizadoEm],
    ['QTD_LANCAMENTOS_FINANCEIROS', qtd, atualizadoEm],
    ['QTD_LANCAMENTOS_A_REVISAR', revisar, atualizadoEm]
  ];
  aba.clearContents();
  aba.getRange(1, 1, linhas.length, linhas[0].length).setValues(linhas);
  aba.setFrozenRows(1);
  aba.getRange(2, 2, 4, 1).setNumberFormat('R$ #,##0.00');
  aba.getRange(2, 3, linhas.length - 1, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  aba.autoResizeColumns(1, 3);
}

function atualizarAbaDashboardFinanceiroWMGJ_(ss, creditos, debitos, resultado, indefinido, qtd, revisar, competencias, atualizadoEm) {
  var aba = obterOuCriarAbaDashboardFinanceiroWMGJ_(ss, '05_DASHBOARD');
  var linhas = [
    ['DASHBOARD FINANCEIRO WMGJ', '', ''],
    ['Indicador', 'Valor', 'Atualizado em'],
    ['Receita bruta classificada', creditos, atualizadoEm],
    ['Despesas classificadas', debitos, atualizadoEm],
    ['Resultado líquido classificado', resultado, atualizadoEm],
    ['Valor indefinido a revisar', indefinido, atualizadoEm],
    ['Quantidade de lançamentos', qtd, atualizadoEm],
    ['Lançamentos a revisar', revisar, atualizadoEm],
    ['Competências consolidadas', competencias, atualizadoEm],
    ['Versão', WMGJ_DASHBOARD_FINANCEIRO_VERSAO, atualizadoEm]
  ];
  aba.clearContents();
  aba.getRange(1, 1, linhas.length, linhas[0].length).setValues(linhas);
  aba.getRange(1, 1, 1, 3).merge();
  aba.getRange(1, 1, 1, 1).setFontWeight('bold').setHorizontalAlignment('CENTER');
  aba.getRange(2, 1, 1, 3).setFontWeight('bold');
  aba.getRange(3, 2, 4, 1).setNumberFormat('R$ #,##0.00');
  aba.getRange(3, 3, linhas.length - 2, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  aba.autoResizeColumns(1, 3);
}

function normalizarCompetenciaDashboardFinanceiroWMGJ_(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  var texto = String(valor).trim();
  var matchIso = texto.match(/(20\d{2})[-\/](0[1-9]|1[0-2])/);
  if (matchIso) return matchIso[1] + '-' + matchIso[2];
  var matchDate = texto.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  if (matchDate && texto.match(/20\d{2}/)) {
    var data = new Date(texto);
    if (!isNaN(data.getTime())) return Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return texto;
}

function normalizarValorFinanceiroWMGJ_(valor) {
  if (typeof valor === 'number') return Math.abs(valor);
  var texto = String(valor || '').trim();
  if (!texto) return 0;
  texto = texto.replace(/R\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  var numero = Number(texto);
  return isNaN(numero) ? 0 : Math.abs(numero);
}

function obterPlanilhaDashboardFinanceiroWMGJ_() {
  if (typeof getPlanilha === 'function') return getPlanilha();
  if (typeof getConfigWMGJ_ === 'function') return SpreadsheetApp.openById(getConfigWMGJ_().SPREADSHEET_ID);
  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) throw new Error('PLANILHA_NAO_ENCONTRADA');
  return ativa;
}

function obterOuCriarAbaDashboardFinanceiroWMGJ_(ss, nome) {
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}

function registrarStatusDashboardFinanceiroWMGJ_(payload) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') registrarStatusAutomacaoWMGJ_(payload);
}

function registrarLogDashboardFinanceiroWMGJ_(status, comando, payload) {
  if (typeof registrarLogWMGJ_ === 'function') {
    registrarLogWMGJ_(status, comando, 'DashboardFinanceiro', JSON.stringify(payload));
    return;
  }
  Logger.log([status, comando, JSON.stringify(payload)].join(' | '));
}
