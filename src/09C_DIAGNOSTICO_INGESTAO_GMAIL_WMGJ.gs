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
  var destinosPorChave = Object.create(null);
  var classificacoesPorChave = Object.create(null);
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
    if (chave) {
      contagem[chave] = (contagem[chave] || 0) + 1;
      if (!destinosPorChave[chave]) destinosPorChave[chave] = { arquivos: Object.create(null), linhas: [] };
      destinosPorChave[chave].linhas.push(i + 1);
      if (r[22]) destinosPorChave[chave].arquivos[String(r[22])] = true;
      // Compare completed decisions only; partial/error rows remain recoverable.
      if (terminal) {
        if (!classificacoesPorChave[chave]) classificacoesPorChave[chave] = { linhas: [], campos: [] };
        var classificacoes = classificacoesPorChave[chave];
        classificacoes.linhas.push(i + 1);
        for (var c = 13; c <= 21; c++) {
          if (!classificacoes.campos[c]) classificacoes.campos[c] = Object.create(null);
          var valor = r[c];
          var assinatura = valor === '' || valor === null || typeof valor === 'undefined' ? 'empty' :
            (valor instanceof Date ? 'date:' + valor.getTime() : typeof valor + ':' + JSON.stringify(valor));
          classificacoes.campos[c][assinatura] = true;
        }
      }
    }
    registros.push({ linha: i + 1, messageId: r[5], nome: r[9], hash: hash,
      chave: chave, status: status, terminal: terminal, arquivoId: r[22] || '' });
    if (r[0] instanceof Date && !isNaN(r[0].getTime()) &&
        (!ultimaIndexacao || r[0].getTime() > ultimaIndexacao.getTime())) ultimaIndexacao = r[0];
  }
  // Destination multiplicity is a reconciliation blocker, not proof of duplicate bytes.
  // Do not select a winner or mutate the historical index here.
  var conflitosDestino = Object.keys(destinosPorChave).filter(function(chave) {
    return Object.keys(destinosPorChave[chave].arquivos).length > 1;
  }).map(function(chave) {
    return { chave: chave, linhas: destinosPorChave[chave].linhas,
      arquivos: Object.keys(destinosPorChave[chave].arquivos) };
  });
  // Never silently choose the latest decision or trust a manual-review label.
  var conflitosClassificacao = Object.keys(classificacoesPorChave).map(function(chave) {
    var grupo = classificacoesPorChave[chave];
    var campos = esperado.filter(function(nome, c) {
      return c >= 13 && c <= 21 && Object.keys(grupo.campos[c]).length > 1;
    });
    return { chave: chave, linhas: grupo.linhas, campos: campos };
  }).filter(function(grupo) { return grupo.campos.length > 0; });
  return { schemaCompativel: divergencias.length === 0 && naoReconhecidas.length === 0,
    divergencias: divergencias, linhasNaoReconhecidas: naoReconhecidas,
    conflitosDestino: conflitosDestino, conflitosClassificacao: conflitosClassificacao,
    chavesDistintas: Object.keys(contagem).length,
    repeticoesAlemPrimeira: Object.keys(contagem).reduce(function(total, chave) { return total + contagem[chave] - 1; }, 0),
    registros: registros, chavesRepetidas: Object.keys(contagem).filter(function(k) { return contagem[k] > 1; }).length,
    ultimaIndexacao: ultimaIndexacao ? ultimaIndexacao.toISOString() : null };
}

function exigirContratoIndiceGmailWMGJ_(aba) {
  var diagnostico = inspecionarIndiceGmailWMGJ_(aba.getDataRange().getValues());
  if (!diagnostico.schemaCompativel) {
    // Never overwrite a mixed header: historical rows may use a second layout.
    throw new Error('GMAIL_INDEX_SCHEMA_MISMATCH: reconciliar layout com backup e trilha antes de gravar');
  }
  if (diagnostico.conflitosDestino.length) {
    throw new Error('GMAIL_INDEX_DESTINATION_CONFLICT: reconciliar destinos por mensagem, anexo e SHA-256 antes de gravar');
  }
  if (diagnostico.conflitosClassificacao.length) {
    throw new Error('GMAIL_INDEX_CLASSIFICATION_CONFLICT: reconciliar classificacoes e escopo organizacional antes de gravar');
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
    conflitosDestino: indice.conflitosDestino, chavesDistintas: indice.chavesDistintas,
    conflitosClassificacao: indice.conflitosClassificacao,
    repeticoesAlemPrimeira: indice.repeticoesAlemPrimeira,
    ultimaIndexacao: indice.ultimaIndexacao, triggersDoUsuarioExecutor: triggers,
    coberturaTriggers: 'SOMENTE_USUARIO_EXECUTOR',
    estadoWatchdog: typeof obterEstadoExecucaoWMGJ_ === 'function' ? obterEstadoExecucaoWMGJ_() : null,
    bloqueios: (indice.schemaCompativel ? [] : ['SCHEMA_MISTO'])
      .concat(indice.conflitosDestino.length ? ['CONFLITO_DESTINO'] : [])
      .concat(indice.conflitosClassificacao.length ? ['CONFLITO_CLASSIFICACAO'] : [])
      .concat(['RECONCILIAR_DRIVE_E_FILA', 'EXIGIR_EXECUTOR_REPLAY_COM_LOCK_E_AUDITORIA']),
    podeExecutarReplay: false };
}

