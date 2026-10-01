/**
 * WMGJ — Parser financeiro de extrato bancário
 * Versão: v1.1.4-parser-extrato-bancario
 *
 * Objetivo:
 * - ler textos já formatados em 17_EXTRACOES_FORMATADAS;
 * - extrair lançamentos financeiros de extratos bancários;
 * - gravar lançamentos estruturados em 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS;
 * - consolidar por competência em 19_RESUMO_FINANCEIRO_MENSAL.
 *
 * Cole este arquivo inteiro em: 06_PARSER_EXTRATO_BANCARIO_WMGJ
 */

var WMGJ_PARSER_EXTRATO_VERSAO = 'v1.1.4-parser-extrato-bancario';

function rodarParserExtratoBancarioWMGJ_10() {
  return processarExtratosBancariosFormatadosWMGJ(10);
}

function rodarParserExtratoBancarioWMGJ_Todos() {
  return processarExtratosBancariosFormatadosWMGJ(1000);
}

function rodarResumoFinanceiroMensalWMGJ() {
  return consolidarResumoFinanceiroMensalWMGJ();
}

function processarExtratosBancariosFormatadosWMGJ(limite) {
  var ss = getPlanilhaWMGJ_Parser_();
  var origem = ss.getSheetByName('17_EXTRACOES_FORMATADAS');

  if (!origem || origem.getLastRow() < 2) {
    var vazio = {
      ok: true,
      versao: WMGJ_PARSER_EXTRATO_VERSAO,
      mensagem: 'Sem textos formatados para parser financeiro',
      processados: 0,
      lancamentos: 0
    };
    logParserWMGJ_('OK', 'processarExtratosBancariosFormatadosWMGJ', JSON.stringify(vazio));
    Logger.log(JSON.stringify(vazio, null, 2));
    return vazio;
  }

  var destino = garantirAbaLancamentosFinanceirosWMGJ_();
  var dados = origem.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Parser_(dados[0]);
  var chaves = carregarLancamentosJaExtraidosWMGJ_(destino);
  var max = Number(limite) || 10;

  var analisados = 0;
  var documentosComLancamento = 0;
  var lancamentos = 0;
  var ignorados = 0;

  for (var i = dados.length - 1; i >= 1 && analisados < max; i--) {
    var linha = dados[i];
    var idOrigem = String(linha[idx.ID_ORIGEM] || '');
    var hash = String(linha[idx.HASH] || '');
    var nomeArquivo = String(linha[idx.NOME_ARQUIVO] || '');
    var texto = String(linha[idx.TEXTO_FORMATADO] || '');
    var mimeType = String(linha[idx.MIME_TYPE] || '');

    if (!idOrigem || !texto) {
      ignorados++;
      continue;
    }

    if (!pareceExtratoBancarioWMGJ_(nomeArquivo, texto)) {
      ignorados++;
      continue;
    }

    analisados++;

    var itens = extrairLancamentosExtratoBancarioWMGJ_(texto);
    if (!itens.length) {
      ignorados++;
      continue;
    }

    var inseridosDocumento = 0;

    itens.forEach(function(item) {
      var chave = [idOrigem, hash, item.dataLancamento, item.valor, item.descricaoNormalizada].join('|');
      if (chaves[chave]) return;

      destino.appendRow([
        new Date(),
        WMGJ_PARSER_EXTRATO_VERSAO,
        idOrigem,
        nomeArquivo,
        mimeType,
        hash,
        item.dataLancamento,
        item.competencia,
        item.descricao,
        item.tipo,
        item.valor,
        item.sinal,
        item.saldoEstimado,
        item.statusParse,
        item.confianca,
        item.linhaOriginal
      ]);

      chaves[chave] = true;
      lancamentos++;
      inseridosDocumento++;
    });

    if (inseridosDocumento > 0) documentosComLancamento++;
  }

  aplicarFormatacaoLancamentosFinanceirosWMGJ_(destino);
  var resumo = consolidarResumoFinanceiroMensalWMGJ();

  var resultado = {
    ok: true,
    versao: WMGJ_PARSER_EXTRATO_VERSAO,
    analisados: analisados,
    documentosComLancamento: documentosComLancamento,
    lancamentos: lancamentos,
    ignorados: ignorados,
    resumo: resumo,
    abaLancamentos: '18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS',
    abaResumo: '19_RESUMO_FINANCEIRO_MENSAL'
  };

  logParserWMGJ_('OK', 'processarExtratosBancariosFormatadosWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function pareceExtratoBancarioWMGJ_(nomeArquivo, texto) {
  var alvo = (String(nomeArquivo || '') + '\n' + String(texto || '')).toLowerCase();
  var pontos = 0;

  if (/bradesco|itau|itaú|santander|bb|banco do brasil|caixa|sicredi|sicoob|nubank|inter/.test(alvo)) pontos += 30;
  if (/extrato|conta corrente|ag[êe]ncia|agencia|saldo|lan[çc]amentos/.test(alvo)) pontos += 30;
  if (/r\$\s*[0-9\.]+,[0-9]{2}/i.test(alvo)) pontos += 20;
  if (/\d{2}\/\d{2}(?:\/20\d{2})?/.test(alvo)) pontos += 20;

  return pontos >= 40;
}

function extrairLancamentosExtratoBancarioWMGJ_(texto) {
  texto = normalizarTextoParserExtratoWMGJ_(texto);
  var linhas = texto.split('\n');
  var itens = [];
  var ultimo = null;

  linhas.forEach(function(linhaOriginal) {
    var linha = String(linhaOriginal || '').trim();
    if (!linha) return;
    if (linha.length < 8) return;
    if (ehLinhaRuidoExtratoWMGJ_(linha)) return;

    var data = extrairDataLinhaExtratoWMGJ_(linha);

    if (!data && ultimo && !temValorMonetarioWMGJ_(linha) && linha.length <= 120) {
      ultimo.descricao += ' ' + linha;
      ultimo.descricao = limparDescricaoExtratoWMGJ_(ultimo.descricao);
      ultimo.descricaoNormalizada = normalizarChaveTextoWMGJ_(ultimo.descricao);
      return;
    }

    if (!data) return;

    var valores = extrairValoresMonetariosLinhaWMGJ_(linha);
    if (!valores.length) return;

    var valorLancamento = escolherValorLancamentoExtratoWMGJ_(linha, valores);
    if (!valorLancamento || !valorLancamento.valor) return;

    var saldo = valores.length >= 2 ? valores[valores.length - 1].valor : '';
    var descricao = limparDescricaoExtratoWMGJ_(removerDataEValoresDaLinhaWMGJ_(linha));
    var tipoInfo = classificarTipoLancamentoExtratoWMGJ_(linha, valorLancamento.valor);
    var competencia = competenciaPorDataWMGJ_(data);
    var confianca = calcularConfiancaLancamentoWMGJ_(linha, descricao, valores, tipoInfo.tipo);

    var item = {
      dataLancamento: data,
      competencia: competencia,
      descricao: descricao || 'Lançamento sem descrição',
      descricaoNormalizada: normalizarChaveTextoWMGJ_(descricao || linha),
      tipo: tipoInfo.tipo,
      valor: Math.abs(valorLancamento.valor),
      sinal: tipoInfo.sinal,
      saldoEstimado: saldo,
      statusParse: confianca >= 70 ? 'PARSE_OK' : 'PARSE_REVISAR',
      confianca: confianca,
      linhaOriginal: linha
    };

    itens.push(item);
    ultimo = item;
  });

  return itens;
}

function normalizarTextoParserExtratoWMGJ_(texto) {
  return String(texto || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/(\d{2}\/\d{2}(?:\/20\d{2})?)/g, '\n$1 ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function ehLinhaRuidoExtratoWMGJ_(linha) {
  var l = String(linha || '').toLowerCase();
  return /^(saldo anterior|saldo atual|total|data\s+hist[oó]rico|hist[oó]rico|continua|p[aá]gina|ouvidoria|sac|autentica[cç][aã]o|extrato emitido)/i.test(l);
}

function extrairDataLinhaExtratoWMGJ_(linha) {
  var agora = new Date();
  var anoAtual = agora.getFullYear();
  var m = String(linha || '').match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];

  var m2 = String(linha || '').match(/\b(\d{2})\/(\d{2})\b/);
  if (m2) return anoAtual + '-' + m2[2] + '-' + m2[1];

  return '';
}

function temValorMonetarioWMGJ_(linha) {
  return /(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}/.test(String(linha || ''));
}

function extrairValoresMonetariosLinhaWMGJ_(linha) {
  var texto = String(linha || '');
  var re = /(?:R\$\s*)?([\-−]?\d{1,3}(?:\.\d{3})*,\d{2})/g;
  var valores = [];
  var m;

  while ((m = re.exec(texto)) !== null) {
    var bruto = m[1].replace('−', '-');
    var negativo = bruto.indexOf('-') === 0 || texto.slice(Math.max(0, m.index - 2), m.index + m[0].length + 2).indexOf('(') >= 0;
    var n = Number(bruto.replace('-', '').replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n)) {
      valores.push({
        valor: negativo ? -n : n,
        bruto: m[0],
        index: m.index
      });
    }
  }

  return valores;
}

function escolherValorLancamentoExtratoWMGJ_(linha, valores) {
  if (!valores.length) return null;

  if (valores.length === 1) return valores[0];

  // Em extratos comuns: a última coluna costuma ser saldo, a penúltima costuma ser o valor do lançamento.
  return valores[valores.length - 2];
}

function classificarTipoLancamentoExtratoWMGJ_(linha, valor) {
  var l = String(linha || '').toLowerCase();

  var credito = /(receb|cr[eé]dito|credito|dep[oó]sito|deposito|pix recebido|ted recebida|doc recebido|resgate|estorno|transfer[êe]ncia recebida)/i.test(l);
  var debito = /(d[eé]bito|debito|pagamento|pagto|pix enviado|compra|tarifa|saque|boleto|ted enviada|doc enviada|transfer[êe]ncia enviada|imposto|iof)/i.test(l);

  if (valor < 0) return { tipo: 'DEBITO', sinal: -1 };
  if (credito && !debito) return { tipo: 'CREDITO', sinal: 1 };
  if (debito && !credito) return { tipo: 'DEBITO', sinal: -1 };

  return { tipo: 'INDEFINIDO', sinal: valor < 0 ? -1 : 1 };
}

function limparDescricaoExtratoWMGJ_(descricao) {
  return String(descricao || '')
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/[-–—:\s]+$/, '')
    .trim();
}

function removerDataEValoresDaLinhaWMGJ_(linha) {
  return String(linha || '')
    .replace(/\b\d{2}\/\d{2}(?:\/20\d{2})?\b/g, ' ')
    .replace(/(?:R\$\s*)?[\-−]?\d{1,3}(?:\.\d{3})*,\d{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function competenciaPorDataWMGJ_(dataIso) {
  var m = String(dataIso || '').match(/^(20\d{2})-(\d{2})-\d{2}$/);
  return m ? m[1] + '-' + m[2] : '';
}

function calcularConfiancaLancamentoWMGJ_(linha, descricao, valores, tipo) {
  var pontos = 0;
  if (extrairDataLinhaExtratoWMGJ_(linha)) pontos += 25;
  if (valores && valores.length) pontos += 25;
  if (descricao && descricao.length >= 4) pontos += 20;
  if (tipo === 'CREDITO' || tipo === 'DEBITO') pontos += 20;
  if (valores && valores.length >= 2) pontos += 10;
  return pontos;
}

function normalizarChaveTextoWMGJ_(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/[áàâã]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/[í]/g, 'i')
    .replace(/[óôõ]/g, 'o')
    .replace(/[ú]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function consolidarResumoFinanceiroMensalWMGJ() {
  var ss = getPlanilhaWMGJ_Parser_();
  var origem = ss.getSheetByName('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS');
  var destino = garantirAbaResumoFinanceiroMensalWMGJ_();

  if (!origem || origem.getLastRow() < 2) {
    var vazio = {
      ok: true,
      versao: WMGJ_PARSER_EXTRATO_VERSAO,
      competencias: 0,
      mensagem: 'Sem lançamentos financeiros para consolidar'
    };
    Logger.log(JSON.stringify(vazio, null, 2));
    return vazio;
  }

  var dados = origem.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Parser_(dados[0]);
  var mapa = {};

  for (var i = 1; i < dados.length; i++) {
    var competencia = String(dados[i][idx.COMPETENCIA] || '');
    var tipo = String(dados[i][idx.TIPO] || 'INDEFINIDO').toUpperCase();
    var valor = Number(dados[i][idx.VALOR] || 0);
    var status = String(dados[i][idx.STATUS_PARSE] || '');

    if (!competencia) continue;

    if (!mapa[competencia]) {
      mapa[competencia] = {
        competencia: competencia,
        creditos: 0,
        debitos: 0,
        indefinidos: 0,
        qtdLancamentos: 0,
        qtdRevisar: 0
      };
    }

    if (tipo === 'CREDITO') mapa[competencia].creditos += valor;
    else if (tipo === 'DEBITO') mapa[competencia].debitos += valor;
    else mapa[competencia].indefinidos += valor;

    mapa[competencia].qtdLancamentos++;
    if (status !== 'PARSE_OK') mapa[competencia].qtdRevisar++;
  }

  destino.clearContents();
  destino.getRange(1, 1, 1, 8).setValues([[
    'COMPETENCIA', 'TOTAL_CREDITOS', 'TOTAL_DEBITOS', 'RESULTADO_LIQUIDO',
    'VALOR_INDEFINIDO', 'QTD_LANCAMENTOS', 'QTD_REVISAR', 'VERSAO'
  ]]);

  var competencias = Object.keys(mapa).sort();
  var linhas = competencias.map(function(c) {
    var r = mapa[c];
    return [
      r.competencia,
      r.creditos,
      r.debitos,
      r.creditos - r.debitos,
      r.indefinidos,
      r.qtdLancamentos,
      r.qtdRevisar,
      WMGJ_PARSER_EXTRATO_VERSAO
    ];
  });

  if (linhas.length) {
    destino.getRange(2, 1, linhas.length, 8).setValues(linhas);
  }

  aplicarFormatacaoResumoFinanceiroWMGJ_(destino);

  var resultado = {
    ok: true,
    versao: WMGJ_PARSER_EXTRATO_VERSAO,
    competencias: competencias.length,
    linhas: linhas.length
  };

  logParserWMGJ_('OK', 'consolidarResumoFinanceiroMensalWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function garantirAbaLancamentosFinanceirosWMGJ_() {
  var ss = getPlanilhaWMGJ_Parser_();
  var sheet = ss.getSheetByName('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS');
  var cabecalho = [
    'DATA_PROCESSAMENTO', 'VERSAO', 'ID_ORIGEM', 'NOME_ARQUIVO', 'MIME_TYPE',
    'HASH', 'DATA_LANCAMENTO', 'COMPETENCIA', 'DESCRICAO', 'TIPO', 'VALOR',
    'SINAL', 'SALDO_ESTIMADO', 'STATUS_PARSE', 'CONFIANCA', 'LINHA_ORIGINAL'
  ];

  if (!sheet) sheet = ss.insertSheet('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS');

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function garantirAbaResumoFinanceiroMensalWMGJ_() {
  var ss = getPlanilhaWMGJ_Parser_();
  var sheet = ss.getSheetByName('19_RESUMO_FINANCEIRO_MENSAL');
  if (!sheet) sheet = ss.insertSheet('19_RESUMO_FINANCEIRO_MENSAL');
  return sheet;
}

function aplicarFormatacaoLancamentosFinanceirosWMGJ_(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(9, 340);
  sheet.setColumnWidth(16, 650);
  sheet.getRange(2, 11, Math.max(lastRow - 1, 1), 1).setNumberFormat('R$ #,##0.00');
  sheet.getRange(2, 13, Math.max(lastRow - 1, 1), 1).setNumberFormat('R$ #,##0.00');
}

function aplicarFormatacaoResumoFinanceiroWMGJ_(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, lastCol);
  if (lastRow > 1) {
    sheet.getRange(2, 2, lastRow - 1, 4).setNumberFormat('R$ #,##0.00');
  }
}

function carregarLancamentosJaExtraidosWMGJ_(sheet) {
  var mapa = {};
  if (!sheet || sheet.getLastRow() < 2) return mapa;

  var dados = sheet.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Parser_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var chave = [
      dados[i][idx.ID_ORIGEM],
      dados[i][idx.HASH],
      dados[i][idx.DATA_LANCAMENTO],
      dados[i][idx.VALOR],
      normalizarChaveTextoWMGJ_(dados[i][idx.DESCRICAO])
    ].join('|');
    mapa[chave] = true;
  }

  return mapa;
}

function mapearCabecalhoWMGJ_Parser_(headers) {
  var mapa = {};
  headers = headers || [];
  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || '').trim();
    if (chave) mapa[chave] = i;
  }
  return mapa;
}

function getPlanilhaWMGJ_Parser_() {
  if (typeof getPlanilhaWMGJ_Formatacao_ === 'function') {
    try {
      var formatacao = getPlanilhaWMGJ_Formatacao_();
      if (formatacao) return formatacao;
    } catch (erroFormatacao) {}
  }

  if (typeof getPlanilhaWMGJ_Compat_ === 'function') {
    try {
      var compat = getPlanilhaWMGJ_Compat_();
      if (compat) return compat;
    } catch (erroCompat) {}
  }

  if (typeof getPlanilha === 'function') {
    try {
      var original = getPlanilha();
      if (original) return original;
    } catch (erroOriginal) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WMGJ_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) throw new Error('PLANILHA_NAO_ENCONTRADA');
  return ativa;
}

function logParserWMGJ_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
