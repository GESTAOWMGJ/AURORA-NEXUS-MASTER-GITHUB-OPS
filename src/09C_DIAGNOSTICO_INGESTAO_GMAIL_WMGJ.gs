/**
 * AURORA M01/M08/M10: diagnóstico somente leitura de uma mensagem.
 * Não é executor de replay; schema misto exige reconciliação preservando histórico.
 */
function cabecalhoCanonicoIndiceGmailWMGJ_() {
  return [
    'DATA_INDEXACAO', 'VERSAO', 'STATUS', 'DATA_EMAIL', 'THREAD_ID', 'MESSAGE_ID',
    'REMETENTE', 'DESTINATARIO', 'ASSUNTO', 'ANEXO_NOME', 'ANEXO_MIME',
    'ANEXO_TAMANHO', 'ANEXO_HASH', 'CLASSIFICADOR', 'PERTINENTE', 'CATEGORIA',
    'TIPO_DOCUMENTO', 'COMPETENCIA', 'FORNECEDOR', 'VALOR', 'CONFIANCA',
    'JUSTIFICATIVA', 'ARQUIVO_DRIVE_ID', 'ARQUIVO_DRIVE_URL', 'GEMINI_BRUTO'
  ];
}

function inspecionarIndiceGmailWMGJ_(dados) {
  var esperado = cabecalhoCanonicoIndiceGmailWMGJ_();
  var header = dados[0] || [];
  var divergencias = [];
  esperado.forEach(function(nome, i) {
    if (header[i] !== nome) divergencias.push({ coluna: i + 1, esperado: nome });
  });
  var registros = [], naoReconhecidas = [], contagem = {}, ultimaIndexacao = null;
  for (var i = 1; i < dados.length; i++) {
    var r = dados[i];
    if (r.every(function(v) { return v === '' || v === null; })) continue;
    // Marker + fixed writer contract, never the misleading header of a mixed sheet.
    var nativa = r[1] === 'v1.1.7-indexador-gmail-faturamento';
    var status = String(r[2] || '');
    if (!nativa || !/^[a-f0-9]{8,32}$/.test(String(r[5] || '')) ||
        !/^(COPIADO_BRUTO_A_CLASSIFICAR(_V2)?|IGNORADO_NAO_PERTINENTE(_V2)?|ERRO)$/.test(status)) {
      naoReconhecidas.push(i + 1);
      continue;
    }
    var hash = String(r[12] || '');
    var chave = hash && r[9] ? [r[5], r[9], hash].join('|') : '';
    var terminal = !!chave && (/^IGNORADO_NAO_PERTINENTE/.test(status) ||
      (/^COPIADO_BRUTO_A_CLASSIFICAR/.test(status) && !!r[22]));
    if (chave) contagem[chave] = (contagem[chave] || 0) + 1;
    registros.push({ linha: i + 1, messageId: r[5], nome: r[9], hash: hash,
      chave: chave, status: status, terminal: terminal, arquivoId: r[22] || '' });
    if (r[0] instanceof Date && !isNaN(r[0].getTime()) &&
        (!ultimaIndexacao || r[0].getTime() > ultimaIndexacao.getTime())) ultimaIndexacao = r[0];
  }
  return { schemaCompativel: divergencias.length === 0 && naoReconhecidas.length === 0,
    divergencias: divergencias, linhasNaoReconhecidas: naoReconhecidas,
    registros: registros, chavesRepetidas: Object.keys(contagem).filter(function(k) { return contagem[k] > 1; }).length,
    ultimaIndexacao: ultimaIndexacao ? ultimaIndexacao.toISOString() : null };
}

function exigirContratoIndiceGmailWMGJ_(aba) {
  var diagnostico = inspecionarIndiceGmailWMGJ_(aba.getDataRange().getValues());
  if (!diagnostico.schemaCompativel) {
    // Never overwrite a mixed header: historical rows may use a second layout.
    throw new Error('GMAIL_INDEX_SCHEMA_MISMATCH: reconciliar layout com backup e trilha antes de gravar');
  }
  return diagnostico;
}

function diagnosticarMensagemGmailWMGJ(messageId) {
  if (typeof messageId !== 'string' || !/^[a-f0-9]{8,32}$/.test(messageId)) {
    throw new Error('GMAIL_MESSAGE_ID_INVALIDO');
  }
  var ss = getPlanilhaWMGJ_Gmail_();
  var aba = ss.getSheetByName('21_GMAIL_INDEXACAO_FATURAMENTO');
  if (!aba) throw new Error('GMAIL_INDEX_AUSENTE');
  var indice = inspecionarIndiceGmailWMGJ_(aba.getDataRange().getValues());
  var msg = GmailApp.getMessageById(messageId);
  if (!msg || msg.getId() !== messageId) throw new Error('GMAIL_MESSAGE_ID_DIVERGENTE');
  var itens = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }).map(function(anexo) {
    var bytes = anexo.copyBlob().getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
    var fullHash = digest.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    var hashLegado = Utilities.base64EncodeWebSafe(digest).slice(0, 32);
    var chave = [messageId, anexo.getName() || 'anexo_sem_nome', hashLegado].join('|');
    var existentes = indice.registros.filter(function(r) { return r.chave === chave; });
    return { nome: anexo.getName(), mime: anexo.getContentType(), bytes: bytes.length,
      sha256: fullHash, hashLegado: hashLegado, chaveLegada: chave,
      estado: existentes.some(function(r) { return r.terminal; }) ? 'INDEXADO_VERIFICAR_DESTINOS' :
        (existentes.length ? 'PARCIAL_RECONCILIAR' : 'AUSENTE_NO_INDICE_VERIFICAR_DRIVE'),
      linhas: existentes.map(function(r) { return r.linha; }),
      arquivosReferenciados: existentes.map(function(r) { return r.arquivoId; }).filter(Boolean) };
  });
  var triggers = ScriptApp.getProjectTriggers().map(function(t) {
    return { funcao: t.getHandlerFunction(), tipo: String(t.getEventType()), id: t.getUniqueId() };
  });
  return { ok: true, modo: 'READ_ONLY', replayExecutado: false, checkedAt: new Date().toISOString(),
    messageId: messageId, spreadsheetId: ss.getId(), anexos: itens,
    schemaCompativel: indice.schemaCompativel, divergencias: indice.divergencias,
    linhasNaoReconhecidas: indice.linhasNaoReconhecidas, chavesRepetidas: indice.chavesRepetidas,
    ultimaIndexacao: indice.ultimaIndexacao, triggersDoUsuarioExecutor: triggers,
    coberturaTriggers: 'SOMENTE_USUARIO_EXECUTOR',
    estadoWatchdog: typeof obterEstadoExecucaoWMGJ_ === 'function' ? obterEstadoExecucaoWMGJ_() : null,
    bloqueios: (indice.schemaCompativel ? [] : ['SCHEMA_MISTO'])
      .concat(['RECONCILIAR_DRIVE_E_FILA', 'EXIGIR_EXECUTOR_REPLAY_COM_LOCK_E_AUDITORIA']),
    podeExecutarReplay: false };
}
