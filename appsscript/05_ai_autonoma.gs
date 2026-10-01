function chamarGeminiWMGJ(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(WMGJ_CONFIG.AI.GEMINI_KEY_PROPERTY);
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status >= 300) throw new Error('Erro Gemini HTTP ' + status + ': ' + body);

  const json = JSON.parse(body);
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function extrairJsonIAWMGJ(texto) {
  const limpo = String(texto || '')
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(limpo);
  } catch (e) {
    const ini = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');
    if (ini >= 0 && fim > ini) return JSON.parse(limpo.slice(ini, fim + 1));
    throw e;
  }
}

function classificarDesconhecidosComIAWMGJ() {
  const ss = getPlanilha();
  const sheet = ss.getSheetByName(WMGJ_CONFIG.SHEETS.EXTRATO_CLASSIFICADO);
  const pend = getOrCreateSheetWMGJ(WMGJ_CONFIG.SHEETS.PENDENCIAS, [
    'DATA_HORA','ORIGEM','DESCRICAO','VALOR','MOTIVO','STATUS_IA','RESPOSTA_IA'
  ]);

  if (!sheet || sheet.getLastRow() < 2) return { ok: true, processados: 0 };

  const dados = sheet.getDataRange().getValues();
  let processados = 0;

  for (let i = 1; i < dados.length; i++) {
    const categoria = String(dados[i][8] || '').toLowerCase();
    if (categoria && categoria !== 'desconhecido') continue;

    const descricao = dados[i][4];
    const valor = dados[i][5];
    const tipo = dados[i][6];

    const prompt = `Você é a IA operacional WMGJ. Classifique o lançamento bancário abaixo.

Categorias permitidas:
- receita_hospital
- repasse_medico
- custo_maquina
- imposto_retido
- imposto_contador
- tarifa_bancaria
- transferencia
- estorno
- desconhecido

Retorne APENAS JSON válido no formato:
{"categoria":"","confianca":0,"justificativa":"","acao_recomendada":""}

Lançamento:
Descrição: ${descricao}
Valor: ${valor}
Tipo: ${tipo}`;

    try {
      const resposta = chamarGeminiWMGJ(prompt);
      const obj = extrairJsonIAWMGJ(resposta);
      const novaCategoria = obj.categoria || 'desconhecido';

      sheet.getRange(i + 1, 9).setValue(novaCategoria);
      sheet.getRange(i + 1, 10).setValue(obj.confianca || 0);
      sheet.getRange(i + 1, 11).setValue(obj.acao_recomendada || '');

      pend.appendRow([new Date(), 'IA_CLASSIFICACAO', descricao, valor, 'Classificação autônoma', 'PROCESSADO', JSON.stringify(obj)]);
      processados++;
    } catch (erro) {
      pend.appendRow([new Date(), 'IA_ERRO', descricao, valor, erro.message, 'ERRO', '']);
    }
  }

  registrarLogWMGJ('IA_CLASSIFICACAO', 'OK', 'Processados: ' + processados);
  return { ok: true, processados };
}

function analisarConciliacaoComIAWMGJ() {
  const ss = getPlanilha();
  const conc = ss.getSheetByName(WMGJ_CONFIG.SHEETS.CONCILIACAO);
  const pend = getOrCreateSheetWMGJ(WMGJ_CONFIG.SHEETS.PENDENCIAS, [
    'DATA_HORA','ORIGEM','DESCRICAO','VALOR','MOTIVO','STATUS_IA','RESPOSTA_IA'
  ]);

  if (!conc || conc.getLastRow() < 2) return { ok: true, analisados: 0 };

  const dados = conc.getDataRange().getValues();
  let analisados = 0;

  for (let i = 1; i < dados.length; i++) {
    const status = String(dados[i][7] || '').toUpperCase();
    if (status === 'OK' || status === 'CONCILIADO') continue;

    const registro = {
      competencia: dados[i][0],
      medico: dados[i][1],
      valor_producao: dados[i][2],
      valor_faturado: dados[i][3],
      valor_recebido: dados[i][4],
      dif_prod_fat: dados[i][5],
      dif_fat_rec: dados[i][6],
      status: dados[i][7],
      obs: dados[i][8]
    };

    const prompt = `Você é auditor financeiro operacional WMGJ. Analise a divergência abaixo e retorne APENAS JSON válido.

Classifique risco como baixo, medio ou alto. Sugira ação objetiva.

Formato:
{"risco":"","causa_provavel":"","acao_recomendada":"","prioridade":"","observacao":""}

Divergência:
${JSON.stringify(registro)}`;

    try {
      const resposta = chamarGeminiWMGJ(prompt);
      const obj = extrairJsonIAWMGJ(resposta);

      conc.getRange(i + 1, 10).setValue(obj.risco || '');
      conc.getRange(i + 1, 11).setValue(obj.causa_provavel || '');
      conc.getRange(i + 1, 12).setValue(obj.acao_recomendada || '');
      conc.getRange(i + 1, 13).setValue(obj.prioridade || '');

      pend.appendRow([new Date(), 'IA_CONCILIACAO', JSON.stringify(registro), registro.dif_fat_rec, 'Análise de divergência', 'PROCESSADO', JSON.stringify(obj)]);
      analisados++;
    } catch (erro) {
      pend.appendRow([new Date(), 'IA_CONCILIACAO_ERRO', JSON.stringify(registro), registro.dif_fat_rec, erro.message, 'ERRO', '']);
    }
  }

  registrarLogWMGJ('IA_CONCILIACAO', 'OK', 'Analisados: ' + analisados);
  return { ok: true, analisados };
}

function executarIAAutonomaWMGJ() {
  const r1 = classificarDesconhecidosComIAWMGJ();
  const r2 = analisarConciliacaoComIAWMGJ();
  return { ok: true, classificacao: r1, conciliacao: r2 };
}
