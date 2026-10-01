function decidirAutomaticamenteWMGJ() {
  const decisoesConciliacao = decidirConciliacaoComIAWMGJ();
  const decisoesPendencias = decidirPendenciasComIAWMGJ();

  registrarLogWMGJ(
    'IA_DECISAO_AUTOMATICA',
    'OK',
    'Conciliação: ' + decisoesConciliacao.aplicadas + ' | Pendências: ' + decisoesPendencias.aplicadas
  );

  return {
    ok: true,
    conciliacao: decisoesConciliacao,
    pendencias: decisoesPendencias
  };
}

function decidirConciliacaoComIAWMGJ() {
  const ss = getPlanilha();
  const conc = ss.getSheetByName(WMGJ_CONFIG.SHEETS.CONCILIACAO);
  const pend = getOrCreateSheetWMGJ(WMGJ_CONFIG.SHEETS.PENDENCIAS, [
    'DATA_HORA','ORIGEM','DESCRICAO','VALOR','MOTIVO','STATUS_IA','RESPOSTA_IA'
  ]);

  if (!conc || conc.getLastRow() < 2) return { ok: true, aplicadas: 0 };

  garantirCabecalhoDecisaoWMGJ(conc);

  const dados = conc.getDataRange().getValues();
  let aplicadas = 0;

  for (let i = 1; i < dados.length; i++) {
    const status = String(dados[i][7] || '').toUpperCase();
    const risco = String(dados[i][9] || '').toLowerCase();
    const causa = String(dados[i][10] || '');
    const acao = String(dados[i][11] || '');
    const prioridade = String(dados[i][12] || '').toLowerCase();
    const decisaoAtual = String(dados[i][13] || '').toUpperCase();

    if (decisaoAtual === 'APLICADA' || status === 'OK' || status === 'CONCILIADO') continue;

    const registro = {
      competencia: dados[i][0],
      medico: dados[i][1],
      valor_producao: dados[i][2],
      valor_faturado: dados[i][3],
      valor_recebido: dados[i][4],
      dif_prod_fat: dados[i][5],
      dif_fat_rec: dados[i][6],
      status,
      risco,
      causa,
      acao,
      prioridade
    };

    const decisao = gerarDecisaoIAWMGJ(registro);

    conc.getRange(i + 1, 14).setValue(decisao.decisao || 'PENDENTE_HUMANO');
    conc.getRange(i + 1, 15).setValue(decisao.pode_aplicar ? 'SIM' : 'NAO');
    conc.getRange(i + 1, 16).setValue(decisao.acao_final || '');
    conc.getRange(i + 1, 17).setValue(decisao.justificativa || '');

    if (decisao.pode_aplicar === true && decisao.decisao === 'ENCAMINHAR_PENDENCIA') {
      pend.appendRow([
        new Date(),
        'IA_DECISAO_CONCILIACAO',
        JSON.stringify(registro),
        registro.dif_fat_rec,
        decisao.acao_final || 'Pendência criada automaticamente',
        'APLICADA',
        JSON.stringify(decisao)
      ]);
      conc.getRange(i + 1, 14).setValue('APLICADA');
      aplicadas++;
    }
  }

  return { ok: true, aplicadas };
}

function decidirPendenciasComIAWMGJ() {
  const ss = getPlanilha();
  const pend = ss.getSheetByName(WMGJ_CONFIG.SHEETS.PENDENCIAS);

  if (!pend || pend.getLastRow() < 2) return { ok: true, aplicadas: 0 };

  const dados = pend.getDataRange().getValues();
  let aplicadas = 0;

  for (let i = 1; i < dados.length; i++) {
    const statusIA = String(dados[i][5] || '').toUpperCase();
    if (statusIA !== 'PROCESSADO') continue;

    const origem = dados[i][1];
    const descricao = dados[i][2];
    const valor = dados[i][3];
    const resposta = dados[i][6];

    const prompt = `Você é o decisor operacional WMGJ. Avalie a pendência abaixo e escolha uma decisão segura.

Decisões permitidas:
- MANTER_PENDENTE
- MARCAR_REVISAO_HUMANA
- SUGERIR_CORRECAO

Nunca autorize alteração de valor financeiro. Retorne APENAS JSON válido:
{"decisao":"","acao_final":"","justificativa":"","prioridade":""}

Pendência:
Origem: ${origem}
Descrição: ${descricao}
Valor: ${valor}
Resposta IA anterior: ${resposta}`;

    try {
      const raw = chamarGeminiWMGJ(prompt);
      const obj = extrairJsonIAWMGJ(raw);
      pend.getRange(i + 1, 6).setValue(obj.decisao || 'MANTER_PENDENTE');
      pend.getRange(i + 1, 7).setValue(JSON.stringify(obj));
      aplicadas++;
    } catch (erro) {
      pend.getRange(i + 1, 6).setValue('ERRO_DECISAO');
      pend.getRange(i + 1, 7).setValue(erro.message);
    }
  }

  return { ok: true, aplicadas };
}

function gerarDecisaoIAWMGJ(registro) {
  const prompt = `Você é o decisor automático WMGJ. Analise a divergência e escolha UMA decisão operacional segura.

Regras rígidas:
- Nunca alterar valores financeiros.
- Nunca apagar dados.
- Nunca marcar como conciliado quando houver diferença.
- Pode criar pendência, sugerir correção, priorizar revisão ou manter pendente.
- Só pode aplicar automaticamente ações reversíveis e auditáveis.

Decisões permitidas:
- ENCAMINHAR_PENDENCIA
- MARCAR_REVISAO_HUMANA
- MANTER_PENDENTE
- SUGERIR_CORRECAO

Retorne APENAS JSON válido:
{"decisao":"","pode_aplicar":false,"acao_final":"","justificativa":"","prioridade":""}

Registro:
${JSON.stringify(registro)}`;

  const raw = chamarGeminiWMGJ(prompt);
  return extrairJsonIAWMGJ(raw);
}

function garantirCabecalhoDecisaoWMGJ(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 17)).getValues()[0];
  const campos = {
    14: 'DECISAO_IA',
    15: 'APLICAVEL_AUTO',
    16: 'ACAO_FINAL_IA',
    17: 'JUSTIFICATIVA_IA'
  };

  Object.keys(campos).forEach(col => {
    const idx = Number(col);
    if (!header[idx - 1]) sheet.getRange(1, idx).setValue(campos[col]);
  });
}
