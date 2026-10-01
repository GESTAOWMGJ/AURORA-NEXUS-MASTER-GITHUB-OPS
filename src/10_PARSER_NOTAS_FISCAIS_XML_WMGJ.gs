/**
 * WMGJ — Parser de Notas Fiscais XML
 * Versão: v1.1.9-parser-notas-fiscais-xml
 *
 * Objetivo:
 * - ler XMLs de NF-e/NFS-e copiados do Gmail para 99_ARQUIVO_BRUTO_A_CLASSIFICAR;
 * - extrair chave, número, série, emissão, emitente, destinatário, valor e impostos quando disponíveis;
 * - registrar dados estruturados em 22_NOTAS_FISCAIS_EXTRAIDAS;
 * - deduplicar por chave fiscal ou hash do arquivo;
 * - manter a V3 estável sem transformar o pipeline em uma sopa de funções órfãs.
 *
 * Cole este arquivo inteiro em: 10_PARSER_NOTAS_FISCAIS_XML_WMGJ
 */

var WMGJ_PARSER_NF_XML_VERSAO = 'v1.1.9-parser-notas-fiscais-xml';

function rodarParserNotasFiscaisXmlWMGJ_20() {
  return processarNotasFiscaisXmlWMGJ({ limiteArquivos: 20 });
}

function rodarParserNotasFiscaisXmlWMGJ_100() {
  return processarNotasFiscaisXmlWMGJ({ limiteArquivos: 100 });
}

function processarNotasFiscaisXmlWMGJ(opcoes) {
  opcoes = opcoes || {};

  var ss = getPlanilhaWMGJ_NF_();
  var aba = garantirAbaNotasFiscaisExtraidasWMGJ_(ss);
  var pasta = obterPastaBrutoAClassificarNFWMGJ_();
  var jaProcessados = carregarNotasFiscaisJaExtraidasWMGJ_(aba);
  var limite = Number(opcoes.limiteArquivos || 20);

  var arquivos = listarArquivosXmlNotasFiscaisWMGJ_(pasta, limite);

  var estat = {
    avaliados: arquivos.length,
    processados: 0,
    duplicados: 0,
    ignorados: 0,
    erros: 0
  };

  arquivos.forEach(function(file) {
    try {
      var blob = file.getBlob();
      var textoXml = blob.getDataAsString('UTF-8');
      var hash = calcularHashTextoNFWMGJ_(textoXml);
      var dados = extrairDadosNotaFiscalXmlWMGJ_(textoXml, file, hash);
      var chaveDedup = dados.chaveFiscal || hash;

      if (jaProcessados[chaveDedup]) {
        estat.duplicados++;
        return;
      }

      registrarNotaFiscalExtraidaWMGJ_(aba, dados);
      jaProcessados[chaveDedup] = true;
      estat.processados++;
    } catch (erro) {
      estat.erros++;
      registrarErroNotaFiscalXmlWMGJ_(aba, file, erro);
    }
  });

  aplicarFormatacaoNotasFiscaisExtraidasWMGJ_(aba);

  var resultado = {
    ok: estat.erros === 0,
    versao: WMGJ_PARSER_NF_XML_VERSAO,
    pastaEntradaId: pasta.getId(),
    pastaEntradaNome: pasta.getName(),
    estatisticas: estat,
    abaDestino: '22_NOTAS_FISCAIS_EXTRAIDAS'
  };

  logParserNotasFiscaisWMGJ_(resultado.ok ? 'OK' : 'ERRO', 'processarNotasFiscaisXmlWMGJ', JSON.stringify(resultado));
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

function listarArquivosXmlNotasFiscaisWMGJ_(pasta, limite) {
  var arquivos = [];
  var iter = pasta.getFiles();

  while (iter.hasNext() && arquivos.length < limite) {
    var file = iter.next();
    var nome = String(file.getName() || '').toLowerCase();
    var mime = String(file.getMimeType() || '').toLowerCase();

    var pareceXml = nome.indexOf('.xml') >= 0 || mime.indexOf('xml') >= 0;
    var pareceFiscal = /nota|fiscal|nf-e|nfs-e|nfse|danfe|411370|xml/.test(nome);

    if (pareceXml && pareceFiscal) arquivos.push(file);
  }

  return arquivos;
}

function extrairDadosNotaFiscalXmlWMGJ_(textoXml, file, hash) {
  var doc = XmlService.parse(textoXml);
  var root = doc.getRootElement();
  var flat = achatarXmlNotaFiscalWMGJ_(root, '', {});

  var chaveFiscal = extrairChaveFiscalNFWMGJ_(textoXml, flat, file.getName());
  var dataEmissao = valorPrimeiroNFWMGJ_(flat, ['nfeProc.NFe.infNFe.ide.dhEmi', 'NFe.infNFe.ide.dhEmi', 'infNFe.ide.dhEmi', 'nfeProc.NFe.infNFe.ide.dEmi', 'NFe.infNFe.ide.dEmi', 'infNFe.ide.dEmi']);
  var competencia = dataEmissao ? String(dataEmissao).slice(0, 7) : '';

  var valorTotal = numeroNFWMGJ_(valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.total.ICMSTot.vNF',
    'NFe.infNFe.total.ICMSTot.vNF',
    'infNFe.total.ICMSTot.vNF',
    'CompNfse.Nfse.InfNfse.Servico.Valores.ValorServicos',
    'Nfse.InfNfse.Servico.Valores.ValorServicos',
    'InfNfse.Servico.Valores.ValorServicos'
  ]));

  var emitenteNome = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.emit.xNome',
    'NFe.infNFe.emit.xNome',
    'infNFe.emit.xNome',
    'CompNfse.Nfse.InfNfse.PrestadorServico.RazaoSocial',
    'Nfse.InfNfse.PrestadorServico.RazaoSocial'
  ]);

  var emitenteDoc = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.emit.CNPJ',
    'NFe.infNFe.emit.CNPJ',
    'infNFe.emit.CNPJ',
    'nfeProc.NFe.infNFe.emit.CPF',
    'NFe.infNFe.emit.CPF',
    'infNFe.emit.CPF',
    'CompNfse.Nfse.InfNfse.PrestadorServico.IdentificacaoPrestador.Cnpj',
    'Nfse.InfNfse.PrestadorServico.IdentificacaoPrestador.Cnpj'
  ]);

  var destinatarioNome = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.dest.xNome',
    'NFe.infNFe.dest.xNome',
    'infNFe.dest.xNome',
    'CompNfse.Nfse.InfNfse.TomadorServico.RazaoSocial',
    'Nfse.InfNfse.TomadorServico.RazaoSocial'
  ]);

  var destinatarioDoc = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.dest.CNPJ',
    'NFe.infNFe.dest.CNPJ',
    'infNFe.dest.CNPJ',
    'nfeProc.NFe.infNFe.dest.CPF',
    'NFe.infNFe.dest.CPF',
    'infNFe.dest.CPF',
    'CompNfse.Nfse.InfNfse.TomadorServico.IdentificacaoTomador.CpfCnpj.Cnpj',
    'Nfse.InfNfse.TomadorServico.IdentificacaoTomador.CpfCnpj.Cnpj'
  ]);

  var numero = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.ide.nNF',
    'NFe.infNFe.ide.nNF',
    'infNFe.ide.nNF',
    'CompNfse.Nfse.InfNfse.Numero',
    'Nfse.InfNfse.Numero'
  ]);

  var serie = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.ide.serie',
    'NFe.infNFe.ide.serie',
    'infNFe.ide.serie',
    'CompNfse.Nfse.InfNfse.Serie',
    'Nfse.InfNfse.Serie'
  ]);

  var natureza = valorPrimeiroNFWMGJ_(flat, [
    'nfeProc.NFe.infNFe.ide.natOp',
    'NFe.infNFe.ide.natOp',
    'infNFe.ide.natOp',
    'CompNfse.Nfse.InfNfse.Servico.Discriminacao',
    'Nfse.InfNfse.Servico.Discriminacao'
  ]);

  return {
    dataExtracao: new Date(),
    versao: WMGJ_PARSER_NF_XML_VERSAO,
    status: chaveFiscal || numero ? 'OK' : 'REVISAR',
    arquivoId: file.getId(),
    arquivoNome: file.getName(),
    arquivoUrl: file.getUrl(),
    hash: hash,
    chaveFiscal: chaveFiscal,
    tipoDocumento: chaveFiscal ? 'NFE_XML' : 'XML_FISCAL',
    numero: numero,
    serie: serie,
    dataEmissao: dataEmissao,
    competencia: competencia,
    emitenteNome: emitenteNome,
    emitenteDoc: emitenteDoc,
    destinatarioNome: destinatarioNome,
    destinatarioDoc: destinatarioDoc,
    valorTotal: valorTotal,
    natureza: natureza,
    icms: numeroNFWMGJ_(valorPrimeiroNFWMGJ_(flat, ['nfeProc.NFe.infNFe.total.ICMSTot.vICMS', 'NFe.infNFe.total.ICMSTot.vICMS', 'infNFe.total.ICMSTot.vICMS'])),
    pis: numeroNFWMGJ_(valorPrimeiroNFWMGJ_(flat, ['nfeProc.NFe.infNFe.total.ICMSTot.vPIS', 'NFe.infNFe.total.ICMSTot.vPIS', 'infNFe.total.ICMSTot.vPIS'])),
    cofins: numeroNFWMGJ_(valorPrimeiroNFWMGJ_(flat, ['nfeProc.NFe.infNFe.total.ICMSTot.vCOFINS', 'NFe.infNFe.total.ICMSTot.vCOFINS', 'infNFe.total.ICMSTot.vCOFINS'])),
    brutoAmostra: String(textoXml || '').slice(0, 1200)
  };
}

function achatarXmlNotaFiscalWMGJ_(elemento, caminho, mapa) {
  var nome = elemento.getName();
  var novoCaminho = caminho ? caminho + '.' + nome : nome;
  var filhos = elemento.getChildren();

  if (!filhos || filhos.length === 0) {
    mapa[novoCaminho] = elemento.getText();
    return mapa;
  }

  filhos.forEach(function(filho) {
    achatarXmlNotaFiscalWMGJ_(filho, novoCaminho, mapa);
  });

  var attrs = elemento.getAttributes();
  attrs.forEach(function(attr) {
    mapa[novoCaminho + '._' + attr.getName()] = attr.getValue();
  });

  return mapa;
}

function extrairChaveFiscalNFWMGJ_(textoXml, flat, nomeArquivo) {
  var candidatos = [];

  Object.keys(flat).forEach(function(k) {
    if (/_Id$/i.test(k) || /infNFe\._Id$/i.test(k) || /chNFe$/i.test(k)) {
      candidatos.push(String(flat[k] || ''));
    }
  });

  candidatos.push(String(nomeArquivo || ''));
  candidatos.push(String(textoXml || '').slice(0, 5000));

  for (var i = 0; i < candidatos.length; i++) {
    var limpo = candidatos[i].replace(/NFe/g, ' ');
    var m = limpo.match(/\b\d{44}\b/);
    if (m) return m[0];
  }

  return '';
}

function valorPrimeiroNFWMGJ_(flat, caminhos) {
  for (var i = 0; i < caminhos.length; i++) {
    if (flat[caminhos[i]] !== undefined && flat[caminhos[i]] !== null && String(flat[caminhos[i]]).trim() !== '') {
      return String(flat[caminhos[i]]).trim();
    }
  }

  var finais = caminhos.map(function(c) { return c.split('.').pop(); });
  var keys = Object.keys(flat);

  for (var k = 0; k < keys.length; k++) {
    var fim = keys[k].split('.').pop();
    if (finais.indexOf(fim) >= 0 && String(flat[keys[k]] || '').trim() !== '') {
      return String(flat[keys[k]]).trim();
    }
  }

  return '';
}

function numeroNFWMGJ_(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  var txt = String(valor).replace(/\./g, '').replace(',', '.');
  var n = Number(txt);
  if (isNaN(n)) {
    n = Number(String(valor).replace(',', '.'));
  }
  return isNaN(n) ? 0 : n;
}

function registrarNotaFiscalExtraidaWMGJ_(aba, d) {
  aba.appendRow([
    d.dataExtracao,
    d.versao,
    d.status,
    d.arquivoId,
    d.arquivoNome,
    d.arquivoUrl,
    d.hash,
    d.chaveFiscal,
    d.tipoDocumento,
    d.numero,
    d.serie,
    d.dataEmissao,
    d.competencia,
    d.emitenteNome,
    d.emitenteDoc,
    d.destinatarioNome,
    d.destinatarioDoc,
    d.valorTotal,
    d.natureza,
    d.icms,
    d.pis,
    d.cofins,
    d.brutoAmostra
  ]);
}

function registrarErroNotaFiscalXmlWMGJ_(aba, file, erro) {
  aba.appendRow([
    new Date(),
    WMGJ_PARSER_NF_XML_VERSAO,
    'ERRO',
    file ? file.getId() : '',
    file ? file.getName() : '',
    file ? file.getUrl() : '',
    '', '', '', '', '', '', '', '', '', '', '', 0, '', 0, 0, 0,
    erro && erro.message ? erro.message : String(erro)
  ]);
}

function garantirAbaNotasFiscaisExtraidasWMGJ_(ss) {
  var nome = '22_NOTAS_FISCAIS_EXTRAIDAS';
  var sheet = ss.getSheetByName(nome);
  var cabecalho = [
    'DATA_EXTRACAO', 'VERSAO', 'STATUS', 'ARQUIVO_ID', 'ARQUIVO_NOME', 'ARQUIVO_URL',
    'HASH', 'CHAVE_FISCAL', 'TIPO_DOCUMENTO', 'NUMERO', 'SERIE', 'DATA_EMISSAO',
    'COMPETENCIA', 'EMITENTE_NOME', 'EMITENTE_DOC', 'DESTINATARIO_NOME', 'DESTINATARIO_DOC',
    'VALOR_TOTAL', 'NATUREZA', 'ICMS', 'PIS', 'COFINS', 'BRUTO_AMOSTRA'
  ];

  if (!sheet) sheet = ss.insertSheet(nome);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  }

  return sheet;
}

function carregarNotasFiscaisJaExtraidasWMGJ_(aba) {
  var mapa = {};
  if (!aba || aba.getLastRow() < 2) return mapa;

  var dados = aba.getDataRange().getValues();
  var idx = mapearCabecalhoNFWMGJ_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var chave = String(dados[i][idx.CHAVE_FISCAL] || '').trim();
    var hash = String(dados[i][idx.HASH] || '').trim();
    if (chave) mapa[chave] = true;
    if (hash) mapa[hash] = true;
  }

  return mapa;
}

function aplicarFormatacaoNotasFiscaisExtraidasWMGJ_(sheet) {
  if (!sheet) return;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  var lastCol = Math.max(sheet.getLastColumn(), 1);

  sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, lastRow, lastCol).setVerticalAlignment('top').setWrap(true);
  sheet.autoResizeColumns(1, Math.min(lastCol, 18));
  sheet.setColumnWidth(5, 360);
  sheet.setColumnWidth(6, 420);
  sheet.setColumnWidth(19, 420);
  sheet.setColumnWidth(23, 500);

  if (lastRow > 1) {
    sheet.getRange(2, 18, lastRow - 1, 4).setNumberFormat('R$ #,##0.00');
  }
}

function calcularHashTextoNFWMGJ_(texto) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto || ''))
  ).slice(0, 32);
}

function obterPastaBrutoAClassificarNFWMGJ_() {
  if (typeof obterPastaBrutoAClassificarGmailWMGJ_ === 'function') {
    try {
      var p = obterPastaBrutoAClassificarGmailWMGJ_();
      if (p) return p;
    } catch (erroGmail) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WMGJ_PASTA_ENTRADA_ID') || props.getProperty('PASTA_ENTRADA_ID');
  if (id) return DriveApp.getFolderById(id);

  var nome = '99_ARQUIVO_BRUTO_A_CLASSIFICAR';
  var pastas = DriveApp.getFoldersByName(nome);
  if (pastas.hasNext()) return pastas.next();

  var nova = DriveApp.createFolder(nome);
  props.setProperty('WMGJ_PASTA_ENTRADA_ID', nova.getId());
  return nova;
}

function getPlanilhaWMGJ_NF_() {
  if (typeof getPlanilhaWMGJ_Gmail_ === 'function') {
    try {
      var gmail = getPlanilhaWMGJ_Gmail_();
      if (gmail) return gmail;
    } catch (erroGmail) {}
  }

  if (typeof getPlanilhaWMGJ_Relatorio_ === 'function') {
    try {
      var rel = getPlanilhaWMGJ_Relatorio_();
      if (rel) return rel;
    } catch (erroRel) {}
  }

  if (typeof getPlanilhaWMGJ_Compat_ === 'function') {
    try {
      var compat = getPlanilhaWMGJ_Compat_();
      if (compat) return compat;
    } catch (erroCompat) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('WMGJ_SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) throw new Error('PLANILHA_NAO_ENCONTRADA');
  return ativa;
}

function mapearCabecalhoNFWMGJ_(headers) {
  var mapa = {};
  headers = headers || [];
  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || '').trim();
    if (chave) mapa[chave] = i;
  }
  return mapa;
}

function logParserNotasFiscaisWMGJ_(status, funcao, mensagem) {
  if (typeof registrarLogWMGJ_Compat_ === 'function') {
    registrarLogWMGJ_Compat_(status, funcao, 'AppsScript', mensagem);
    return;
  }

  Logger.log([status, funcao, mensagem].join(' | '));
}
