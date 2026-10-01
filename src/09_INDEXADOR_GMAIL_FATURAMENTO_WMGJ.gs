/**
 * WMGJ — Indexador Gmail de faturamento e documentos fiscais
 * Versão: v1.1.7-indexador-gmail-faturamento
 *
 * Objetivo:
 * - pesquisar no Gmail institucional mensagens com anexos de faturamento;
 * - indexar e classificar e-mails/anexos com heurística + Gemini;
 * - copiar anexos pertinentes para a pasta 99_ARQUIVO_BRUTO_A_CLASSIFICAR;
 * - alimentar o pipeline V3 já estável, sem mexer no núcleo da extração;
 * - registrar tudo em 21_GMAIL_INDEXACAO_FATURAMENTO.
 *
 * Cole este arquivo inteiro em: 09_INDEXADOR_GMAIL_FATURAMENTO_WMGJ
 */

var WMGJ_GMAIL_INDEXADOR_VERSAO = 'v1.1.7-indexador-gmail-faturamento';

function rodarIndexacaoGmailFaturamentoWMGJ_20() {
  return indexarGmailFaturamentoWMGJ({
    limiteThreads: 20,
    executarPipelineDepois: false
  });
}

function rodarIndexacaoGmailFaturamentoWMGJ_100() {
  return indexarGmailFaturamentoWMGJ({
    limiteThreads: 100,
    executarPipelineDepois: false
  });
}

function rodarIndexacaoGmailFaturamentoEProcessarWMGJ_50() {
  return indexarGmailFaturamentoWMGJ({
    limiteThreads: 50,
    executarPipelineDepois: true
  });
}

function rodarDiagnosticoGmailFaturamentoWMGJ() {
  var resultado = {
    ok: true,
    versao: WMGJ_GMAIL_INDEXADOR_VERSAO,
    gmailDisponivel: typeof GmailApp !== 'undefined',
    driveDisponivel: typeof DriveApp !== 'undefined',
    gemini: diagnosticarGeminiGmailWMGJ_(),
    pastaEntrada: obterPastaBrutoAClassificarGmailWMGJ_().getName(),
    pastaEntradaId: obterPastaBrutoAClassificarGmailWMGJ_().getId(),
    abaDestino: '21_GMAIL_INDEXACAO_FATURAMENTO'
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function indexarGmailFaturamentoWMGJ(opcoes) {
  opcoes = opcoes || {};

  var ss = getPlanilhaWMGJ_Gmail_();
  var aba = garantirAbaIndexacaoGmailWMGJ_(ss);
  var pastaEntrada = obterPastaBrutoAClassificarGmailWMGJ_();
  var jaIndexados = carregarChavesGmailJaIndexadasWMGJ_(aba);
  var query = montarQueryGmailFaturamentoWMGJ_(opcoes.query);
  var limiteThreads = Number(opcoes.limiteThreads || 20);

  var threads = GmailApp.search(query, 0, limiteThreads);

  var estat = {
    threadsLidas: threads.length,
    mensagensLidas: 0,
    anexosEncontrados: 0,
    anexosPertinentes: 0,
    copiadosParaBruto: 0,
    duplicados: 0,
    ignorados: 0,
    erros: 0
  };

  threads.forEach(function(thread) {
    var mensagens = thread.getMessages();

    mensagens.forEach(function(msg) {
      estat.mensagensLidas++;

      var anexos = msg.getAttachments({
        includeInlineImages: false,
        includeAttachments: true
      });

      if (!anexos || anexos.length === 0) {
        estat.ignorados++;
        return;
      }

      anexos.forEach(function(anexo) {
        estat.anexosEncontrados++;

        try {
          var meta = montarMetadadosAnexoGmailWMGJ_(thread, msg, anexo);
          var chave = meta.messageId + '|' + meta.attachmentName + '|' + meta.attachmentHash;

          if (jaIndexados[chave]) {
            estat.duplicados++;
            return;
          }

          var classificacao = classificarAnexoGmailFaturamentoWMGJ_(meta);

          if (!classificacao.pertinente) {
            registrarLinhaGmailIndexacaoWMGJ_(aba, meta, classificacao, '', 'IGNORADO_NAO_PERTINENTE', '');
            jaIndexados[chave] = true;
            estat.ignorados++;
            return;
          }

          estat.anexosPertinentes++;

          var arquivo = salvarAnexoGmailNaPastaBrutoWMGJ_(pastaEntrada, meta, anexo, classificacao);
          registrarLinhaGmailIndexacaoWMGJ_(aba, meta, classificacao, arquivo.getId(), 'COPIADO_BRUTO_A_CLASSIFICAR', arquivo.getUrl());

          jaIndexados[chave] = true;
          estat.copiadosParaBruto++;
        } catch (erro) {
          estat.erros++;
          registrarErroGmailIndexacaoWMGJ_(aba, thread, msg, anexo, erro);
        }
      });
    });
  });

  aplicarFormatacaoAbaIndexacaoGmailWMGJ_(aba);

  var pipeline = null;
  if (opcoes.executarPipelineDepois) {
    pipeline = executarPipelineDepoisDaIndexacaoGmailWMGJ_();
  }

  var resultado = {
    ok: estat.erros === 0,
    versao: WMGJ_GMAIL_INDEXADOR_VERSAO,
    query: query,
    pastaEntradaId: pastaEntrada.getId(),
    pastaEntradaNome: pastaEntrada.getName(),
    estatisticas: estat,
    pipeline: pipeline,
    abaDestino: '21_GMAIL_INDEXACAO_FATURAMENTO'
  };

  logGmailIndexadorWMGJ_(resultado.ok ? 'OK' : 'ERRO', 'indexarGmailFaturamentoWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function montarQueryGmailFaturamentoWMGJ_(queryCustom) {
  if (queryCustom) return String(queryCustom);

  return [
    'has:attachment',
    '(' + [
      'faturamento',
      'fatura',
      'nota fiscal',
      'NF-e',
      'NFS-e',
      'nfse',
      'boleto',
      'recibo',
      'pagamento',
      'extrato',
      'demonstrativo',
      'produção médica',
      'producao medica',
      'repasse',
      'honorários',
      'honorarios'
    ].join(' OR ') + ')',
    'newer_than:365d'
  ].join(' ');
}

function montarMetadadosAnexoGmailWMGJ_(thread, msg, anexo) {
  var blob = anexo.copyBlob();
  var bytes = blob.getBytes();
  var hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)).slice(0, 32);

  return {
    threadId: thread.getId(),
    messageId: msg.getId(),
    dataEmail: msg.getDate(),
    remetente: msg.getFrom(),
    destinatario: msg.getTo(),
    assunto: msg.getSubject(),
    corpoAmostra: limparTextoGmailWMGJ_(msg.getPlainBody()).slice(0, 1200),
    attachmentName: anexo.getName() || 'anexo_sem_nome',
    attachmentMime: anexo.getContentType() || blob.getContentType() || '',
    attachmentSize: bytes.length,
    attachmentHash: hash
  };
}

function classificarAnexoGmailFaturamentoWMGJ_(meta) {
  var heuristica = classificarPorHeuristicaGmailWMGJ_(meta);
  var gemini = chamarGeminiClassificacaoGmailWMGJ_(meta, heuristica);

  if (gemini && gemini.ok && gemini.classificacao) {
    var c = gemini.classificacao;
    return {
      origem: 'GEMINI',
      pertinente: Boolean(c.pertinente),
      categoria: String(c.categoria || heuristica.categoria || 'OUTROS'),
      tipoDocumento: String(c.tipoDocumento || heuristica.tipoDocumento || ''),
      competencia: String(c.competencia || heuristica.competencia || ''),
      fornecedor: String(c.fornecedor || ''),
      valor: Number(c.valor || 0),
      confianca: Number(c.confianca || heuristica.confianca || 0),
      justificativa: String(c.justificativa || ''),
      brutoGemini: gemini.texto || ''
    };
  }

  return heuristica;
}

function classificarPorHeuristicaGmailWMGJ_(meta) {
  var alvo = [meta.assunto, meta.corpoAmostra, meta.attachmentName, meta.attachmentMime].join('\n').toLowerCase();
  var pontos = 0;
  var categoria = 'OUTROS';
  var tipo = '';

  if (/nota fiscal|nf-e|nfs-e|nfse|danfe|xml/.test(alvo)) {
    pontos += 40;
    categoria = 'FISCAL';
    tipo = 'NOTA_FISCAL';
  }

  if (/faturamento|fatura|invoice|honor[aá]rios|honorarios|repasse|produção médica|producao medica/.test(alvo)) {
    pontos += 35;
    categoria = categoria === 'OUTROS' ? 'FATURAMENTO' : categoria;
    tipo = tipo || 'FATURAMENTO';
  }

  if (/boleto|recibo|pagamento|comprovante/.test(alvo)) {
    pontos += 30;
    categoria = categoria === 'OUTROS' ? 'FINANCEIRO' : categoria;
    tipo = tipo || 'PAGAMENTO_RECIBO';
  }

  if (/extrato|conta corrente|saldo|bradesco|itau|itaú|santander/.test(alvo)) {
    pontos += 30;
    categoria = categoria === 'OUTROS' ? 'BANCARIO' : categoria;
    tipo = tipo || 'EXTRATO_BANCARIO';
  }

  if (/pdf|spreadsheet|excel|sheet|image|jpeg|png|xml|zip/.test(alvo)) pontos += 15;
  if (meta.attachmentSize > 0) pontos += 10;

  var competencia = extrairCompetenciaGmailWMGJ_(alvo, meta.dataEmail);
  var valor = extrairValorGmailWMGJ_(alvo);

  return {
    origem: 'HEURISTICA',
    pertinente: pontos >= 35,
    categoria: categoria,
    tipoDocumento: tipo,
    competencia: competencia,
    fornecedor: '',
    valor: valor,
    confianca: Math.min(pontos, 95),
    justificativa: 'Classificação inicial por assunto, corpo do e-mail e nome do anexo.',
    brutoGemini: ''
  };
}

function chamarGeminiClassificacaoGmailWMGJ_(meta, heuristica) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('GEMINI_API_KEY');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-1.5-flash';

  if (!apiKey) {
    return { ok: false, erro: 'GEMINI_API_KEY_NAO_CONFIGURADA' };
  }

  var prompt = [
    'Classifique o e-mail/anexo abaixo para pipeline financeiro/operacional da WMGJ.',
    'Responda SOMENTE JSON válido, sem markdown.',
    'Campos obrigatórios:',
    '{',
    '  "pertinente": boolean,',
    '  "categoria": "FISCAL|FATURAMENTO|BANCARIO|FINANCEIRO|OPERACIONAL|OUTROS",',
    '  "tipoDocumento": string,',
    '  "competencia": "YYYY-MM" ou "",',
    '  "fornecedor": string,',
    '  "valor": number,',
    '  "confianca": number de 0 a 100,',
    '  "justificativa": string curta',
    '}',
    '',
    'Heurística inicial: ' + JSON.stringify(heuristica),
    'Assunto: ' + meta.assunto,
    'Remetente: ' + meta.remetente,
    'Data: ' + meta.dataEmail,
    'Anexo: ' + meta.attachmentName,
    'MIME: ' + meta.attachmentMime,
    'Tamanho: ' + meta.attachmentSize,
    'Corpo amostra: ' + meta.corpoAmostra
  ].join('\n');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 700
    }
  };

  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    });

    var code = resp.getResponseCode();
    var text = resp.getContentText();
    if (code < 200 || code >= 300) {
      return { ok: false, erro: 'GEMINI_HTTP_' + code, detalhe: text.slice(0, 500) };
    }

    var json = JSON.parse(text);
    var saida = (((json.candidates || [])[0] || {}).content || {}).parts || [];
    var texto = saida.map(function(p) { return p.text || ''; }).join('\n').trim();
    var limpo = limparJsonGeminiGmailWMGJ_(texto);

    return {
      ok: true,
      texto: texto,
      classificacao: JSON.parse(limpo)
    };
  } catch (erro) {
    return { ok: false, erro: erro && erro.message ? erro.message : String(erro) };
  }
}

function salvarAnexoGmailNaPastaBrutoWMGJ_(pasta, meta, anexo, classificacao) {
  var blob = anexo.copyBlob();
  var nomeSeguro = montarNomeArquivoBrutoGmailWMGJ_(meta, classificacao);
  blob.setName(nomeSeguro);

  var arquivo = pasta.createFile(blob);
  arquivo.setDescription([
    'Origem: Gmail institucional WMGJ',
    'Versão: ' + WMGJ_GMAIL_INDEXADOR_VERSAO,
    'MessageId: ' + meta.messageId,
    'ThreadId: ' + meta.threadId,
    'Assunto: ' + meta.assunto,
    'Remetente: ' + meta.remetente,
    'Categoria: ' + classificacao.categoria,
    'Tipo: ' + classificacao.tipoDocumento,
    'Competência: ' + classificacao.competencia,
    'Hash: ' + meta.attachmentHash
  ].join('\n'));

  return arquivo;
}

function montarNomeArquivoBrutoGmailWMGJ_(meta, classificacao) {
  var data = Utilities.formatDate(meta.dataEmail, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var cat = normalizarNomeArquivoGmailWMGJ_(classificacao.categoria || 'OUTROS');
  var tipo = normalizarNomeArquivoGmailWMGJ_(classificacao.tipoDocumento || 'DOCUMENTO');
  var nome = normalizarNomeArquivoGmailWMGJ_(meta.attachmentName || 'anexo');
  var hash = String(meta.attachmentHash || '').slice(0, 10);

  return ['GMAIL', data, cat, tipo, hash, nome].join('__');
}

function registrarLinhaGmailIndexacaoWMGJ_(aba, meta, classificacao, arquivoId, status, url) {
  aba.appendRow([
    new Date(),
    WMGJ_GMAIL_INDEXADOR_VERSAO,
    status,
    meta.dataEmail,
    meta.threadId,
    meta.messageId,
    meta.remetente,
    meta.destinatario,
    meta.assunto,
    meta.attachmentName,
    meta.attachmentMime,
    meta.attachmentSize,
    meta.attachmentHash,
    classificacao.origem,
    classificacao.pertinente,
    classificacao.categoria,
    classificacao.tipoDocumento,
    classificacao.competencia,
    classificacao.fornecedor,
    classificacao.valor,
    classificacao.confianca,
    classificacao.justificativa,
    arquivoId,
    url,
    classificacao.brutoGemini || ''
  ]);
}

function registrarErroGmailIndexacaoWMGJ_(aba, thread, msg, anexo, erro) {
  aba.appendRow([
    new Date(),
    WMGJ_GMAIL_INDEXADOR_VERSAO,
    'ERRO',
    msg ? msg.getDate() : '',
    thread ? thread.getId() : '',
    msg ? msg.getId() : '',
    msg ? msg.getFrom() : '',
    msg ? msg.getTo() : '',
    msg ? msg.getSubject() : '',
    anexo ? anexo.getName() : '',
    anexo ? anexo.getContentType() : '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    erro && erro.message ? erro.message : String(erro),
    '',
    '',
    ''
  ]);
}

function garantirAbaIndexacaoGmailWMGJ_(ss) {
  var nome = '21_GMAIL_INDEXACAO_FATURAMENTO';
  var sheet = ss.getSheetByName(nome);
  var cabecalho = [
    'DATA_INDEXACAO', 'VERSAO', 'STATUS', 'DATA_EMAIL', 'THREAD_ID', 'MESSAGE_ID',
    'REMETENTE', 'DESTINATARIO', 'ASSUNTO', 'ANEXO_NOME', 'ANEXO_MIME',
    'ANEXO_TAMANHO', 'ANEXO_HASH', 'CLASSIFICADOR', 'PERTINENTE', 'CATEGORIA',
    'TIPO_DOCUMENTO', 'COMPETENCIA', 'FORNECEDOR', 'VALOR', 'CONFIANCA',
    'JUSTIFICATIVA', 'ARQUIVO_DRIVE_ID', 'ARQUIVO_DRIVE_URL', 'GEMINI_BRUTO'
  ];

  if (!sheet) sheet = ss.insertSheet(nome);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function carregarChavesGmailJaIndexadasWMGJ_(aba) {
  var mapa = {};
  if (!aba || aba.getLastRow() < 2) return mapa;

  var dados = aba.getDataRange().getValues();
  var idx = mapearCabecalhoGmailWMGJ_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var chave = [
      dados[i][idx.MESSAGE_ID],
      dados[i][idx.ANEXO_NOME],
      dados[i][idx.ANEXO_HASH]
    ].join('|');
    mapa[chave] = true;
  }

  return mapa;
}

function aplicarFormatacaoAbaIndexacaoGmailWMGJ_(sheet) {
  if (!sheet) return;

  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.autoResizeColumns(1, Math.min(lastCol, 22));
  sheet.setColumnWidth(9, 360);
  sheet.setColumnWidth(22, 420);
  sheet.setColumnWidth(24, 420);
  sheet.setColumnWidth(25, 500);

  if (lastRow > 1) {
    sheet.getRange(2, 20, lastRow - 1, 1).setNumberFormat('R$ #,##0.00');
  }
}

function executarPipelineDepoisDaIndexacaoGmailWMGJ_() {
  if (typeof rodarCicloFinanceiroDocumentalWMGJ === 'function') {
    return rodarCicloFinanceiroDocumentalWMGJ();
  }

  if (typeof executarCicloFinanceiroDocumentalWMGJ === 'function') {
    return executarCicloFinanceiroDocumentalWMGJ({
      limiteExtracao: 10,
      limiteFormatacao: 20,
      limiteParser: 20
    });
  }

  if (typeof executarExtracaoRealWMGJ_V1 === 'function') {
    return executarExtracaoRealWMGJ_V1(10);
  }

  return { ok: false, erro: 'PIPELINE_NAO_ENCONTRADO' };
}

function obterPastaBrutoAClassificarGmailWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WMGJ_PASTA_ENTRADA_ID') || props.getProperty('PASTA_ENTRADA_ID');

  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (erroId) {}
  }

  var nome = '99_ARQUIVO_BRUTO_A_CLASSIFICAR';
  var pastas = DriveApp.getFoldersByName(nome);
  if (pastas.hasNext()) {
    var pastaExistente = pastas.next();
    props.setProperty('WMGJ_PASTA_ENTRADA_ID', pastaExistente.getId());
    return pastaExistente;
  }

  var nova = DriveApp.createFolder(nome);
  props.setProperty('WMGJ_PASTA_ENTRADA_ID', nova.getId());
  return nova;
}

function diagnosticarGeminiGmailWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  return {
    configurado: Boolean(props.getProperty('GEMINI_API_KEY')),
    modelo: props.getProperty('GEMINI_MODEL') || 'gemini-1.5-flash'
  };
}

function extrairCompetenciaGmailWMGJ_(texto, dataFallback) {
  texto = String(texto || '').toLowerCase();

  var direto = texto.match(/(20\d{2})[-_\/](0[1-9]|1[0-2])/);
  if (direto) return direto[1] + '-' + direto[2];

  var meses = {
    janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
    julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };

  for (var nome in meses) {
    var re = new RegExp(nome + '\\s*(?:de)?\\s*(20\\d{2})', 'i');
    var m = texto.match(re);
    if (m) return m[1] + '-' + meses[nome];
  }

  if (dataFallback) {
    return Utilities.formatDate(dataFallback, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  return '';
}

function extrairValorGmailWMGJ_(texto) {
  var matches = String(texto || '').match(/R\$\s*[0-9\.]+,[0-9]{2}/gi) || [];
  if (!matches.length) return 0;

  var maior = 0;
  matches.forEach(function(item) {
    var n = Number(item.replace(/R\$\s*/i, '').replace(/\./g, '').replace(',', '.'));
    if (!isNaN(n) && n > maior) maior = n;
  });

  return maior;
}

function limparJsonGeminiGmailWMGJ_(texto) {
  return String(texto || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function limparTextoGmailWMGJ_(texto) {
  return String(texto || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizarNomeArquivoGmailWMGJ_(texto) {
  return String(texto || '')
    .replace(/[áàâã]/gi, 'a')
    .replace(/[éê]/gi, 'e')
    .replace(/[í]/gi, 'i')
    .replace(/[óôõ]/gi, 'o')
    .replace(/[ú]/gi, 'u')
    .replace(/[ç]/gi, 'c')
    .replace(/[^a-z0-9\.\-_]+/gi, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function mapearCabecalhoGmailWMGJ_(headers) {
  var mapa = {};
  headers = headers || [];
  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || '').trim();
    if (chave) mapa[chave] = i;
  }
  return mapa;
}

function getPlanilhaWMGJ_Gmail_() {
  if (typeof getPlanilhaWMGJ_Relatorio_ === 'function') {
    try {
      var rel = getPlanilhaWMGJ_Relatorio_();
      if (rel) return rel;
    } catch (erroRel) {}
  }

  if (typeof getPlanilhaWMGJ_Parser_ === 'function') {
    try {
      var parser = getPlanilhaWMGJ_Parser_();
      if (parser) return parser;
    } catch (erroParser) {}
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

function logGmailIndexadorWMGJ_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
