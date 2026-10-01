/**
 * WMGJ — Relatório executivo automático para sócios
 * Versão: v1.1.6-relatorio-executivo-socios
 *
 * Objetivo:
 * - ler o resumo financeiro mensal consolidado;
 * - ler lançamentos financeiros extraídos;
 * - ler status das bases operacionais do pipeline;
 * - gerar Google Docs e PDF didático para apresentação aos sócios;
 * - registrar o link do relatório em aba própria.
 *
 * Cole este arquivo inteiro em: 08_RELATORIO_EXECUTIVO_SOCIOS_WMGJ
 */

var WMGJ_RELATORIO_SOCIOS_VERSAO = 'v1.1.6-relatorio-executivo-socios';

function rodarRelatorioExecutivoSociosWMGJ() {
  return gerarRelatorioExecutivoSociosWMGJ({
    competencia: '',
    incluirLancamentos: true,
    limiteLancamentos: 30
  });
}

function rodarRelatorioExecutivoSociosWMGJ_Abril2026() {
  return gerarRelatorioExecutivoSociosWMGJ({
    competencia: '2026-04',
    incluirLancamentos: true,
    limiteLancamentos: 50
  });
}

function gerarRelatorioExecutivoSociosWMGJ(opcoes) {
  opcoes = opcoes || {};

  var ss = getPlanilhaWMGJ_Relatorio_();
  var competencia = String(opcoes.competencia || '').trim();
  var base = montarBaseRelatorioExecutivoWMGJ_(ss, competencia, Number(opcoes.limiteLancamentos || 30));

  if (!base.competencia && base.resumos.length > 0) {
    base.competencia = base.resumos[base.resumos.length - 1].competencia;
  }

  var doc = criarDocumentoRelatorioSociosWMGJ_(base, opcoes);
  var pdf = exportarDocumentoRelatorioSociosPDFWMGJ_(doc, base);
  var registro = registrarRelatorioExecutivoGeradoWMGJ_(base, doc, pdf);

  var resultado = {
    ok: true,
    versao: WMGJ_RELATORIO_SOCIOS_VERSAO,
    competencia: base.competencia || 'consolidado',
    documentoUrl: doc.getUrl(),
    pdfUrl: pdf.getUrl(),
    pdfId: pdf.getId(),
    registro: registro,
    statusExecutivo: base.statusExecutivo
  };

  logRelatorioSociosWMGJ_('OK', 'gerarRelatorioExecutivoSociosWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function montarBaseRelatorioExecutivoWMGJ_(ss, competenciaFiltro, limiteLancamentos) {
  var resumos = lerResumoFinanceiroMensalWMGJ_(ss);
  var lancamentos = lerLancamentosFinanceirosWMGJ_(ss, competenciaFiltro, limiteLancamentos || 30);
  var statusPipeline = lerStatusPipelineRelatorioWMGJ_(ss);
  var memoria = lerResumoMemoriaDocumentosWMGJ_(ss);

  if (competenciaFiltro) {
    resumos = resumos.filter(function(r) { return r.competencia === competenciaFiltro; });
  }

  var consolidado = consolidarNumerosRelatorioSociosWMGJ_(resumos);

  return {
    competencia: competenciaFiltro || '',
    geradoEm: new Date(),
    resumos: resumos,
    lancamentos: lancamentos,
    statusPipeline: statusPipeline,
    memoria: memoria,
    consolidado: consolidado,
    statusExecutivo: montarStatusExecutivoRelatorioSociosWMGJ_(consolidado, statusPipeline, memoria)
  };
}

function criarDocumentoRelatorioSociosWMGJ_(base, opcoes) {
  var titulo = 'WMGJ — Relatório Executivo para Sócios';
  if (base.competencia) titulo += ' — ' + base.competencia;

  var doc = DocumentApp.create(titulo);
  var body = doc.getBody();

  body.clear();

  body.appendParagraph('WMGJ').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('Relatório Executivo Automático para Sócios').setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  body.appendParagraph('Competência: ' + (base.competencia || 'Consolidado disponível'));
  body.appendParagraph('Gerado em: ' + Utilities.formatDate(base.geradoEm, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
  body.appendParagraph('Versão: ' + WMGJ_RELATORIO_SOCIOS_VERSAO);

  body.appendParagraph('1. Resumo executivo').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(base.statusExecutivo.mensagem);

  body.appendParagraph('Indicadores principais').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  inserirTabelaIndicadoresWMGJ_(body, [
    ['Indicador', 'Valor'],
    ['Total de créditos', formatarMoedaBRWMGJ_(base.consolidado.totalCreditos)],
    ['Total de débitos', formatarMoedaBRWMGJ_(base.consolidado.totalDebitos)],
    ['Resultado líquido', formatarMoedaBRWMGJ_(base.consolidado.resultadoLiquido)],
    ['Valor indefinido para revisão', formatarMoedaBRWMGJ_(base.consolidado.valorIndefinido)],
    ['Lançamentos financeiros', String(base.consolidado.qtdLancamentos)],
    ['Itens a revisar', String(base.consolidado.qtdRevisar)],
    ['Documentos na memória-base', String(base.memoria.totalDocumentos)],
    ['Documentos processados', String(base.memoria.processados)]
  ]);

  body.appendParagraph('2. Resultado financeiro mensal').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (base.resumos.length === 0) {
    body.appendParagraph('Não há resumo financeiro mensal consolidado para a competência selecionada. O sistema está pronto, mas os dados estruturados ainda não chegaram nessa etapa. Humano inventou pipeline, pipeline pediu alimento.');
  } else {
    var linhasResumo = [[
      'Competência', 'Créditos', 'Débitos', 'Resultado líquido', 'Indefinido', 'Lançamentos', 'Revisar'
    ]];

    base.resumos.forEach(function(r) {
      linhasResumo.push([
        r.competencia,
        formatarMoedaBRWMGJ_(r.totalCreditos),
        formatarMoedaBRWMGJ_(r.totalDebitos),
        formatarMoedaBRWMGJ_(r.resultadoLiquido),
        formatarMoedaBRWMGJ_(r.valorIndefinido),
        String(r.qtdLancamentos),
        String(r.qtdRevisar)
      ]);
    });

    inserirTabelaIndicadoresWMGJ_(body, linhasResumo);
  }

  body.appendParagraph('3. Lançamentos financeiros extraídos').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (!opcoes.incluirLancamentos || base.lancamentos.length === 0) {
    body.appendParagraph('Sem lançamentos financeiros detalhados para exibir neste relatório.');
  } else {
    var linhasLancamentos = [[
      'Data', 'Descrição', 'Tipo', 'Valor', 'Status'
    ]];

    base.lancamentos.forEach(function(l) {
      linhasLancamentos.push([
        l.dataLancamento,
        limitarTextoWMGJ_(l.descricao, 90),
        l.tipo,
        formatarMoedaBRWMGJ_(l.valor),
        l.statusParse
      ]);
    });

    inserirTabelaIndicadoresWMGJ_(body, linhasLancamentos);
  }

  body.appendParagraph('4. Status operacional do pipeline').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  inserirTabelaIndicadoresWMGJ_(body, [
    ['Componente', 'Status'],
    ['Extração OCR/Gemini', base.statusPipeline.extracao],
    ['Formatação do texto', base.statusPipeline.formatacao],
    ['Parser financeiro', base.statusPipeline.parser],
    ['Resumo mensal', base.statusPipeline.resumo],
    ['Memória-base', base.statusPipeline.memoria],
    ['Log de automação', base.statusPipeline.log]
  ]);

  body.appendParagraph('5. Leitura executiva').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(base.statusExecutivo.leituraExecutiva);

  body.appendParagraph('6. Próximas ações recomendadas').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var lista = body.appendListItem('Revisar lançamentos marcados como PARSE_REVISAR antes de usar o resultado como contabilidade final.');
  lista.setGlyphType(DocumentApp.GlyphType.BULLET);
  body.appendListItem('Separar créditos, débitos e valores indefinidos por competência.').setGlyphType(DocumentApp.GlyphType.BULLET);
  body.appendListItem('Conferir extratos bancários adicionais para reduzir lacunas de fluxo de caixa.').setGlyphType(DocumentApp.GlyphType.BULLET);
  body.appendListItem('Após validação humana mínima, publicar o PDF aos sócios como relatório mensal automático.').setGlyphType(DocumentApp.GlyphType.BULLET);

  body.appendParagraph('Observação técnica').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Este relatório foi gerado automaticamente a partir das abas 18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS e 19_RESUMO_FINANCEIRO_MENSAL, usando o pipeline V3 com extração documental v1.1.2, formatação v1.1.3 e parser financeiro v1.1.4.');

  aplicarEstiloDocumentoRelatorioWMGJ_(body);
  doc.saveAndClose();

  return doc;
}

function exportarDocumentoRelatorioSociosPDFWMGJ_(doc, base) {
  var pasta = obterPastaRelatoriosSociosWMGJ_();
  var nome = 'WMGJ_Relatorio_Executivo_Socios_' + (base.competencia || 'Consolidado') + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.pdf';
  var blob = DriveApp.getFileById(doc.getId()).getBlob().getAs(MimeType.PDF).setName(nome);
  var pdf = pasta.createFile(blob);
  return pdf;
}

function registrarRelatorioExecutivoGeradoWMGJ_(base, doc, pdf) {
  var ss = getPlanilhaWMGJ_Relatorio_();
  var sheet = garantirAbaRelatoriosGeradosWMGJ_(ss);

  var linha = [
    new Date(),
    WMGJ_RELATORIO_SOCIOS_VERSAO,
    base.competencia || 'CONSOLIDADO',
    base.consolidado.totalCreditos,
    base.consolidado.totalDebitos,
    base.consolidado.resultadoLiquido,
    base.consolidado.qtdLancamentos,
    base.consolidado.qtdRevisar,
    base.statusExecutivo.status,
    doc.getUrl(),
    pdf.getUrl(),
    pdf.getId()
  ];

  sheet.appendRow(linha);
  aplicarFormatacaoRelatoriosGeradosWMGJ_(sheet);

  return {
    aba: '20_RELATORIOS_EXECUTIVOS_GERADOS',
    linha: sheet.getLastRow()
  };
}

function lerResumoFinanceiroMensalWMGJ_(ss) {
  var sheet = ss.getSheetByName('19_RESUMO_FINANCEIRO_MENSAL');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var dados = sheet.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Relatorio_(dados[0]);
  var itens = [];

  for (var i = 1; i < dados.length; i++) {
    itens.push({
      competencia: String(dados[i][idx.COMPETENCIA] || ''),
      totalCreditos: Number(dados[i][idx.TOTAL_CREDITOS] || 0),
      totalDebitos: Number(dados[i][idx.TOTAL_DEBITOS] || 0),
      resultadoLiquido: Number(dados[i][idx.RESULTADO_LIQUIDO] || 0),
      valorIndefinido: Number(dados[i][idx.VALOR_INDEFINIDO] || 0),
      qtdLancamentos: Number(dados[i][idx.QTD_LANCAMENTOS] || 0),
      qtdRevisar: Number(dados[i][idx.QTD_REVISAR] || 0)
    });
  }

  return itens;
}

function lerLancamentosFinanceirosWMGJ_(ss, competenciaFiltro, limite) {
  var sheet = ss.getSheetByName('18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var dados = sheet.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Relatorio_(dados[0]);
  var itens = [];

  for (var i = dados.length - 1; i >= 1 && itens.length < limite; i--) {
    var competencia = String(dados[i][idx.COMPETENCIA] || '');
    if (competenciaFiltro && competencia !== competenciaFiltro) continue;

    itens.push({
      dataLancamento: String(dados[i][idx.DATA_LANCAMENTO] || ''),
      competencia: competencia,
      descricao: String(dados[i][idx.DESCRICAO] || ''),
      tipo: String(dados[i][idx.TIPO] || ''),
      valor: Number(dados[i][idx.VALOR] || 0),
      statusParse: String(dados[i][idx.STATUS_PARSE] || ''),
      confianca: Number(dados[i][idx.CONFIANCA] || 0)
    });
  }

  return itens.reverse();
}

function lerStatusPipelineRelatorioWMGJ_(ss) {
  return {
    extracao: statusAbaWMGJ_(ss, '16_EXTRACOES_DOCUMENTAIS'),
    formatacao: statusAbaWMGJ_(ss, '17_EXTRACOES_FORMATADAS'),
    parser: statusAbaWMGJ_(ss, '18_LANCAMENTOS_FINANCEIROS_EXTRAIDOS'),
    resumo: statusAbaWMGJ_(ss, '19_RESUMO_FINANCEIRO_MENSAL'),
    memoria: statusAbaWMGJ_(ss, '14_MEMORIA_BASE_DOCUMENTOS'),
    log: statusAbaWMGJ_(ss, '10_LOG_AUTOMACAO')
  };
}

function statusAbaWMGJ_(ss, nome) {
  var sheet = ss.getSheetByName(nome);
  if (!sheet) return 'AUSENTE';
  var linhas = sheet.getLastRow();
  if (linhas < 2) return 'CRIADA_SEM_DADOS';
  return 'OK_' + (linhas - 1) + '_REGISTROS';
}

function lerResumoMemoriaDocumentosWMGJ_(ss) {
  var sheet = ss.getSheetByName('14_MEMORIA_BASE_DOCUMENTOS');
  if (!sheet || sheet.getLastRow() < 2) {
    return { totalDocumentos: 0, processados: 0, revisar: 0, outros: 0 };
  }

  var dados = sheet.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Relatorio_(dados[0]);
  var total = 0;
  var processados = 0;
  var revisar = 0;
  var outros = 0;

  for (var i = 1; i < dados.length; i++) {
    total++;
    var status = String(dados[i][idx.STATUS] || '').toUpperCase();
    if (status === 'PROCESSADO') processados++;
    else if (status.indexOf('REVISAR') >= 0) revisar++;
    else outros++;
  }

  return {
    totalDocumentos: total,
    processados: processados,
    revisar: revisar,
    outros: outros
  };
}

function consolidarNumerosRelatorioSociosWMGJ_(resumos) {
  var totalCreditos = 0;
  var totalDebitos = 0;
  var resultadoLiquido = 0;
  var valorIndefinido = 0;
  var qtdLancamentos = 0;
  var qtdRevisar = 0;

  resumos.forEach(function(r) {
    totalCreditos += Number(r.totalCreditos || 0);
    totalDebitos += Number(r.totalDebitos || 0);
    resultadoLiquido += Number(r.resultadoLiquido || 0);
    valorIndefinido += Number(r.valorIndefinido || 0);
    qtdLancamentos += Number(r.qtdLancamentos || 0);
    qtdRevisar += Number(r.qtdRevisar || 0);
  });

  return {
    totalCreditos: totalCreditos,
    totalDebitos: totalDebitos,
    resultadoLiquido: resultadoLiquido,
    valorIndefinido: valorIndefinido,
    qtdLancamentos: qtdLancamentos,
    qtdRevisar: qtdRevisar
  };
}

function montarStatusExecutivoRelatorioSociosWMGJ_(consolidado, statusPipeline, memoria) {
  var status = 'OPERACIONAL_COM_DADOS_PARCIAIS';
  var mensagem = 'O pipeline está operacional e já possui estrutura para consolidação financeira mensal. A contabilidade final ainda depende da revisão dos lançamentos indefinidos ou marcados para revisão.';

  if (consolidado.qtdLancamentos > 0 && consolidado.qtdRevisar === 0 && consolidado.valorIndefinido === 0) {
    status = 'OPERACIONAL_VALIDADO';
    mensagem = 'O pipeline financeiro processou lançamentos, consolidou competência mensal e não identificou pendências relevantes de revisão nos dados estruturados.';
  } else if (consolidado.qtdLancamentos === 0) {
    status = 'OPERACIONAL_SEM_LANCAMENTOS';
    mensagem = 'O pipeline está montado, mas ainda não há lançamentos financeiros estruturados suficientes para conclusão contábil. É necessário validar o parser do extrato e alimentar novos documentos.';
  }

  var leitura = 'Leitura executiva: ' + mensagem + ' Status das bases: extração=' + statusPipeline.extracao + ', formatação=' + statusPipeline.formatacao + ', lançamentos=' + statusPipeline.parser + ', resumo=' + statusPipeline.resumo + ', memória=' + memoria.processados + '/' + memoria.totalDocumentos + ' processados.';

  return {
    status: status,
    mensagem: mensagem,
    leituraExecutiva: leitura
  };
}

function inserirTabelaIndicadoresWMGJ_(body, linhas) {
  var table = body.appendTable(linhas);
  table.setBorderWidth(1);

  if (table.getNumRows() > 0) {
    var header = table.getRow(0);
    for (var i = 0; i < header.getNumCells(); i++) {
      header.getCell(i).setBackgroundColor('#1F2937');
      header.getCell(i).editAsText().setForegroundColor('#FFFFFF').setBold(true);
    }
  }

  return table;
}

function aplicarEstiloDocumentoRelatorioWMGJ_(body) {
  var total = body.getNumChildren();
  for (var i = 0; i < total; i++) {
    var el = body.getChild(i);
    if (el.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var p = el.asParagraph();
      p.setSpacingAfter(8);
      try {
        p.editAsText().setFontFamily('Arial');
      } catch (e) {}
    }
  }
}

function obterPastaRelatoriosSociosWMGJ_() {
  var props = PropertiesService.getScriptProperties();
  var pastaId = props.getProperty('WMGJ_PASTA_RELATORIOS_ID');
  if (pastaId) {
    try {
      return DriveApp.getFolderById(pastaId);
    } catch (erro) {}
  }

  var nome = 'WMGJ_RELATORIOS_EXECUTIVOS_SOCIOS';
  var pastas = DriveApp.getFoldersByName(nome);
  if (pastas.hasNext()) return pastas.next();

  var pasta = DriveApp.createFolder(nome);
  props.setProperty('WMGJ_PASTA_RELATORIOS_ID', pasta.getId());
  return pasta;
}

function garantirAbaRelatoriosGeradosWMGJ_(ss) {
  var sheet = ss.getSheetByName('20_RELATORIOS_EXECUTIVOS_GERADOS');
  var cabecalho = [
    'DATA_GERACAO', 'VERSAO', 'COMPETENCIA', 'TOTAL_CREDITOS', 'TOTAL_DEBITOS',
    'RESULTADO_LIQUIDO', 'QTD_LANCAMENTOS', 'QTD_REVISAR', 'STATUS_EXECUTIVO',
    'DOCUMENTO_URL', 'PDF_URL', 'PDF_ID'
  ];

  if (!sheet) sheet = ss.insertSheet('20_RELATORIOS_EXECUTIVOS_GERADOS');

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function aplicarFormatacaoRelatoriosGeradosWMGJ_(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  if (lastRow > 1) {
    sheet.getRange(2, 4, lastRow - 1, 3).setNumberFormat('R$ #,##0.00');
  }
  sheet.autoResizeColumns(1, Math.min(lastCol, 9));
  sheet.setColumnWidth(10, 360);
  sheet.setColumnWidth(11, 360);
}

function formatarMoedaBRWMGJ_(valor) {
  valor = Number(valor || 0);
  return 'R$ ' + valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function limitarTextoWMGJ_(texto, limite) {
  texto = String(texto || '');
  limite = Number(limite || 80);
  if (texto.length <= limite) return texto;
  return texto.slice(0, limite - 3) + '...';
}

function mapearCabecalhoWMGJ_Relatorio_(headers) {
  var mapa = {};
  headers = headers || [];
  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || '').trim();
    if (chave) mapa[chave] = i;
  }
  return mapa;
}

function getPlanilhaWMGJ_Relatorio_() {
  if (typeof getPlanilhaWMGJ_Parser_ === 'function') {
    try {
      var parser = getPlanilhaWMGJ_Parser_();
      if (parser) return parser;
    } catch (erroParser) {}
  }

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

function logRelatorioSociosWMGJ_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
