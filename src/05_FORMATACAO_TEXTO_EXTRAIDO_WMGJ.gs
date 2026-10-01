/**
 * WMGJ — Formatação de texto extraído por OCR/Gemini
 * Versão: v1.1.3-formatacao-texto-extraido
 *
 * Objetivo:
 * - preservar o texto bruto em 16_EXTRACOES_DOCUMENTAIS;
 * - gerar uma versão limpa e legível em 17_EXTRACOES_FORMATADAS;
 * - não alterar a V3 nem a extração real já estabilizada.
 *
 * Cole este arquivo inteiro em: 05_FORMATACAO_TEXTO_EXTRAIDO_WMGJ
 */

var WMGJ_FORMATACAO_TEXTO_VERSAO = 'v1.1.3-formatacao-texto-extraido';

function rodarFormatacaoExtracoesWMGJ_10() {
  return formatarExtracoesDocumentaisWMGJ(10);
}

function rodarFormatacaoExtracoesWMGJ_Todas() {
  return formatarExtracoesDocumentaisWMGJ(1000);
}

function formatarExtracoesDocumentaisWMGJ(limite) {
  var ss = getPlanilhaWMGJ_Formatacao_();
  var origem = ss.getSheetByName('16_EXTRACOES_DOCUMENTAIS');

  if (!origem || origem.getLastRow() < 2) {
    var vazio = {
      ok: true,
      versao: WMGJ_FORMATACAO_TEXTO_VERSAO,
      formatados: 0,
      mensagem: 'Sem extrações documentais para formatar'
    };
    registrarLogWMGJ_Formatacao_('OK', 'formatarExtracoesDocumentaisWMGJ', JSON.stringify(vazio));
    Logger.log(JSON.stringify(vazio, null, 2));
    return vazio;
  }

  var destino = garantirAbaTextoFormatadoWMGJ_();
  var dados = origem.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Formatacao_(dados[0]);
  var processados = carregarChavesFormatadasWMGJ_(destino);
  var max = Number(limite) || 10;

  var lidos = 0;
  var formatados = 0;
  var ignorados = 0;

  for (var i = dados.length - 1; i >= 1 && lidos < max; i--) {
    var linha = dados[i];
    var idOrigem = String(linha[idx.ID_ORIGEM] || '');
    var hash = String(linha[idx.HASH] || '');
    var chave = idOrigem + '|' + hash;

    if (!idOrigem) {
      ignorados++;
      continue;
    }

    if (processados[chave]) {
      ignorados++;
      continue;
    }

    lidos++;

    var textoBruto = String(linha[idx.AMOSTRA_TEXTO] || '');
    var textoFormatado = formatarTextoExtraidoWMGJ_(textoBruto);
    var qualidade = avaliarQualidadeTextoFormatadoWMGJ_(textoFormatado);
    var campos = extrairCamposBasicosTextoFormatadoWMGJ_(textoFormatado);

    destino.appendRow([
      new Date(),
      WMGJ_FORMATACAO_TEXTO_VERSAO,
      idOrigem,
      String(linha[idx.NOME_ARQUIVO] || ''),
      String(linha[idx.MIME_TYPE] || ''),
      hash,
      String(linha[idx.METODO_EXTRACAO] || ''),
      Number(linha[idx.TAMANHO_TEXTO] || 0),
      qualidade.status,
      qualidade.pontuacao,
      campos.competencia,
      campos.valorTotal,
      campos.atendimentos,
      textoFormatado
    ]);

    processados[chave] = true;
    formatados++;
  }

  aplicarFormatacaoVisualAbaTextoFormatadoWMGJ_(destino);

  var resultado = {
    ok: true,
    versao: WMGJ_FORMATACAO_TEXTO_VERSAO,
    lidos: lidos,
    formatados: formatados,
    ignorados: ignorados,
    abaDestino: '17_EXTRACOES_FORMATADAS'
  };

  registrarLogWMGJ_Formatacao_('OK', 'formatarExtracoesDocumentaisWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function formatarTextoExtraidoWMGJ_(texto) {
  texto = String(texto || '');

  texto = texto
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/-\n(?=[a-záéíóúâêôãõç])/gi, '')
    .replace(/([^\.\:\;\,\n])\n(?=[a-záéíóúâêôãõç])/gi, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  var marcadores = [
    'RELATÓRIO', 'RELATORIO', 'RESUMO', 'COMPETÊNCIA', 'COMPETENCIA',
    'DATA', 'PERÍODO', 'PERIODO', 'PRESTADOR', 'CNPJ', 'CPF', 'CRM',
    'MÉDICO', 'MEDICO', 'PACIENTE', 'CONVÊNIO', 'CONVENIO',
    'ATENDIMENTOS', 'QUANTIDADE', 'VALOR', 'TOTAL', 'RECEITA',
    'PAGAMENTO', 'GLOSA', 'OBSERVAÇÃO', 'OBSERVACAO'
  ];

  marcadores.forEach(function(marcador) {
    var re = new RegExp('\\s*(' + marcador + '\\s*[:\\-])', 'gi');
    texto = texto.replace(re, '\n$1 ');
  });

  texto = texto
    .replace(/(R\$\s*[0-9\.]+,[0-9]{2})/g, '\n$1')
    .replace(/(\d{2}\/\d{2}\/20\d{2})/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .trim();

  return texto;
}

function avaliarQualidadeTextoFormatadoWMGJ_(texto) {
  texto = String(texto || '');

  var pontos = 0;
  if (texto.length > 100) pontos += 20;
  if (/R\$\s*[0-9\.]+,[0-9]{2}/i.test(texto)) pontos += 20;
  if (/atendimentos?|quantidade|produção|producao/i.test(texto)) pontos += 20;
  if (/compet[eê]ncia|per[ií]odo|20\d{2}/i.test(texto)) pontos += 20;
  if (texto.split('\n').length >= 5) pontos += 20;

  return {
    pontuacao: pontos,
    status: pontos >= 70 ? 'FORMATADO_OK' : (pontos >= 40 ? 'FORMATADO_REVISAR' : 'TEXTO_FRACO')
  };
}

function extrairCamposBasicosTextoFormatadoWMGJ_(texto) {
  texto = String(texto || '');

  return {
    competencia: extrairCompetenciaWMGJ_Formatacao_(texto),
    valorTotal: extrairValorMonetarioWMGJ_Formatacao_(texto),
    atendimentos: extrairNumeroAtendimentosWMGJ_Formatacao_(texto)
  };
}

function extrairCompetenciaWMGJ_Formatacao_(texto) {
  var direta = String(texto || '').match(/(20\d{2})[-\/](0[1-9]|1[0-2])/);
  if (direta) return direta[1] + '-' + direta[2];

  var meses = {
    janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04',
    maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
    outubro: '10', novembro: '11', dezembro: '12'
  };

  var lower = String(texto || '').toLowerCase();
  for (var nome in meses) {
    var re = new RegExp(nome + '\\s*(?:de)?\\s*(20\\d{2})', 'i');
    var m = lower.match(re);
    if (m) return m[1] + '-' + meses[nome];
  }

  return '';
}

function extrairValorMonetarioWMGJ_Formatacao_(texto) {
  var matches = String(texto || '').match(/R\$\s*[0-9\.]+,[0-9]{2}/gi) || [];
  if (!matches.length) return 0;

  var maior = 0;
  matches.forEach(function(item) {
    var n = Number(item.replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n) && n > maior) maior = n;
  });

  return maior;
}

function extrairNumeroAtendimentosWMGJ_Formatacao_(texto) {
  var t = String(texto || '');
  var match = t.match(/(\d{1,6})\s+atendimentos?/i) || t.match(/atendimentos?\D+(\d{1,6})/i) || t.match(/quantidade\D+(\d{1,6})/i);
  if (!match) return 0;
  var n = Number(match[1]);
  return isNaN(n) ? 0 : n;
}

function garantirAbaTextoFormatadoWMGJ_() {
  var ss = getPlanilhaWMGJ_Formatacao_();
  var sheet = ss.getSheetByName('17_EXTRACOES_FORMATADAS');
  var cabecalho = [
    'DATA_FORMATACAO', 'VERSAO', 'ID_ORIGEM', 'NOME_ARQUIVO', 'MIME_TYPE',
    'HASH', 'METODO_EXTRACAO', 'TAMANHO_TEXTO', 'STATUS_FORMATACAO',
    'PONTUACAO_QUALIDADE', 'COMPETENCIA_EXTRAIDA', 'VALOR_TOTAL_EXTRAIDO',
    'ATENDIMENTOS_EXTRAIDOS', 'TEXTO_FORMATADO'
  ];

  if (!sheet) sheet = ss.insertSheet('17_EXTRACOES_FORMATADAS');

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function aplicarFormatacaoVisualAbaTextoFormatadoWMGJ_(sheet) {
  if (!sheet) return;

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, Math.min(lastCol, 13));
  sheet.setColumnWidth(14, 650);
  sheet.getRange(1, 14, lastRow, 1).setWrap(true);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top');
}

function carregarChavesFormatadasWMGJ_(sheet) {
  var mapa = {};
  if (!sheet || sheet.getLastRow() < 2) return mapa;

  var dados = sheet.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Formatacao_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var idOrigem = String(dados[i][idx.ID_ORIGEM] || '');
    var hash = String(dados[i][idx.HASH] || '');
    if (idOrigem || hash) mapa[idOrigem + '|' + hash] = true;
  }

  return mapa;
}

function mapearCabecalhoWMGJ_Formatacao_(headers) {
  var mapa = {};
  headers = headers || [];

  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || '').trim();
    if (chave) mapa[chave] = i;
  }

  return mapa;
}

function getPlanilhaWMGJ_Formatacao_() {
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

function registrarLogWMGJ_Formatacao_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
