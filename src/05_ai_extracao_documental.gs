/**
 * WMGJ - Compatibilidade da camada AI/OCR antiga
 *
 * A camada documental oficial é:
 *   04_EXTRACAO_DOCUMENTAL_WMGJ.gs
 *
 * O classificador oficial é:
 *   05_GEMINI_CLASSIFICADOR_WMGJ.gs
 *
 * Este arquivo permanece apenas para compatibilidade com chamadas antigas.
 * Ele NÃO deve duplicar lógica Gemini nem criar gravação paralela.
 */

var WMGJ_AI_STATUS = {
  versaoBase: 'v1.0.1-pipeline-estavel',
  camada: 'AI_OCR_COMPAT_LAYER',
  status: 'DELEGADO_PARA_EXTRACAO_OFICIAL'
};

function processarDocumentoComAI_WMGJ_V1(itemFila) {
  try {
    validarItemFilaAI_WMGJ_(itemFila);

    var fileId = itemFila.arquivo_id || itemFila.fileId;
    var file = DriveApp.getFileById(fileId);

    var extracao;
    if (typeof extrairConteudoArquivoWMGJ_V1_ === 'function') {
      extracao = extrairConteudoArquivoWMGJ_V1_(file);
    } else {
      extracao = {
        texto: extrairTextoDocumento_WMGJ_(itemFila),
        metodo: 'compat_texto_basico',
        nome: file.getName(),
        mimeType: file.getMimeType()
      };
    }

    var classificacao;
    if (typeof classificarDocumentoGeminiWMGJ_V1 === 'function') {
      classificacao = classificarDocumentoGeminiWMGJ_V1(extracao, file);
    } else {
      classificacao = classificarConteudoGemini_WMGJ_(extracao.texto || '', itemFila);
    }

    var jsonValidado = validarJsonClassificacao_WMGJ_(classificacao, itemFila);
    registrarClassificacaoMemoriaBase_WMGJ_(jsonValidado, itemFila);

    return {
      ok: true,
      status: 'AI_PROCESSADO_COMPAT',
      arquivo_id: fileId,
      categoria: jsonValidado.categoria || 'outro',
      confianca: jsonValidado.confianca || 0,
      origem: WMGJ_AI_STATUS.camada
    };
  } catch (erro) {
    return {
      ok: false,
      status: 'AI_ERRO_COMPAT',
      erro: erro && erro.message ? erro.message : String(erro),
      arquivo_id: itemFila && (itemFila.arquivo_id || itemFila.fileId) || ''
    };
  }
}

function validarItemFilaAI_WMGJ_(itemFila) {
  if (!itemFila) {
    throw new Error('Item de fila ausente para processamento AI/OCR.');
  }

  var fileId = itemFila.arquivo_id || itemFila.fileId;
  if (!fileId) {
    throw new Error('Item de fila sem arquivo_id/fileId.');
  }

  return true;
}

function extrairTextoDocumento_WMGJ_(itemFila) {
  var fileId = itemFila.arquivo_id || itemFila.fileId;
  var file = DriveApp.getFileById(fileId);
  var mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(fileId).getBody().getText();
  }

  if (mimeType === MimeType.PLAIN_TEXT || mimeType === 'text/plain' || mimeType.indexOf('text/') === 0) {
    return file.getBlob().getDataAsString('UTF-8');
  }

  return '[OCR_DELEGADO] Tipo de arquivo tratado pela camada oficial quando disponível: ' + mimeType;
}

function classificarConteudoGemini_WMGJ_(conteudoDocumento, itemFila) {
  if (typeof chamarGeminiWMGJ === 'function') {
    var prompt = montarPromptClassificacaoWMGJ_(conteudoDocumento, itemFila);
    var resposta = chamarGeminiWMGJ(prompt);
    return JSON.parse(limparRespostaJsonWMGJ_CompatAI_(resposta));
  }

  throw new Error('Classificador Gemini oficial ausente: chamarGeminiWMGJ não encontrado.');
}

function montarPromptClassificacaoWMGJ_(conteudoDocumento, itemFila) {
  return [
    'Você é o agente operacional WMGJ.',
    'Analise o documento e retorne APENAS JSON válido.',
    'Categorias permitidas: financeiro, produtividade, contrato, glosa, relatorio, cadastro, outro.',
    'Retorne campos: categoria, tipo_documento, data_documento, competencia, valor_total, nome_prestador, cnpj, medico, paciente, descricao, pendencias, nivel_risco, resumo_operacional, destino_drive, aba_planilha_destino, confianca.',
    'Metadados do arquivo:',
    JSON.stringify(itemFila || {}),
    'Documento:',
    String(conteudoDocumento || '').slice(0, 24000)
  ].join('\n');
}

function validarJsonClassificacao_WMGJ_(json, itemFila) {
  if (!json || typeof json !== 'object') {
    throw new Error('Classificação AI inválida: JSON ausente.');
  }

  var categoriasValidas = ['financeiro', 'produtividade', 'contrato', 'glosa', 'relatorio', 'relatório', 'cadastro', 'outro'];

  if (!json.categoria || categoriasValidas.indexOf(json.categoria) === -1) {
    json.categoria = 'outro';
  }

  if (json.categoria === 'relatório') {
    json.categoria = 'relatorio';
  }

  if (typeof json.confianca !== 'number') {
    json.confianca = Number(json.confianca) || 0;
  }

  json.arquivo_id = itemFila.arquivo_id || itemFila.fileId || '';
  json.arquivo_nome = itemFila.arquivo_nome || itemFila.name || '';
  json.processado_em = new Date().toISOString();
  json.origem_processamento = 'AI_OCR_COMPAT_LAYER_V1';

  return json;
}

function registrarClassificacaoMemoriaBase_WMGJ_(jsonValidado, itemFila) {
  if (typeof registrarStatusAutomacaoWMGJ_ === 'function') {
    registrarStatusAutomacaoWMGJ_({
      ok: true,
      versao: WMGJ_AI_STATUS.camada,
      etapa: 'registrarClassificacaoMemoriaBase_WMGJ_compat',
      classificacao: jsonValidado,
      itemFila: itemFila
    });
    return;
  }

  Logger.log(JSON.stringify({
    status: 'CLASSIFICACAO_COMPAT_VALIDADA_NAO_GRAVADA',
    data: jsonValidado
  }));
}

function limparRespostaJsonWMGJ_CompatAI_(texto) {
  texto = String(texto || '').trim();
  texto = texto.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return texto;
}
