/**
 * WMGJ — Camada de extração documental real
 * Versão: v1.1.2-extracao-documental-compat-total
 *
 * Objetivo:
 * - manter a V3 estável intocada;
 * - rodar extração real com Gemini/OCR;
 * - evitar ReferenceError quando algum helper privado do Apps Script não estiver colado.
 *
 * Cole este arquivo inteiro em: 04_EXTRACAO_DOCUMENTAL_WMGJ
 */

var WMGJ_EXTRACAO_VERSAO = "v1.2.0-firebase-native-document-intelligence";
var WMGJ_EXTRACAO_PASTA_PADRAO_ID = "1Gz0GtUfvKezI8OmAH0h8fkNLlqEzfYU-";

function executarExtracaoRealWMGJ(limite) {
  return executarExtracaoRealWMGJ_V1(limite || 20);
}

function executarExtracaoRealWMGJ_V1(limite) {
  limite = Number(limite) || 20;

  var preparo = prepararPipelineConfiavelWMGJ_Compat_(limite || 100);
  var processamento = processarFilaComExtracaoRealWMGJ_V1(limite || 20);

  var resultado = {
    ok: preparo.ok !== false && processamento.ok === true,
    versao: WMGJ_EXTRACAO_VERSAO,
    etapa: "executarExtracaoRealWMGJ_V1",
    preparo: preparo,
    processamento: processamento
  };

  registrarLogWMGJ_Compat_("OK", "executarExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function processarFilaComExtracaoRealWMGJ_V1(limite) {
  garantirAbasControleExtracaoWMGJ_V1_();
  garantirAbaExtracoesDocumentaisWMGJ_V1_();

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var fila = ss.getSheetByName(cfg.SHEETS.FILA);
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  if (!fila || fila.getLastRow() < 2) {
    var vazio = {
      ok: true,
      versao: WMGJ_EXTRACAO_VERSAO,
      processados: 0,
      erros: 0,
      duplicados: 0,
      revisar: 0,
      pendentesExtracao: 0,
      mensagem: "Fila vazia"
    };
    registrarLogWMGJ_Compat_("OK", "processarFilaComExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(vazio));
    return vazio;
  }

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);
  var max = Number(limite) || 20;

  var avaliados = 0;
  var processados = 0;
  var erros = 0;
  var duplicados = 0;
  var revisar = 0;
  var pendentesExtracao = 0;

  for (var i = 1; i < dados.length && avaliados < max; i++) {
    var linha = dados[i];
    var status = String(linha[idx.STATUS] || "").toUpperCase();
    var idOrigem = String(linha[idx.ID_ORIGEM] || "");
    var sourceSystem = String(linha[idx.ORIGEM] || "DRIVE").trim().toUpperCase();

    if (status !== "PENDENTE" && status !== "ERRO_REPROCESSAR") {
      continue;
    }

    avaliados++;

    try {
      if (!idOrigem) {
        throw new Error("ID_ORIGEM vazio na fila");
      }

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "EXTRAINDO",
        ULTIMO_ERRO: "",
        OBSERVACAO: "Extração real iniciada"
      });

      var file = DriveApp.getFileById(idOrigem);
      var hash = gerarHashArquivoWMGJ_Compat_(file);

      var jaProcessado = documentoJaProcessadoWMGJ_Compat_(idOrigem, hash);
      var mirrorRequired = firestoreMirrorObrigatorioWMGJ_();
      var mirrorConfirmed = firestoreMirrorJaConfirmadoWMGJ_(idOrigem, hash);
      if (jaProcessado && (!mirrorRequired || mirrorConfirmed)) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "DUPLICADO",
          ULTIMO_ERRO: "",
          OBSERVACAO: mirrorConfirmed
            ? "Arquivo já reconhecido por ID_ORIGEM + HASH e Firebase confirmado"
            : "Arquivo já reconhecido por ID_ORIGEM + HASH"
        });
        duplicados++;
        continue;
      }
      if (jaProcessado && mirrorRequired && !mirrorConfirmed) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "EXTRAINDO",
          ULTIMO_ERRO: "",
          OBSERVACAO: "Backfill idempotente: memória local existe, Firebase ainda não confirmado"
        });
      }

      var extracao = extrairConteudoArquivoWMGJ_V1_(file);
      registrarExtracaoDocumentalWMGJ_V1_(file, hash, extracao);

      // Metadata and a successful listing are not extracted document contents.
      // Keep the existing queue resumable; do not classify, mirror or mark memory.
      if (!extracaoDocumentalCompletaWMGJ_(extracao)) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "ERRO_REPROCESSAR",
          TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
          ULTIMO_ERRO: "PENDING_EXTRACTION",
          OBSERVACAO: "Extração não comprovada; revisar formato, autorização e serviço de extração"
        });
        pendentesExtracao++;
        continue;
      }

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "CLASSIFICANDO",
        OBSERVACAO: "Conteúdo extraído por " + extracao.metodo
      });

      var classificacao = classificarDocumentoGeminiOuFallbackWMGJ_V1_(extracao, file);
      var validacao = validarDocumentoJsonWMGJ_Compat_(classificacao);
      if (validacao.ok) validacao.dados.sla_due_at = calcularSlaDocumentoFilaWMGJ_(linha, idx);

      if (!validacao.ok) {
        atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
          STATUS: "REVISAR_HUMANO",
          TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
          ULTIMO_ERRO: validacao.erro,
          OBSERVACAO: "Extração feita, mas classificação JSON exige revisão"
        });
        revisar++;
        continue;
      }

      var firestoreMirror = espelharDocumentoProcessadoFirestoreWMGJ_(file, validacao.dados, extracao, sourceSystem);
      if (firestoreMirror.required && !firestoreMirror.ok) {
        registrarFirestoreMirrorWMGJ_(file, hash, firestoreMirror);
        throw new Error("FIRESTORE_MIRROR_REQUIRED:" + firestoreMirror.status);
      }
      if (firestoreMirror.ok) registrarFirestoreMirrorWMGJ_(file, hash, firestoreMirror);

      if (!jaProcessado) {
        registrarDocumentoMemoriaWMGJ_Compat_(memoria, {
          origem: "DRIVE_EXTRACAO_REAL",
          idOrigem: idOrigem,
          nome: file.getName(),
          mimeType: file.getMimeType(),
          hash: hash,
          competencia: validacao.dados.competencia || "",
          categoria: validacao.dados.categoria || "outro",
          status: "PROCESSADO",
          resumo: montarResumoMemoriaExtracaoWMGJ_V1_(validacao.dados, extracao)
        });
      }

      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "PROCESSADO",
        ULTIMO_ERRO: "",
        OBSERVACAO: "Extração real + classificação + memória-base OK; Firebase=" + firestoreMirror.status
      });

      processados++;

    } catch (erro) {
      atualizarLinhaFilaWMGJ_Compat_(fila, i + 1, idx, {
        STATUS: "ERRO_REPROCESSAR",
        TENTATIVAS: Number(linha[idx.TENTATIVAS] || 0) + 1,
        ULTIMO_ERRO: erro && erro.message ? erro.message : String(erro),
        OBSERVACAO: "Falha isolada na extração real; lote continua"
      });
      erros++;
    }
  }

  var resultado = {
    ok: erros === 0 && revisar === 0 && pendentesExtracao === 0,
    versao: WMGJ_EXTRACAO_VERSAO,
    etapa: "processarFilaComExtracaoRealWMGJ_V1",
    avaliados: avaliados,
    processados: processados,
    erros: erros,
    duplicados: duplicados,
    revisar: revisar,
    pendentesExtracao: pendentesExtracao
  };

  registrarLogWMGJ_Compat_("OK", "processarFilaComExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function firestoreMirrorObrigatorioWMGJ_() {
  return String(PropertiesService.getScriptProperties().getProperty("AURORA_FIRESTORE_MIRROR_REQUIRED") || "false").toLowerCase() === "true";
}

function garantirAbaFirestoreMirrorWMGJ_() {
  var ss = getPlanilhaWMGJ_Compat_();
  return obterOuCriarAbaWMGJ_Compat_(ss, "17_FIRESTORE_MIRROR", [
    "DATA",
    "ID_ORIGEM",
    "HASH",
    "STATUS",
    "ENTITY_ID",
    "EVENT_ID",
    "REQUIRED"
  ]);
}

function registrarFirestoreMirrorWMGJ_(file, hash, mirror) {
  var aba = garantirAbaFirestoreMirrorWMGJ_();
  aba.appendRow([
    new Date(),
    file.getId(),
    hash,
    mirror && mirror.status || "UNKNOWN",
    mirror && mirror.entityId || "",
    mirror && mirror.eventId || "",
    !!(mirror && mirror.required)
  ]);
}

function firestoreMirrorJaConfirmadoWMGJ_(idOrigem, hash) {
  var ss = getPlanilhaWMGJ_Compat_();
  var aba = ss.getSheetByName("17_FIRESTORE_MIRROR");
  if (!aba || aba.getLastRow() < 2) return false;
  var values = aba.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(values[0]);
  for (var i = values.length - 1; i >= 1; i--) {
    if (
      String(values[i][idx.ID_ORIGEM] || "") === String(idOrigem || "")
      && String(values[i][idx.HASH] || "") === String(hash || "")
    ) {
      var status = String(values[i][idx.STATUS] || "").toUpperCase();
      return status === "ACCEPTED" || status === "DUPLICATE_CONFIRMED";
    }
  }
  return false;
}

function espelharDocumentoProcessadoFirestoreWMGJ_(file, dados, extracao, sourceSystem) {
  var props = PropertiesService.getScriptProperties();
  var required = String(props.getProperty("AURORA_FIRESTORE_MIRROR_REQUIRED") || "false").toLowerCase() === "true";

  if (typeof wmgjFirestoreEventoArquivo_ !== "function" || typeof wmgjFirestoreEnviarEvento_ !== "function") {
    return { ok: !required, required: required, status: "BRIDGE_UNAVAILABLE" };
  }

  try {
    var classification = JSON.parse(JSON.stringify(dados || {}));
    classification.status = "PROCESSADO";
    classification.metodo_extracao = String(extracao && extracao.metodo || "");
    var event = wmgjFirestoreEventoArquivo_(file, classification, {
      sourceContext: "continuous-document-ingestion",
      sourceSystem: sourceSystem || "DRIVE",
      originConnector: "DRIVE_FOLDER",
      sourceRegistryVersion: "1",
      mirrorRequired: required,
      pipelineVersion: WMGJ_EXTRACAO_VERSAO
    });
    var response = wmgjFirestoreEnviarEvento_(event);
    if (response && (response.accepted === true || response.duplicate === true)) {
      return {
        ok: true,
        required: required,
        status: response.duplicate === true ? "DUPLICATE_CONFIRMED" : "ACCEPTED",
        entityId: response.entityId || "",
        eventId: response.eventId || event.eventId
      };
    }
    if (response && response.dryRun === true) {
      return { ok: !required, required: required, status: "DRY_RUN" };
    }
    return { ok: false, required: required, status: "UNCONFIRMED" };
  } catch (error) {
    return {
      ok: false,
      required: required,
      status: "ERROR",
      error: error && error.message ? String(error.message).slice(0, 240) : "unknown"
    };
  }
}

function calcularSlaDocumentoFilaWMGJ_(linha, idx) {
  try {
    var obs = String(linha[idx.OBSERVACAO] || "");
    var match = obs.match(/SLA_MIN=(\d{2,5})/i);
    if (!match) return "";
    var minutes = Number(match[1]);
    if (!Number.isSafeInteger(minutes) || minutes < 15 || minutes > 43200) return "";
    var entered = linha[idx.DATA_ENTRADA];
    var enteredDate = entered instanceof Date ? entered : new Date(entered);
    if (!Number.isFinite(enteredDate.getTime())) return "";
    return new Date(enteredDate.getTime() + minutes * 60000).toISOString();
  } catch (ignore) {
    return "";
  }
}

function extracaoDocumentalCompletaWMGJ_(extracao) {
  var metodos = {
    google_docs_text: true,
    google_sheets_values: true,
    google_sheets_manifest: true,
    zip_manifest: true,
    pdf_encrypted_manifest: true,
    blob_text: true,
    drive_api_ocr_convert: true
  };
  return !!extracao && extracao.ok === true
    && Object.prototype.hasOwnProperty.call(metodos, extracao.metodo)
    && typeof extracao.texto === "string" && extracao.texto.trim().length > 0
    && extracao.tamanhoTexto === extracao.texto.length;
}

// Only fixed codes leave the extractor; service errors can contain source names.
function auroraCodigoFalhaExtracaoDrive_(error, fallback) {
  var message=String(error && error.message || error || '');
  var allowed=['AURORA_DRIVE_EXTRACTION_AUTH_FAILED','AURORA_DRIVE_EXTRACTION_QUOTA',
    'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE','AURORA_DRIVE_CONVERSION_UNSUPPORTED',
    'AURORA_DRIVE_CONVERSION_FAILED','AURORA_DRIVE_CONVERSION_NOT_READY',
    'AURORA_DRIVE_CONVERSION_DEFERRED','AURORA_DRIVE_FILE_SIZE_LIMIT','AURORA_DRIVE_TEXT_LIMIT',
    'AURORA_DRIVE_EXTRACTION_EMPTY','AURORA_DRIVE_FORMAT_UNSUPPORTED',
    'AURORA_DRIVE_CONTENT_READ_FAILED','AURORA_DRIVE_OFX_SIGNATURE_INVALID',
    'AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED','AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED',
    'AURORA_SHEETS_TEXT_LIMIT','AURORA_SHEETS_CELL_LIMIT',
    'AURORA_ZIP_EXTRACTION_FAILED','AURORA_ZIP_ENTRY_LIMIT','AURORA_ZIP_UNCOMPRESSED_SIZE_LIMIT'];
  if(allowed.indexOf(message)>=0) return message;
  if(/permission|unauthori[sz]ed|forbidden|access denied|insufficient|permiss[aã]o|autoriz/i.test(message))
    return 'AURORA_DRIVE_EXTRACTION_AUTH_FAILED';
  if(/quota|rate.?limit|too many|invoked too|limite.*excedid/i.test(message))
    return 'AURORA_DRIVE_EXTRACTION_QUOTA';
  if(/(?:conversion|convert).*(?:unsupported|not supported)|cannot convert/i.test(message))
    return 'AURORA_DRIVE_CONVERSION_UNSUPPORTED';
  return allowed.indexOf(fallback)>=0?fallback:'AURORA_DRIVE_CONTENT_READ_FAILED';
}

function auroraExtrairTextoOfxDrive_(file) {
  if(!/\.ofx$/i.test(String(file.getName()))) throw new Error('AURORA_DRIVE_FORMAT_UNSUPPORTED');
  var blob=file.getBlob(),bytes=blob.getBytes(),prefix='';
  if(!bytes.length) throw new Error('AURORA_DRIVE_EXTRACTION_EMPTY');
  for(var i=0;i<bytes.length;i++) {
    var octet=(bytes[i]+256)%256;
    if(octet===0) throw new Error('AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED');
    if(i<4096) prefix+=octet<128?String.fromCharCode(octet):'\uFFFD';
  }
  var bom=bytes.length>=3 && (bytes[0]+256)%256===239 && (bytes[1]+256)%256===187 && (bytes[2]+256)%256===191;
  if(bom) prefix=prefix.slice(3);
  var opening=prefix.search(/<OFX\s*>/i);
  if(opening<0) throw new Error('AURORA_DRIVE_OFX_SIGNATURE_INVALID');
  var header=prefix.slice(0,opening),encoding='',charset='',decodeAs='UTF-8';
  if(/^\s*OFXHEADER:\s*100\s*(?:\r?\n)/i.test(header)) {
    if(!/(?:^|\n)DATA:\s*OFXSGML\s*(?:\r?\n|$)/i.test(header)) throw new Error('AURORA_DRIVE_OFX_SIGNATURE_INVALID');
    var declared=header.match(/(?:^|\n)ENCODING:\s*([^\r\n]+)/i);
    var characters=header.match(/(?:^|\n)CHARSET:\s*([^\r\n]+)/i);
    encoding=declared?declared[1].trim().toUpperCase():'';
    charset=characters?characters[1].trim().toUpperCase():'';
    if(encoding==='USASCII' && /^(1252|WINDOWS-1252)$/.test(charset)) decodeAs='windows-1252';
    else if(encoding==='USASCII' && /^(8859-1|ISO-8859-1)$/.test(charset)) decodeAs='ISO-8859-1';
    else if(encoding==='USASCII' && /^(NONE|US-ASCII|ASCII)?$/.test(charset)) decodeAs='US-ASCII';
    else if(/^(UTF-8|UTF8)$/.test(encoding) && /^(NONE|UTF-8|UTF8)?$/.test(charset)) decodeAs='UTF-8';
    else throw new Error('AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED');
  } else {
    if(!/^\s*(?:<\?(?:xml|OFX)\s[^?]*\?>\s*)*$/i.test(header)) throw new Error('AURORA_DRIVE_OFX_SIGNATURE_INVALID');
    var xmlEncoding=header.match(/\bencoding\s*=\s*["']([^"']+)["']/i);
    encoding=xmlEncoding?xmlEncoding[1].toUpperCase():'UTF-8';
    var supported={'UTF-8':'UTF-8','UTF8':'UTF-8','US-ASCII':'US-ASCII','WINDOWS-1252':'windows-1252','ISO-8859-1':'ISO-8859-1'};
    if(!Object.prototype.hasOwnProperty.call(supported,encoding)) throw new Error('AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED');
    decodeAs=supported[encoding];
  }
  if(bom && decodeAs!=='UTF-8') throw new Error('AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED');
  var text=blob.getDataAsString(decodeAs);
  if(/[\uFFFD\u0000]/.test(text) || (decodeAs==='US-ASCII' && bytes.some(function(b){return (b+256)%256>=128;})))
    throw new Error('AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED');
  if(!/<OFX\s*>/i.test(text) || !/<\/OFX\s*>\s*$/i.test(text)) throw new Error('AURORA_DRIVE_OFX_SIGNATURE_INVALID');
  return text;
}

function auroraBytesTextoUtf8Validos_(bytes) {
  for(var i=0;i<bytes.length;) {
    var first=(bytes[i]+256)%256,extra=0,minimum=128,maximum=191;
    if(first===0) return false;
    if(first<128) {i++;continue;}
    if(first>=194 && first<=223) extra=1;
    else if(first>=224 && first<=239) {
      extra=2;if(first===224) minimum=160;if(first===237) maximum=159;
    } else if(first>=240 && first<=244) {
      extra=3;if(first===240) minimum=144;if(first===244) maximum=143;
    } else return false;
    if(i+extra>=bytes.length) return false;
    for(var j=1;j<=extra;j++) {
      var next=(bytes[i+j]+256)%256;
      if(next<(j===1?minimum:128) || next>(j===1?maximum:191)) return false;
    }
    i+=extra+1;
  }
  return true;
}

// The provider imports the original bytes. This does not establish their charset.
function auroraConverterTextoProviderDrive_(file,deadlineMs) {
  if(typeof Drive==='undefined' || !Drive.Files || typeof Drive.Files.copy!=='function')
    return {ok:false,code:'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE'};
  var deadline=Number(deadlineMs),copyId='',originalId=file.getId(),fallback='AURORA_DRIVE_CONVERSION_FAILED';
  if(!Number.isFinite(deadline)) deadline=Date.now()+145000;
  try {
    if(Date.now()>=deadline-15000) throw new Error('AURORA_DRIVE_CONVERSION_DEFERRED');
    var copy=Drive.Files.copy({title:'WMGJ_TEXT_TMP_'+Utilities.getUuid(),mimeType:MimeType.GOOGLE_DOCS},
      originalId,{convert:true});
    if(!copy || typeof copy.id!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(copy.id) || copy.id===originalId)
      throw new Error('AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    copyId=copy.id;
    if(copy.mimeType!==MimeType.GOOGLE_DOCS) throw new Error('AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    if(Date.now()>=deadline-5000) throw new Error('AURORA_DRIVE_CONVERSION_DEFERRED');
    fallback='AURORA_DRIVE_CONVERSION_NOT_READY';
    Utilities.sleep(1500);
    var text=DocumentApp.openById(copyId).getBody().getText();
    if(Date.now()>=deadline-5000) throw new Error('AURORA_DRIVE_CONVERSION_DEFERRED');
    if(typeof text!=='string' || !text.trim()) throw new Error('AURORA_DRIVE_EXTRACTION_EMPTY');
    if(text.length>1048576) throw new Error('AURORA_DRIVE_TEXT_LIMIT');
    if(/[\uFFFD\u0000]/.test(text)) throw new Error('AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED');
    return {ok:true,metodo:'google_docs_text',texto:text,
      observacao:'Texto convertido pelo Google; codificação da fonte não verificada; revisão humana pendente'};
  } catch(error) {
    return {ok:false,code:auroraCodigoFalhaExtracaoDrive_(error,fallback)};
  } finally {
    if(copyId && copyId!==originalId) {
      try {DriveApp.getFileById(copyId).setTrashed(true);} catch(ignoreCleanup) {}
    }
  }
}

function extrairConteudoArquivoWMGJ_V1_(file,deadlineMs) {
  var mime = file.getMimeType();
  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    arquivoId: file.getId(),
    nome: file.getName(),
    mimeType: mime,
    metodo: "metadata_fallback",
    texto: "",
    tamanhoTexto: 0,
    observacao: ""
  };

  try {
    if (mime === MimeType.GOOGLE_DOCS) {
      resultado.metodo = "google_docs_text";
      resultado.texto = DocumentApp.openById(file.getId()).getBody().getText();
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if (mime === MimeType.GOOGLE_SHEETS) {
      try {
        resultado.metodo = "google_sheets_values";
        resultado.texto = extrairTextoGoogleSheetsWMGJ_V1_(file.getId());
      } catch(sheetError) {
        if(auroraCodigoFalhaExtracaoDrive_(sheetError,'AURORA_DRIVE_CONTENT_READ_FAILED')!=='AURORA_SHEETS_TEXT_LIMIT')
          throw sheetError;
        resultado.metodo = "google_sheets_manifest";
        resultado.texto = auroraExtrairManifestoSheetsCompleto_(file.getId());
        resultado.observacao = "Planilha acima do limite textual; cobertura integral registrada por manifesto criptografico de blocos";
      }
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime==='application/vnd.ms-excel') {
      var planilha=converterArquivoParaGoogleSheetsWMGJ_V1_(file);
      if(!planilha.ok) throw new Error(planilha.code);
      resultado.metodo='google_sheets_values';resultado.texto=planilha.texto;
      resultado.tamanhoTexto=resultado.texto.length;resultado.observacao=planilha.observacao;
      return resultado;
    }

    if(mime==='application/octet-stream') {
      resultado.metodo='blob_text';resultado.texto=auroraExtrairTextoOfxDrive_(file);
      resultado.tamanhoTexto=resultado.texto.length;
      return resultado;
    }

    if (mime === MimeType.PLAIN_TEXT || mime.indexOf("text/") === 0 || mime.indexOf("csv") >= 0 || mime.indexOf("json") >= 0) {
      var textBlob=file.getBlob();
      if(mime===MimeType.PLAIN_TEXT) {
        var originalBytes=textBlob.getBytes();
        if(originalBytes.length>16*1024*1024) throw new Error('AURORA_DRIVE_FILE_SIZE_LIMIT');
        if(!auroraBytesTextoUtf8Validos_(originalBytes)) {
          var importedText=auroraConverterTextoProviderDrive_(file,deadlineMs);
          if(!importedText.ok) throw new Error(importedText.code);
          resultado.metodo=importedText.metodo;resultado.texto=importedText.texto;
          resultado.tamanhoTexto=resultado.texto.length;resultado.observacao=importedText.observacao;
          return resultado;
        }
      }
      resultado.metodo = "blob_text";
      resultado.texto = textBlob.getDataAsString("UTF-8");
      resultado.tamanhoTexto = resultado.texto.length;
      return resultado;
    }

    if(mime==='application/zip' || mime==='application/x-zip-compressed') {
      resultado.metodo='zip_manifest';
      resultado.texto=auroraExtrairManifestoZipDrive_(file);
      resultado.tamanhoTexto=resultado.texto.length;
      resultado.observacao='Pacote ZIP coberto por manifesto criptografico dos membros; conteudo interno permanece pendente de revisao humana';
      return resultado;
    }

    if (mime === MimeType.PDF || mime.indexOf("pdf") >= 0 || mime.indexOf("image/") === 0 || mime.indexOf("officedocument") >= 0 || mime.indexOf("ms-excel") >= 0 || mime.indexOf("msword") >= 0) {
      if(mime === MimeType.PDF || mime.indexOf("pdf") >= 0) {
        var encryptedManifest=auroraExtrairManifestoPdfCriptografadoDrive_(file);
        if(encryptedManifest) {
          resultado.metodo='pdf_encrypted_manifest';
          resultado.texto=encryptedManifest;
          resultado.tamanhoTexto=resultado.texto.length;
          resultado.observacao='PDF criptografado sincronizado por manifesto estrutural; conteudo requer credencial legitima e revisao humana';
          return resultado;
        }
      }
      var convertido = converterArquivoParaGoogleDocWMGJ_V1_(file);
      if (convertido.ok && convertido.texto) {
        resultado.metodo = convertido.metodo;
        resultado.texto = convertido.texto;
        resultado.tamanhoTexto = convertido.texto.length;
        resultado.observacao = convertido.observacao || "";
        return resultado;
      }
      resultado.code=convertido.code || auroraCodigoFalhaExtracaoDrive_(convertido.erro,
        convertido.ok?'AURORA_DRIVE_EXTRACTION_EMPTY':'AURORA_DRIVE_CONVERSION_FAILED');
      resultado.observacao=resultado.code;
    }
  } catch (erro) {
    resultado.ok = false;
    resultado.code=auroraCodigoFalhaExtracaoDrive_(erro,'AURORA_DRIVE_CONTENT_READ_FAILED');
    resultado.observacao=resultado.code;
  }

  resultado.ok = false;
  resultado.code=resultado.code || 'AURORA_DRIVE_FORMAT_UNSUPPORTED';
  resultado.observacao=resultado.code;
  resultado.texto = [
    "NOME_ARQUIVO: " + file.getName(),
    "MIME_TYPE: " + mime,
    "ID: " + file.getId(),
    "OBS: " + resultado.observacao
  ].join("\n");

  resultado.tamanhoTexto = resultado.texto.length;
  return resultado;
}

function converterArquivoParaGoogleSheetsWMGJ_V1_(file) {
  if(typeof Drive==='undefined' || !Drive.Files || typeof Drive.Files.copy!=='function')
    return {ok:false,code:'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE'};
  var copyId='',fallback='AURORA_DRIVE_CONVERSION_FAILED';
  try {
    // Drive v2 files.copy explicitly supports conversion to the matching editor.
    var copy=Drive.Files.copy({title:'WMGJ_SHEETS_TMP_'+file.getName(),mimeType:MimeType.GOOGLE_SHEETS},
      file.getId(),{convert:true});
    copyId=copy && copy.id || '';
    if(!copyId || copy.mimeType!==MimeType.GOOGLE_SHEETS) throw new Error('AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    fallback='AURORA_DRIVE_CONVERSION_NOT_READY';
    Utilities.sleep(1500);
    var text=extrairTextoGoogleSheetsWMGJ_V1_(copyId);
    return {ok:true,metodo:'google_sheets_values',texto:text,
      observacao:'Planilha convertida temporariamente para Google Sheets e removida após leitura'};
  } catch(error) {
    return {ok:false,code:auroraCodigoFalhaExtracaoDrive_(error,fallback)};
  } finally {
    if(copyId) {try {DriveApp.getFileById(copyId).setTrashed(true);} catch(ignoreCleanup) {}}
  }
}

function converterArquivoParaGoogleDocWMGJ_V1_(file) {
  if (typeof Drive === "undefined" || !Drive.Files || typeof Drive.Files.copy !== "function") {
    return {
      ok: false,
      metodo: "drive_api_indisponivel",
      code: 'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE',
      erro: 'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE'
    };
  }

  var copiaId = "", originalId = "", fallback = 'AURORA_DRIVE_CONVERSION_FAILED';

  try {
    originalId = file.getId();
    var resource = {
      title: "WMGJ_OCR_TMP_" + file.getName(),
      mimeType: MimeType.GOOGLE_DOCS
    };

    var parametros = {convert:true,ocr:true,ocrLanguage:"pt"};
    var copia;
    if(typeof Drive.Files.insert==='function') {
      copia = Drive.Files.insert(resource, file.getBlob(), parametros);
    } else {
      copia = Drive.Files.copy(resource, originalId, parametros);
    }

    if (!copia || typeof copia.id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(copia.id)
      || copia.id === originalId) throw new Error('AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    copiaId = copia.id;
    if (copia.mimeType !== MimeType.GOOGLE_DOCS) throw new Error('AURORA_DRIVE_CONVERSION_UNSUPPORTED');
    fallback = 'AURORA_DRIVE_CONVERSION_NOT_READY';
    Utilities.sleep(1500);

    var texto = DocumentApp.openById(copiaId).getBody().getText();

    return {
      ok: true,
      metodo: "drive_api_ocr_convert",
      texto: texto || "",
      observacao: "Arquivo convertido temporariamente para Google Docs e removido após leitura"
    };

  } catch (erro) {
    var code = auroraCodigoFalhaExtracaoDrive_(erro, fallback);
    return {
      ok: false,
      metodo: "drive_api_ocr_convert",
      code: code,
      erro: code
    };
  } finally {
    if (copiaId && copiaId !== originalId) {
      try {
        DriveApp.getFileById(copiaId).setTrashed(true);
      } catch (erroTrash) {}
    }
  }
}

function auroraDigestHexBytes_(bytes) {
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes);
  return digest.map(function(value){var n=(value+256)%256;return ('0'+n.toString(16)).slice(-2);}).join('');
}

function auroraExtrairManifestoPdfCriptografadoDrive_(file) {
  if(!file || typeof file.getBlob!=='function') return null;
  var bytes=file.getBlob().getBytes();
  if(!bytes || bytes.length<16) return null;
  var head='',headLimit=Math.min(12,bytes.length);
  for(var h=0;h<headLimit;h++) {
    var ho=(bytes[h]+256)%256;
    head+=ho>=32 && ho<=126?String.fromCharCode(ho):' ';
  }
  if(head.indexOf('%PDF-')!==0) return null;
  var start=Math.max(0,bytes.length-131072),tail='';
  for(var i=start;i<bytes.length;i++) {
    var octet=(bytes[i]+256)%256;
    tail+=octet<=127?String.fromCharCode(octet):' ';
  }
  if(tail.indexOf('/Encrypt')<0) return null;
  if(tail.indexOf('startxref')<0 || tail.indexOf('%%EOF')<0) return null;
  var trailerBytes=bytes.slice(start);
  return [
    'AURORA_PDF_ENCRYPTED_MANIFEST_V1',
    'BYTES:'+bytes.length,
    'ENCRYPTED:TRUE',
    'STANDARD_FILTER:'+(/\/Filter\s*\/Standard/.test(tail)?'TRUE':'UNKNOWN'),
    'TRAILER_SHA256:'+auroraDigestHexBytes_(trailerBytes)
  ].join('\n');
}

function auroraExtrairManifestoZipDrive_(file) {
  if(!Utilities || typeof Utilities.unzip!=='function') throw new Error('AURORA_ZIP_EXTRACTION_FAILED');
  var blobs;
  try {blobs=Utilities.unzip(file.getBlob());}
  catch(error){throw new Error('AURORA_ZIP_EXTRACTION_FAILED');}
  if(!Array.isArray(blobs) || !blobs.length) throw new Error('AURORA_DRIVE_EXTRACTION_EMPTY');
  if(blobs.length>200) throw new Error('AURORA_ZIP_ENTRY_LIMIT');
  var total=0,entries=[];
  blobs.forEach(function(blob){
    var bytes=blob.getBytes(),size=bytes.length;total+=size;
    if(total>32*1024*1024) throw new Error('AURORA_ZIP_UNCOMPRESSED_SIZE_LIMIT');
    var name=String(typeof blob.getName==='function'?blob.getName():'');
    var type=String(typeof blob.getContentType==='function'?blob.getContentType():'application/octet-stream');
    if(!/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(type)) type='application/octet-stream';
    entries.push({nameHash:wmgjFirestoreHashString_(name),size:size,mime:type,sha256:auroraDigestHexBytes_(bytes)});
  });
  entries.sort(function(a,b){return (a.nameHash+a.sha256).localeCompare(b.nameHash+b.sha256);});
  var lines=['AURORA_ZIP_MANIFEST_V1','ENTRIES:'+entries.length,'UNCOMPRESSED_BYTES:'+total];
  entries.forEach(function(e){lines.push(['ENTRY',e.nameHash,e.size,e.mime,e.sha256].join(':'));});
  return lines.join('\n');
}

function auroraExtrairManifestoSheetsCompleto_(spreadsheetId) {
  var ss=SpreadsheetApp.openById(spreadsheetId),manifest=[],totalCells=0,totalCharacters=0,totalRows=0;
  ss.getSheets().forEach(function(sheet){
    var lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();
    if(!lastRow || !lastColumn) return;
    if(lastColumn>256 || lastRow*lastColumn>1000000-totalCells) throw new Error('AURORA_SHEETS_CELL_LIMIT');
    totalCells+=lastRow*lastColumn;
    var chunks=[],populated=0,characters=0;
    for(var start=1;start<=lastRow;start+=200) {
      var values=sheet.getRange(start,1,Math.min(200,lastRow-start+1),lastColumn).getDisplayValues(),rows=[];
      values.forEach(function(row){
        if(!row.some(function(value){return String(value).trim().length>0;})) return;
        var text=row.join(' | ');rows.push(text);populated++;characters+=text.length+1;
      });
      chunks.push(wmgjFirestoreHashString_(rows.join('\n')));
    }
    totalCharacters+=characters;totalRows+=populated;
    manifest.push({
      nameHash:wmgjFirestoreHashString_(sheet.getName()),
      rows:lastRow,columns:lastColumn,populatedRows:populated,characters:characters,
      contentSha256:wmgjFirestoreHashString_(chunks.join(':'))
    });
  });
  manifest.sort(function(a,b){return a.nameHash.localeCompare(b.nameHash);});
  var lines=['AURORA_SHEETS_MANIFEST_V1','SHEETS:'+manifest.length,'POPULATED_ROWS:'+totalRows,
    'CELLS_SCANNED:'+totalCells,'DISPLAY_CHARACTERS:'+totalCharacters];
  manifest.forEach(function(m){lines.push(['SHEET',m.nameHash,m.rows,m.columns,m.populatedRows,m.characters,m.contentSha256].join(':'));});
  return lines.join('\n');
}

function extrairTextoGoogleSheetsWMGJ_V1_(spreadsheetId) {
  return auroraExtrairTextoSheetsCompleto_(spreadsheetId);
}

function classificarDocumentoGeminiOuFallbackWMGJ_V1_(extracao, file) {
  var local = classificarDocumentoFallbackLocalWMGJ_V1_(extracao.texto || "", file);
  if (local.categoria !== "outro" && Number(local.confianca || 0) >= 0.6) {
    return local;
  }

  var props = PropertiesService.getScriptProperties();
  var externalEnabled = String(props.getProperty("AURORA_EXTERNAL_AI_FALLBACK_ENABLED") || "false").toLowerCase() === "true";
  if (externalEnabled && typeof classificarDocumentoGeminiWMGJ_V1 === "function") {
    try {
      return classificarDocumentoGeminiWMGJ_V1(extracao, file);
    } catch (ignoreExternalAi) {}
  }

  return local;
}

function classificarDocumentoFallbackLocalWMGJ_V1_(texto, file) {
  texto = String(texto || "");
  var lower = texto.toLowerCase();
  var categoria = "outro";

  if (lower.indexOf("glosa") >= 0 || lower.indexOf("recurso de glosa") >= 0) categoria = "glosa";
  else if (lower.indexOf("contrato") >= 0 || lower.indexOf("aditivo") >= 0) categoria = "contrato";
  else if (lower.indexOf("atendimento") >= 0 || lower.indexOf("produtividade") >= 0 || lower.indexOf("produção") >= 0 || lower.indexOf("producao") >= 0) categoria = "produtividade";
  else if (lower.indexOf("faturamento") >= 0 || lower.indexOf("conta hospitalar") >= 0 || lower.indexOf("nota fiscal") >= 0 || lower.indexOf("nfse") >= 0 || lower.indexOf("r$") >= 0 || lower.indexOf("valor") >= 0 || lower.indexOf("pagamento") >= 0 || lower.indexOf("receita") >= 0) categoria = "financeiro";
  else if (lower.indexOf("relatório") >= 0 || lower.indexOf("relatorio") >= 0 || lower.indexOf("guia") >= 0 || lower.indexOf("autorização") >= 0 || lower.indexOf("autorizacao") >= 0) categoria = "relatorio";

  var valor = extrairValorMonetarioWMGJ_V1_(texto);
  var atendimentos = extrairNumeroAtendimentosWMGJ_V1_(texto);
  var competencia = extrairCompetenciaWMGJ_V1_(texto);
  var confianca = categoria !== "outro" ? 0.78 : ((Number(valor) > 0 || Number(atendimentos) > 0) ? 0.68 : 0.4);

  return {
    categoria: categoria,
    tipo_documento: "classificacao_aurora_nativa",
    data_documento: "",
    competencia: competencia,
    valor_total: valor,
    atendimentos: atendimentos,
    nome_prestador: "",
    cnpj: "",
    medico: "",
    paciente: "",
    descricao: "Classificação determinística nativa. Provedor externo não é necessário para categorias reconhecidas.",
    pendencias: [],
    nivel_risco: confianca >= 0.6 ? "baixo" : "medio",
    resumo_operacional: String(texto || "").slice(0, 500),
    destino_drive: "",
    aba_planilha_destino: "",
    confianca: confianca,
    origem_classificacao: "aurora_native_rules_v2"
  };
}

function extrairValorMonetarioWMGJ_V1_(texto) {
  var match = String(texto || "").match(/R\$\s*([0-9\.]+,[0-9]{2})/i);
  if (!match) return null;
  var normalizado = match[1].replace(/\./g, "").replace(",", ".");
  var valor = Number(normalizado);
  return isNaN(valor) ? 0 : valor;
}

function extrairNumeroAtendimentosWMGJ_V1_(texto) {
  var t = String(texto || "");
  var match = t.match(/(\d{1,6})\s+atendimentos?/i) || t.match(/atendimentos?\D+(\d{1,6})/i);
  if (!match) return null;
  var n = Number(match[1]);
  return isNaN(n) ? 0 : n;
}

function extrairCompetenciaWMGJ_V1_(texto) {
  var t = String(texto || "");
  var direta = t.match(/(20\d{2})[-\/](0[1-9]|1[0-2])/);
  if (direta) return direta[1] + "-" + direta[2];

  var meses = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    março: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12"
  };

  var lower = t.toLowerCase();
  for (var nome in meses) {
    var re = new RegExp(nome + "\\s+(20\\d{2})", "i");
    var m = lower.match(re);
    if (m) return m[1] + "-" + meses[nome];
  }

  return "";
}

function validarDocumentoJsonWMGJ_Compat_(entrada) {
  if (typeof validarDocumentoJsonWMGJ_ === "function") {
    try {
      return validarDocumentoJsonWMGJ_(entrada);
    } catch (erroValidadorOriginal) {}
  }

  var dados = entrada;

  if (typeof dados === "string") {
    try {
      dados = JSON.parse(limparRespostaJsonWMGJ_Compat_(dados));
    } catch (erroParse) {
      return {
        ok: false,
        erro: "JSON_PARSE_ERROR: " + (erroParse.message || String(erroParse)),
        dados: null
      };
    }
  }

  if (!dados || typeof dados !== "object") {
    return {
      ok: false,
      erro: "JSON_INVALIDO",
      dados: null
    };
  }

  var permitidas = {
    financeiro: true,
    produtividade: true,
    contrato: true,
    glosa: true,
    relatorio: true,
    cadastro: true,
    outro: true
  };

  dados.categoria = String(dados.categoria || "outro").toLowerCase();

  if (!permitidas[dados.categoria]) {
    return {
      ok: false,
      erro: "CATEGORIA_INVALIDA",
      dados: dados
    };
  }

  dados.confianca = Number(dados.confianca || 0);

  if (dados.confianca < 0.6) {
    return {
      ok: false,
      erro: "CONFIANCA_BAIXA",
      dados: dados
    };
  }

  return {
    ok: true,
    erro: "",
    dados: dados
  };
}

function limparRespostaJsonWMGJ_Compat_(texto) {
  texto = String(texto || "").trim();
  texto = texto.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  var inicio = texto.indexOf("{");
  var fim = texto.lastIndexOf("}");
  if (inicio >= 0 && fim > inicio) return texto.slice(inicio, fim + 1);
  return texto;
}

function montarResumoMemoriaExtracaoWMGJ_V1_(dados, extracao) {
  var resumo = {
    versao_extracao: WMGJ_EXTRACAO_VERSAO,
    metodo_extracao: extracao.metodo,
    tamanho_texto: extracao.tamanhoTexto,
    categoria: dados.categoria || "",
    tipo_documento: dados.tipo_documento || "",
    competencia: dados.competencia || "",
    valor_total: dados.valor_total || 0,
    atendimentos: dados.atendimentos || 0,
    confianca: dados.confianca || 0,
    origem_classificacao: dados.origem_classificacao || "",
    resumo_operacional: dados.resumo_operacional || dados.descricao || ""
  };

  return JSON.stringify(resumo);
}

function diagnosticarExtracaoRealWMGJ_V1() {
  var gemini = typeof diagnosticarGeminiWMGJ_V1 === "function"
    ? diagnosticarGeminiWMGJ_V1()
    : {
        ok: false,
        configurado: false,
        erro: "diagnosticarGeminiWMGJ_V1 indisponivel"
      };

  var driveApi = typeof Drive !== "undefined" && !!Drive.Files;
  var pasta = diagnosticarPastaEntradaWMGJ_Compat_();
  var cfg = getConfigWMGJ_Compat_();

  var resultado = {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    pastaEntrada: pasta,
    gemini: gemini,
    driveApiAvancadoDisponivel: driveApi,
    abas: {
      fila: cfg.SHEETS.FILA,
      memoria: cfg.SHEETS.MEMORIA,
      extracoes: "16_EXTRACOES_DOCUMENTAIS"
    }
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  registrarLogWMGJ_Compat_("DIAGNOSTICO", "diagnosticarExtracaoRealWMGJ_V1", "AppsScript", JSON.stringify({
    ok: resultado.ok,
    geminiConfigurado: !!(gemini && gemini.configurado),
    driveApiAvancadoDisponivel: driveApi
  }));

  return resultado;
}

function prepararPipelineConfiavelWMGJ_Compat_(limite) {
  if (typeof prepararPipelineConfiavelWMGJ_V3 === "function") {
    return prepararPipelineConfiavelWMGJ_V3(limite || 100);
  }

  return prepararPipelineConfiavelWMGJ_Local_(limite || 100);
}

function prepararPipelineConfiavelWMGJ_Local_(limite) {
  return comTravaIngestaoGmailWMGJ_(function() { return prepararPipelineConfiavelWMGJ_Local_SobTrava_(limite); });
}

function prepararPipelineConfiavelWMGJ_Local_SobTrava_(limite) {
  garantirAbasControleExtracaoWMGJ_V1_();

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var fila = ss.getSheetByName(cfg.SHEETS.FILA);
  var pastaId = obterPastaEntradaIdWMGJ_Compat_();
  var pasta = DriveApp.getFolderById(pastaId);
  var files = pasta.getFiles();

  var existentes = carregarIdsFilaWMGJ_Compat_(fila);
  var lidos = 0;
  var enfileirados = 0;
  var duplicados = 0;
  var max = Number(limite) || 100;

  while (files.hasNext() && lidos < max) {
    var file = files.next();
    lidos++;

    if (existentes[file.getId()]) {
      duplicados++;
      continue;
    }

    fila.appendRow([
      new Date(),
      "DRIVE",
      file.getId(),
      file.getName(),
      file.getMimeType(),
      "PENDENTE",
      0,
      "EXTRAIR_CONTEUDO",
      "",
      "Enfileirado por compat local"
    ]);

    existentes[file.getId()] = true;
    enfileirados++;
  }

  var resultado = {
    ok: true,
    etapa: "prepararPipelineConfiavelWMGJ_Local_",
    resultado: {
      ok: true,
      pastaEntradaId: pastaId,
      pastaEntradaNome: pasta.getName(),
      lidos: lidos,
      enfileirados: enfileirados,
      duplicados: duplicados
    }
  };

  registrarLogWMGJ_Compat_("OK", "prepararPipelineConfiavelWMGJ_Local_", "AppsScript", JSON.stringify(resultado));
  return resultado;
}

function diagnosticarPastaEntradaWMGJ_Compat_() {
  if (typeof diagnosticarPastaEntradaWMGJ_V3 === "function") {
    try {
      return diagnosticarPastaEntradaWMGJ_V3();
    } catch (erroDiagOriginal) {}
  }

  try {
    var pastaId = obterPastaEntradaIdWMGJ_Compat_();
    var pasta = DriveApp.getFolderById(pastaId);
    return {
      ok: true,
      pastaId: pastaId,
      nome: pasta.getName()
    };
  } catch (erro) {
    return {
      ok: false,
      pastaId: obterPastaEntradaIdWMGJ_Compat_(),
      erro: erro && erro.message ? erro.message : String(erro)
    };
  }
}

function obterPastaEntradaIdWMGJ_Compat_() {
  var props = PropertiesService.getScriptProperties();
  var propId = props.getProperty("WMGJ_PASTA_ENTRADA_ID");
  if (propId) return propId;

  var cfg = getConfigWMGJ_Compat_();

  if (cfg.PASTA_ENTRADA_ID) return cfg.PASTA_ENTRADA_ID;
  if (cfg.FOLDER_ID_ENTRADA) return cfg.FOLDER_ID_ENTRADA;
  if (cfg.PASTAS && cfg.PASTAS.ENTRADA) return cfg.PASTAS.ENTRADA;
  if (cfg.FOLDERS && cfg.FOLDERS.ENTRADA) return cfg.FOLDERS.ENTRADA;

  return WMGJ_EXTRACAO_PASTA_PADRAO_ID;
}

function garantirAbasControleExtracaoWMGJ_V1_() {
  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();

  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.LOG, [
    "DATA",
    "STATUS",
    "FUNCAO",
    "ORIGEM",
    "MENSAGEM"
  ]);

  obterOuCriarAbaWMGJ_Compat_(ss, "13_CONTROLE_PIPELINE", [
    "ETAPA",
    "COMPONENTE",
    "STATUS_ATUAL",
    "EVIDENCIA",
    "RISCO",
    "ACAO_CORRETIVA",
    "RESPONSAVEL",
    "SLA",
    "BLOQUEIA_PRODUCAO",
    "ULTIMA_VALIDACAO",
    "OBS"
  ]);

  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaExtracaoWMGJ_V1_());
  obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.FILA, cabecalhoFilaExtracaoWMGJ_V1_());

  return {
    ok: true,
    versao: WMGJ_EXTRACAO_VERSAO,
    mensagem: "Abas de controle da extração garantidas por compatibilidade local"
  };
}

function garantirAbaExtracoesDocumentaisWMGJ_V1_() {
  var ss = getPlanilhaWMGJ_Compat_();
  return obterOuCriarAbaWMGJ_Compat_(ss, "16_EXTRACOES_DOCUMENTAIS", [
    "DATA_EXTRACAO",
    "VERSAO",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "HASH",
    "METODO_EXTRACAO",
    "TAMANHO_TEXTO",
    "STATUS",
    "OBSERVACAO",
    "AMOSTRA_TEXTO"
  ]);
}

function registrarExtracaoDocumentalWMGJ_V1_(file, hash, extracao) {
  var aba = garantirAbaExtracoesDocumentaisWMGJ_V1_();

  aba.appendRow([
    new Date(),
    WMGJ_EXTRACAO_VERSAO,
    file.getId(),
    file.getName(),
    file.getMimeType(),
    hash,
    extracao.metodo,
    extracao.tamanhoTexto || 0,
    extracao.ok ? "OK" : "FALLBACK",
    extracao.observacao || "",
    String(extracao.texto || "").slice(0, 2000)
  ]);
}

function registrarDocumentoMemoriaWMGJ_Compat_(memoria, doc) {
  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  memoria = memoria || ss.getSheetByName(cfg.SHEETS.MEMORIA);
  memoria = memoria || obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.MEMORIA, cabecalhoMemoriaExtracaoWMGJ_V1_());

  memoria.appendRow([
    new Date(),
    doc.origem || "",
    doc.idOrigem || "",
    doc.nome || "",
    doc.mimeType || "",
    doc.hash || "",
    doc.competencia || "",
    doc.categoria || "outro",
    doc.status || "PROCESSADO",
    doc.resumo || ""
  ]);
}

function documentoJaProcessadoWMGJ_Compat_(idOrigem, hash) {
  if (typeof documentoJaProcessadoWMGJ_ === "function") {
    try {
      return documentoJaProcessadoWMGJ_(idOrigem, hash);
    } catch (erroDedupOriginal) {}
  }

  var cfg = getConfigWMGJ_Compat_();
  var ss = getPlanilhaWMGJ_Compat_();
  var memoria = ss.getSheetByName(cfg.SHEETS.MEMORIA);

  if (!memoria || memoria.getLastRow() < 2) return false;

  var dados = memoria.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var mesmoId = String(dados[i][idx.ID_ORIGEM] || "") === String(idOrigem || "");
    var mesmoHash = String(dados[i][idx.HASH] || "") === String(hash || "");
    var status = String(dados[i][idx.STATUS] || "").toUpperCase();

    if (mesmoId && mesmoHash && status === "PROCESSADO") {
      return true;
    }
  }

  return false;
}

function gerarHashArquivoWMGJ_Compat_(file) {
  if (typeof gerarHashArquivoWMGJ_ === "function") {
    try {
      return gerarHashArquivoWMGJ_(file);
    } catch (erroHashOriginal) {}
  }

  try {
    var bytes = file.getBlob().getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
    return digest.map(function(byte) {
      var v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? "0" + v : v;
    }).join("");
  } catch (erro) {
    return [file.getId(), file.getName(), file.getLastUpdated().getTime()].join("|");
  }
}

function atualizarLinhaFilaWMGJ_Compat_(sheet, rowNumber, idx, campos) {
  Object.keys(campos).forEach(function(nomeCampo) {
    if (idx[nomeCampo] === undefined || idx[nomeCampo] === null || idx[nomeCampo] < 0) return;
    sheet.getRange(rowNumber, idx[nomeCampo] + 1).setValue(campos[nomeCampo]);
  });
}

function carregarIdsFilaWMGJ_Compat_(fila) {
  var mapa = {};
  if (!fila || fila.getLastRow() < 2) return mapa;

  var dados = fila.getDataRange().getValues();
  var idx = mapearCabecalhoWMGJ_Compat_(dados[0]);

  for (var i = 1; i < dados.length; i++) {
    var id = String(dados[i][idx.ID_ORIGEM] || "");
    if (id) mapa[id] = true;
  }

  return mapa;
}

function mapearCabecalhoWMGJ_Compat_(headers) {
  var mapa = {};
  headers = headers || [];

  for (var i = 0; i < headers.length; i++) {
    var chave = String(headers[i] || "").trim();
    if (chave) mapa[chave] = i;
  }

  return mapa;
}

function obterOuCriarAbaWMGJ_Compat_(ss, nome, cabecalho) {
  var sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
  }

  cabecalho = cabecalho || [];

  if (cabecalho.length > 0) {
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    } else {
      garantirCabecalhosMinimosWMGJ_Compat_(sheet, cabecalho);
    }
  }

  return sheet;
}

function garantirCabecalhosMinimosWMGJ_Compat_(sheet, cabecalhoNecessario) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var atual = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var existentes = {};

  atual.forEach(function(h) {
    existentes[String(h || "").trim()] = true;
  });

  var faltantes = [];
  cabecalhoNecessario.forEach(function(h) {
    if (!existentes[h]) faltantes.push(h);
  });

  if (faltantes.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, faltantes.length).setValues([faltantes]);
  }
}

function getConfigWMGJ_Compat_() {
  var cfg = {};

  if (typeof getConfigWMGJ_ === "function") {
    try {
      cfg = getConfigWMGJ_() || {};
    } catch (erroConfigOriginal) {
      cfg = {};
    }
  }

  cfg.SHEETS = cfg.SHEETS || {};
  cfg.SHEETS.LOG = cfg.SHEETS.LOG || "10_LOG_AUTOMACAO";
  cfg.SHEETS.CONTROLE = cfg.SHEETS.CONTROLE || "13_CONTROLE_PIPELINE";
  cfg.SHEETS.MEMORIA = cfg.SHEETS.MEMORIA || "14_MEMORIA_BASE_DOCUMENTOS";
  cfg.SHEETS.FILA = cfg.SHEETS.FILA || "15_FILA_PROCESSAMENTO";

  return cfg;
}

function getPlanilhaWMGJ_Compat_() {
  if (typeof getPlanilha === "function") {
    try {
      var original = getPlanilha();
      if (original) return original;
    } catch (erroPlanilhaOriginal) {}
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("WMGJ_SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);

  var ativa = SpreadsheetApp.getActiveSpreadsheet();
  if (!ativa) {
    throw new Error("PLANILHA_NAO_ENCONTRADA: vincule o Apps Script à planilha ou defina WMGJ_SPREADSHEET_ID");
  }

  return ativa;
}

function registrarLogWMGJ_Compat_(status, funcao, origem, mensagem) {
  if (typeof registrarLogWMGJ_ === "function") {
    try {
      registrarLogWMGJ_(status, funcao, origem, mensagem);
      return;
    } catch (erroLogOriginal) {}
  }

  try {
    var cfg = getConfigWMGJ_Compat_();
    var ss = getPlanilhaWMGJ_Compat_();
    var log = obterOuCriarAbaWMGJ_Compat_(ss, cfg.SHEETS.LOG, [
      "DATA",
      "STATUS",
      "FUNCAO",
      "ORIGEM",
      "MENSAGEM"
    ]);

    log.appendRow([
      new Date(),
      status || "INFO",
      funcao || "",
      origem || "AppsScript",
      mensagem || ""
    ]);
  } catch (erro) {
    Logger.log("LOG_FALLBACK: " + [status, funcao, origem, mensagem].join(" | "));
  }
}

function cabecalhoFilaExtracaoWMGJ_V1_() {
  return [
    "DATA_ENTRADA",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "STATUS",
    "TENTATIVAS",
    "PROXIMA_ACAO",
    "ULTIMO_ERRO",
    "OBSERVACAO"
  ];
}

function cabecalhoMemoriaExtracaoWMGJ_V1_() {
  return [
    "DATA_PROCESSAMENTO",
    "ORIGEM",
    "ID_ORIGEM",
    "NOME_ARQUIVO",
    "MIME_TYPE",
    "HASH",
    "COMPETENCIA",
    "CATEGORIA",
    "STATUS",
    "RESUMO"
  ];
}

function rodarDiagnosticoExtracaoRealWMGJ() {
  return diagnosticarExtracaoRealWMGJ_V1();
}

function rodarExtracaoRealWMGJ_5() {
  return executarExtracaoRealWMGJ_V1(5);
}

/* Scoped extraction writes review-only canonical documents through the existing bridge.
 * Quantities, dates and monetary facts are never inferred by the generic regex classifier. */
function auroraProcessarFilaDriveAutorizada_(fila, options, limit, deadlineMs) {
  var rows=fila.getDataRange().getValues(),idx=mapearCabecalhoWMGJ_Compat_(rows[0]);
  var result={attempted:0,processed:0,accepted:0,duplicates:0,aliases:0,pending:0,review:0,
    errors:0,blockingErrors:0,privateReadbackPlan:[]}, knownHashes={};
  for (var k=1;k<rows.length;k++) {
    var previous=auroraDriveScopeRead_(rows[k][idx.OBSERVACAO]);
    if (previous && previous.orgId===options.orgId && previous.scopeSha256===options.scopeSha256
      && previous.contentSha256 && previous.receipt
      && previous.receipt.replayVerified===true && previous.coverage==='EXTRACTED_REVIEW_PENDING') knownHashes[previous.contentSha256]=previous;
  }
  var processKey='AURORA_DRIVE_PROCESS_'+options.orgId+'_'+options.scopeSha256.slice(0,24);
  var processProps=PropertiesService.getScriptProperties(),priorityKey=processKey+'_PRIORITY_V1';
  var groupCursors=JSON.parse(processProps.getProperty(priorityKey)||'{}');
  if(!groupCursors || typeof groupCursors!=='object' || Array.isArray(groupCursors)
    || !Object.keys(groupCursors).every(function(key){return Number.isSafeInteger(groupCursors[key]) && groupCursors[key]>=0;}))
    throw new Error('AURORA_DRIVE_PROCESS_CURSOR_INVALID');
  var candidateRows=[];
  for(var n=1;n<rows.length;n++) {
    var candidateScope=auroraDriveScopeRead_(rows[n][idx.OBSERVACAO]);
    if(candidateScope && candidateScope.orgId===options.orgId && candidateScope.scopeSha256===options.scopeSha256
      && ['PENDENTE','ERRO_REPROCESSAR'].indexOf(String(rows[n][idx.STATUS]))>=0) {
      var explicitIndex=(options.fileIds||[]).indexOf(candidateScope.fileId);
      var sourceIndex=(options.sources||[]).findIndex(function(source) {
        return source.sourceId===candidateScope.sourceId && source.folderId===candidateScope.rootId;
      });
      candidateRows.push({row:n,retry:String(rows[n][idx.STATUS])==='ERRO_REPROCESSAR',
        priority:explicitIndex>=0?0:(sourceIndex>=0?sourceIndex+1:options.sources.length+1),
        group:explicitIndex>=0?'explicit':(sourceIndex>=0?'source:'+options.sources[sourceIndex].sourceId:'unmapped'),
        ordinal:explicitIndex>=0?explicitIndex+1:n});
    }
  }
  candidateRows.sort(function(a,b) {
    // Failed canaries must not consume every bounded cycle before untouched roots.
    if(a.retry!==b.retry) return a.retry?1:-1;
    if(a.priority!==b.priority) return a.priority-b.priority;
    var cursor=groupCursors[a.group]||0;
    return (a.ordinal>cursor?0:1)-(b.ordinal>cursor?0:1)||a.ordinal-b.ordinal;
  });
  function rememberAttempt(candidate) {
    groupCursors[candidate.group]=candidate.ordinal;
    processProps.setProperty(priorityKey,JSON.stringify(groupCursors));
  }
  function checkAuthority() {
    if(typeof options.beforeRequest==='function') options.beforeRequest();
    if(Date.now()>=deadlineMs || PropertiesService.getScriptProperties().getProperty('WMGJ_FIRESTORE_ORG_ID')!==options.orgId)
      throw new Error('AURORA_DRIVE_AUTHORITY_RECHECK_FAILED');
  }
  function receiptValid(response) {
    return !!response && (response.accepted===true || response.duplicate===true)
      && !(response.accepted===true && response.duplicate===true)
      && /^[a-f0-9]{48}$/.test(response.entityId||'')
      && Number.isSafeInteger(response.revision) && response.revision>=1
      && typeof response.versionId==='string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(response.versionId);
  }
  for (var c=0;c<candidateRows.length && result.attempted<limit && Date.now()<deadlineMs-15000;c++) {
    var candidate=candidateRows[c],i=candidate.row;
    var row=rows[i], scope=auroraDriveScopeRead_(row[idx.OBSERVACAO]);
    if (!scope || scope.orgId!==options.orgId || scope.scopeSha256!==options.scopeSha256
      || ['PENDENTE','ERRO_REPROCESSAR'].indexOf(String(row[idx.STATUS]))<0) continue;
    result.attempted++;
    try {
      checkAuthority();
      if (scope.fileId!==String(row[idx.ID_ORIGEM])) throw new Error('AURORA_DRIVE_QUEUE_ID_CONFLICT');
      var file=DriveApp.getFileById(scope.fileId);
      if (scope.explicit) {
        if ((options.fileIds||[]).indexOf(scope.fileId)<0) throw new Error('AURORA_DRIVE_SOURCE_REVOKED');
      } else {
        var registered=options.sources.some(function(s){return s.folderId===scope.rootId && s.sourceId===scope.sourceId;});
        if (!registered) throw new Error('AURORA_DRIVE_SOURCE_REVOKED');
        var parents=file.getParents(),found=false;
        while(parents.hasNext()) if(parents.next().getId()===scope.folderId) found=true;
        if(!found || (options.excludedFolderIds||[]).indexOf(scope.folderId)>=0) throw new Error('AURORA_DRIVE_SOURCE_MOVED');
        var parentQueue=[scope.folderId],checked={},authorizedRoot=false,steps=0;
        while(parentQueue.length && steps++<64) {
          var folderId=parentQueue.shift();
          if(checked[folderId]) continue;checked[folderId]=true;
          if((options.excludedFolderIds||[]).indexOf(folderId)>=0) continue;
          if(folderId===scope.rootId){authorizedRoot=true;break;}
          var folderParents=DriveApp.getFolderById(folderId).getParents();
          while(folderParents.hasNext()) parentQueue.push(folderParents.next().getId());
        }
        if(!authorizedRoot) throw new Error('AURORA_DRIVE_SOURCE_MOVED');
      }
      var version=String(file.getLastUpdated().getTime());
      if(version!==scope.sourceVersion) {
        // The original source remains authorized. Refresh this queue row instead of
        // requiring a completed enumeration cursor to run again.
        scope.previousSourceVersion=scope.sourceVersion;scope.sourceVersion=version;
        scope.coverage='PENDING_EXTRACTION';delete scope.receipt;delete scope.aliasFileId;
        delete scope.contentSha256;delete scope.textSha256;
        atualizarLinhaFilaWMGJ_Compat_(fila,i+1,idx,{STATUS:'PENDENTE',OBSERVACAO:auroraDriveScopeWrite_(scope)});
      }
      if(file.getSize()>16*1024*1024) throw new Error('AURORA_DRIVE_FILE_SIZE_LIMIT');
      var byteHash=wmgjFirestoreHashArquivo_(file);
      if(byteHash.method!=='content_sha256') throw new Error('AURORA_DRIVE_BYTES_REQUIRED');
      var alias=knownHashes[byteHash.value];
      if(alias && alias.fileId!==scope.fileId) {
        scope.contentSha256=byteHash.value;scope.coverage='DUPLICATE_CONTENT';scope.aliasFileId=alias.fileId;scope.receipt=alias.receipt;
        atualizarLinhaFilaWMGJ_Compat_(fila,i+1,idx,{STATUS:'DUPLICADO',ULTIMO_ERRO:'',OBSERVACAO:auroraDriveScopeWrite_(scope)});
        result.aliases++;rememberAttempt(candidate);continue;
      }
      var extraction=extrairConteudoArquivoWMGJ_V1_(file,deadlineMs);
      if(!extracaoDocumentalCompletaWMGJ_(extraction)) {
        var empty=extraction && extraction.ok===true && typeof extraction.texto==='string' && !extraction.texto.trim();
        throw new Error(auroraCodigoFalhaExtracaoDrive_(extraction && (extraction.code || extraction.observacao),
          empty?'AURORA_DRIVE_EXTRACTION_EMPTY':'AURORA_DRIVE_CONTENT_READ_FAILED'));
      }
      if(extraction.metodo==='blob_text' && /[\uFFFD\u0000]/.test(extraction.texto))
        throw new Error('AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED');
      if(extraction.texto.length>1048576) throw new Error('AURORA_DRIVE_TEXT_LIMIT');
      if(String(file.getLastUpdated().getTime())!==version) throw new Error('AURORA_DRIVE_SOURCE_CHANGED_DURING_EXTRACTION');
      var textHash=wmgjFirestoreHashString_(extraction.texto);
      var classification={categoria:'outro',tipo_documento:'documento_extraido_pendente_revisao',confianca:0,
        competencia:null,valor_total:null,atendimentos:null,metodo_extracao:extraction.metodo,
        status:'PENDING_HUMAN_REVIEW',origem_classificacao:'aurora_drive_acquisition_v1',nivel_risco:'medio'};
      var event=wmgjFirestoreEventoArquivo_(file,classification,{sourceContext:'authorized-drive-full-review',
        sourceSystem:'DRIVE',originConnector:'DRIVE_FOLDER',mirrorRequired:true,sourceRegistryVersion:'1',pipelineVersion:'drive-continuation-v1'});
      if(event.orgId!==options.orgId || event.source.contentHash!==byteHash.value || event.sourceVersion!==Number(version))
        throw new Error('AURORA_DRIVE_EVENT_SOURCE_CONFLICT');
      var manifested=['google_sheets_manifest','zip_manifest','pdf_encrypted_manifest'].indexOf(extraction.metodo)>=0;
      event.record.extractionEvidence={schemaVersion:1,contentSha256:byteHash.value,textSha256:textHash,
        textLength:extraction.texto.length,method:extraction.metodo,
        coverage:manifested?'SOURCE_MANIFESTED_REVIEW_PENDING':'TEXT_EXTRACTED_REVIEW_PENDING',
        sourceVersion:Number(version),financialFactsApproved:false};
      // A later source version is a distinct semantic event even when its bytes
      // are unchanged. Keep this contract local to the authorized Drive route;
      // retries of the same version retain the same key and semantic payload.
      event.idempotencyKey=[event.orgId,'DRIVE',scope.fileId,'drive-extraction-v1',
        String(event.sourceVersion),byteHash.value].join(':');
      var response=wmgjFirestoreEnviarEventoComConfig_(event,options.config,function(){},checkAuthority);
      if(!receiptValid(response)) throw new Error('AURORA_DRIVE_RECEIPT_REQUIRED');
      // Replay the identical event, including eventId and idempotencyKey. Its transport
      // uses fresh HMAC nonce/timestamp while canonical revision must remain unchanged.
      var replay=wmgjFirestoreEnviarEventoComConfig_(event,options.config,function(){},checkAuthority);
      if(!receiptValid(replay) || replay.duplicate!==true || replay.entityId!==response.entityId
        || replay.versionId!==response.versionId || replay.revision!==response.revision)
        throw new Error('AURORA_DRIVE_REPLAY_NOT_IDEMPOTENT');
      var receipt={entityId:response.entityId,eventId:response.eventId||event.eventId,sourceId:scope.fileId,
        sourceVersion:event.sourceVersion,revision:response.revision,versionId:response.versionId,replayVerified:true,
        canonicalSnapshotHash:event.record.canonicalSnapshotHash,contentHash:byteHash.value,contentSha256:byteHash.value,textSha256:textHash};
      scope.contentSha256=byteHash.value;scope.textSha256=textHash;
      scope.coverage=manifested?'SOURCE_MANIFESTED_REVIEW_PENDING':'EXTRACTED_REVIEW_PENDING';scope.receipt=receipt;
      delete scope.lastCode;
      registrarExtracaoDocumentalWMGJ_V1_(file,byteHash.value,extraction);
      registrarFirestoreMirrorWMGJ_(file,byteHash.value,{ok:true,required:true,status:response.duplicate?'DUPLICATE_CONFIRMED':'ACCEPTED',entityId:response.entityId,eventId:receipt.eventId});
      atualizarLinhaFilaWMGJ_Compat_(fila,i+1,idx,{STATUS:'REVISAR_HUMANO',ULTIMO_ERRO:'',OBSERVACAO:auroraDriveScopeWrite_(scope)});
      knownHashes[byteHash.value]=scope;result.processed++;
      if(response.duplicate===true) result.duplicates++; else result.accepted++;
      result.privateReadbackPlan.push(receipt);
    } catch(error) {
      var code=String(error && error.message || 'AURORA_DRIVE_EXTRACTION_FAILED');
      if(!/^[A-Z][A-Z0-9_:.-]{0,160}$/.test(code)) code='AURORA_DRIVE_EXTRACTION_FAILED';
      var recoverable=['PENDING_EXTRACTION','AURORA_DRIVE_FILE_SIZE_LIMIT','AURORA_DRIVE_TEXT_LIMIT',
        'AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED',
        'AURORA_DRIVE_EXTRACTION_QUOTA','AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE',
        'AURORA_DRIVE_CONVERSION_UNSUPPORTED','AURORA_DRIVE_CONVERSION_FAILED','AURORA_DRIVE_CONVERSION_NOT_READY',
        'AURORA_DRIVE_CONVERSION_DEFERRED',
        'AURORA_DRIVE_EXTRACTION_EMPTY','AURORA_DRIVE_FORMAT_UNSUPPORTED','AURORA_DRIVE_CONTENT_READ_FAILED',
        'AURORA_DRIVE_OFX_SIGNATURE_INVALID','AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED',
        'AURORA_SHEETS_TEXT_LIMIT','AURORA_SHEETS_CELL_LIMIT','AURORA_ZIP_EXTRACTION_FAILED','AURORA_ZIP_ENTRY_LIMIT',
        'AURORA_ZIP_UNCOMPRESSED_SIZE_LIMIT','AURORA_DRIVE_SOURCE_CHANGED_DURING_EXTRACTION'].indexOf(code)>=0;
      scope.coverage='PENDING_EXTRACTION';scope.lastCode=code;
      atualizarLinhaFilaWMGJ_Compat_(fila,i+1,idx,{STATUS:'ERRO_REPROCESSAR',TENTATIVAS:Number(row[idx.TENTATIVAS]||0)+1,
        ULTIMO_ERRO:code,OBSERVACAO:auroraDriveScopeWrite_(scope)});
      result.errors++;
      if(!recoverable) result.blockingErrors++;
    }
    rememberAttempt(candidate);
    if(result.blockingErrors>0) break;
  }
  // Totals cover the entire scoped queue, including documents not attempted this cycle.
  var after=fila.getDataRange().getValues();
  for(var a=1;a<after.length;a++) {
    var finalScope=auroraDriveScopeRead_(after[a][idx.OBSERVACAO]);
    if(!finalScope || finalScope.orgId!==options.orgId || finalScope.scopeSha256!==options.scopeSha256) continue;
    if(finalScope.coverage==='EXTRACTED_REVIEW_PENDING' && finalScope.receipt && finalScope.receipt.replayVerified===true) result.review++;
    else if(finalScope.coverage!=='DUPLICATE_CONTENT') result.pending++;
  }
  return result;
}

// Full row coverage, bounded before each read/allocation. Limit failures stay explicit.
function auroraExtrairTextoSheetsCompleto_(spreadsheetId) {
  var ss=SpreadsheetApp.openById(spreadsheetId),parts=[],characters=0,cells=0;
  function append(text) {
    characters+=text.length+1;
    if(characters>1048576) throw new Error('AURORA_SHEETS_TEXT_LIMIT');
    parts.push(text);
  }
  ss.getSheets().forEach(function(sheet){
    var lastRow=sheet.getLastRow(),lastColumn=sheet.getLastColumn();
    if(!lastRow || !lastColumn) return;
    if(lastColumn>256 || lastRow*lastColumn>1000000-cells) throw new Error('AURORA_SHEETS_CELL_LIMIT');
    cells+=lastRow*lastColumn;
    var headerWritten=false;
    for(var start=1;start<=lastRow;start+=200){
      var values=sheet.getRange(start,1,Math.min(200,lastRow-start+1),lastColumn).getDisplayValues();
      values.forEach(function(row){
        if(!row.some(function(value){return String(value).trim().length>0;})) return;
        if(!headerWritten){append('ABA: '+sheet.getName());headerWritten=true;}
        append(row.join(' | '));
      });
    }
  });
  return parts.join('\n');
}

/* Read-only receipt recovery for the authenticated wrapper. The coordinator must
 * actually verify each returned canonical record; replayVerified is not readback. */
function auroraDrivePendingDiagnostic_(scope, row, idx) {
  if(typeof scope.fileId!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(scope.fileId)
    || row[idx.ID_ORIGEM]!==scope.fileId) throw new Error('AURORA_DRIVE_QUEUE_SCOPE_INVALID');
  var codes=['PENDING_EXTRACTION','AURORA_DRIVE_EXTRACTION_AUTH_FAILED','AURORA_DRIVE_EXTRACTION_QUOTA',
    'AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE','AURORA_DRIVE_CONVERSION_UNSUPPORTED',
    'AURORA_DRIVE_CONVERSION_FAILED','AURORA_DRIVE_CONVERSION_NOT_READY','AURORA_DRIVE_CONVERSION_DEFERRED',
    'AURORA_DRIVE_FILE_SIZE_LIMIT','AURORA_DRIVE_TEXT_LIMIT','AURORA_DRIVE_EXTRACTION_EMPTY',
    'AURORA_DRIVE_FORMAT_UNSUPPORTED','AURORA_DRIVE_CONTENT_READ_FAILED','AURORA_DRIVE_OFX_SIGNATURE_INVALID',
    'AURORA_DRIVE_OFX_ENCODING_UNSUPPORTED','AURORA_DRIVE_TEXT_ENCODING_UNVERIFIED',
    'AURORA_DRIVE_SOURCE_CHANGED_DURING_EXTRACTION','AURORA_DRIVE_EXTRACTION_FAILED',
    'AURORA_DRIVE_AUTHORITY_RECHECK_FAILED','AURORA_DRIVE_BYTES_REQUIRED','AURORA_DRIVE_EVENT_SOURCE_CONFLICT',
    'AURORA_DRIVE_QUEUE_ID_CONFLICT','AURORA_DRIVE_RECEIPT_REQUIRED','AURORA_DRIVE_REPLAY_NOT_IDEMPOTENT',
    'AURORA_DRIVE_SOURCE_MOVED','AURORA_DRIVE_SOURCE_REVOKED','AURORA_SHEETS_TEXT_LIMIT','AURORA_SHEETS_CELL_LIMIT',
    'AURORA_DRIVE_RETRY_BUDGET_EXHAUSTED','AURORA_DRIVE_LEGACY_REVIEW_REASON_UNRECORDED',
    'AURORA_DRIVE_BACKLOG_NON_BLOCKING_OWNER_ACCEPTED',
    'AURORA_ZIP_EXTRACTION_FAILED','AURORA_ZIP_ENTRY_LIMIT','AURORA_ZIP_UNCOMPRESSED_SIZE_LIMIT',
    'AURORA_CONNECTOR_REUSE_OWNER_REQUIRED','AURORA_DRIVE_TENANT_MISMATCH','AURORA_DRIVE_DEPENDENCY_MISSING',
    'AURORA_DRIVE_CONFIGURATION_INVALID','AURORA_DRIVE_SCOPE_CHANGED','AURORA_DRIVE_DEADLINE_EXCEEDED',
    'CONFIG_FIRESTORE_INCOMPLETA','EVENTO_FIRESTORE_INVALIDO','HMAC_SECRET_HEX_INVALIDO','HMAC_SECRET_BYTES_INVALIDO'];
  var raw=scope.lastCode,code=raw===undefined || raw===null || raw===''?'NOT_RECORDED'
    : codes.indexOf(raw)>=0?raw:'UNKNOWN';
  if(typeof raw==='string' && /^FIRESTORE_INGEST_FAILED:(?:INVALID_SUCCESS_RESPONSE|HTTP_(?:[1-5][0-9]{2}|OTHER):(?:METHOD_NOT_ALLOWED|UNSUPPORTED_MEDIA_TYPE|SECURITY_CONFIGURATION_ERROR|INVALID_SIGNATURE|INVALID_JSON|VALIDATION_ERROR|SIGNED_HEADER_BODY_MISMATCH|KEY_SCOPE_VIOLATION|REPLAY_DETECTED|IDEMPOTENCY_CONFLICT|NO_STRUCTURED_RESPONSE|UNRECOGNIZED_RESPONSE))$/.test(raw))
    code='FIRESTORE_INGEST_FAILED';
  var status=row[idx.STATUS],statuses=['PENDENTE','PROCESSANDO','EXTRAINDO','CLASSIFICANDO',
    'PROCESSADO','ERRO_REPROCESSAR','DUPLICADO','REVISAR_HUMANO'];
  var mime=row[idx.MIME_TYPE],mediaType='OTHER';
  if(mime==='application/pdf') mediaType='PDF';
  else if(mime==='application/vnd.google-apps.spreadsheet') mediaType='GOOGLE_SHEETS';
  else if(mime==='application/vnd.google-apps.document') mediaType='GOOGLE_DOCS';
  else if(mime==='application/zip' || mime==='application/x-zip-compressed') mediaType='ZIP';
  else if(['text/plain','text/csv','text/tab-separated-values','application/json','application/xml','text/xml'].indexOf(mime)>=0) mediaType='TEXT';
  else if(['application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet'].indexOf(mime)>=0) mediaType='OFFICE';
  else if(['image/png','image/jpeg','image/tiff','image/webp'].indexOf(mime)>=0) mediaType='IMAGE';
  var attempts=row[idx.TENTATIVAS],version=Number(scope.sourceVersion);
  var versionType=typeof scope.sourceVersion==='number'
    || typeof scope.sourceVersion==='string' && /^[1-9][0-9]{0,15}$/.test(scope.sourceVersion);
  // Queue metadata only. No file content, free-form errors, names or legacy hashes.
  return {fileId:scope.fileId,sourceVersion:versionType && Number.isSafeInteger(version) && version>0?version:null,
    queueStatus:statuses.indexOf(status)>=0?status:'UNKNOWN',
    attempts:Number.isSafeInteger(attempts) && attempts>=0?attempts:null,code:code,mediaType:mediaType};
}

function auroraLerPlanoReadbackDriveAutorizado_(options) {
  var ss=getPlanilhaWMGJ_Compat_(),fila=ss.getSheetByName(getConfigWMGJ_Compat_().SHEETS.FILA);
  var rows=fila.getDataRange().getValues(),idx=mapearCabecalhoWMGJ_Compat_(rows[0]),scoped=[];
  var offset=Number(options.readbackOffset),limit=Math.min(40,Number(options.readbackLimit || 20));
  if(!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1)
    throw new Error('AURORA_DRIVE_READBACK_CURSOR_INVALID');
  var result={privateReadbackPlan:[],privateAliasRows:[],privatePendingRows:[],coverage:{offset:offset,nextOffset:null,
    total:0,documents:0,aliases:0,pending:0,complete:false,returned:0,pageDocuments:0,pageAliases:0,pagePending:0},
    fullSynchronizationVerified:false};
  var coverage=result.coverage;
  for(var r=1;r<rows.length;r++) {
    var scope=auroraDriveScopeRead_(rows[r][idx.OBSERVACAO]);
    if(!scope || scope.orgId!==options.orgId || scope.scopeSha256!==options.scopeSha256) continue;
    if(typeof scope.fileId!=='string' || !/^[A-Za-z0-9_-]{10,200}$/.test(scope.fileId)
      || rows[r][idx.ID_ORIGEM]!==scope.fileId) throw new Error('AURORA_DRIVE_QUEUE_SCOPE_INVALID');
    var receipt=scope.receipt,kind='pending';
    var proven=receipt && receipt.replayVerified===true && scope.contentSha256===receipt.contentHash
      && receipt.contentHash===receipt.contentSha256;
    if(proven && scope.coverage==='EXTRACTED_REVIEW_PENDING' && receipt.sourceId===scope.fileId
      && receipt.sourceVersion===Number(scope.sourceVersion)) kind='documents';
    else if(proven && scope.coverage==='DUPLICATE_CONTENT' && scope.aliasFileId && scope.aliasFileId===receipt.sourceId) kind='aliases';
    coverage[kind]++;scoped.push({scope:scope,kind:kind,row:rows[r]});
  }
  coverage.total=scoped.length;
  if(offset>coverage.total) throw new Error('AURORA_DRIVE_READBACK_CURSOR_INVALID');
  var end=Math.min(offset+limit,coverage.total);
  coverage.returned=end-offset;coverage.nextOffset=end<coverage.total?end:null;coverage.complete=coverage.nextOffset===null;
  for(var i=offset;i<end;i++) {
    var item=scoped[i],value=item.scope;
    if(item.kind==='pending') {
      result.privatePendingRows.push(auroraDrivePendingDiagnostic_(value,item.row,idx));
      coverage.pagePending++;continue;
    }
    result.privateReadbackPlan.push(value.receipt);
    if(item.kind==='documents') coverage.pageDocuments++;
    else {
      coverage.pageAliases++;
      result.privateAliasRows.push({fileId:value.fileId,primaryFileId:value.aliasFileId,
        contentHash:value.contentSha256,entityId:value.receipt.entityId});
    }
  }
  return result;
}
