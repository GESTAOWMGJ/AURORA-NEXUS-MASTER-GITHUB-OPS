function fecharConciliacaoAutomaticamenteComIAWMGJ() {
  const ss = getPlanilha();
  const conc = ss.getSheetByName(WMGJ_CONFIG.SHEETS.CONCILIACAO);
  const pend = getOrCreateSheetWMGJ(WMGJ_CONFIG.SHEETS.PENDENCIAS, [
    'DATA_HORA','ORIGEM','DESCRICAO','VALOR','MOTIVO','STATUS_IA','RESPOSTA_IA'
  ]);

  if (!conc || conc.getLastRow() < 2) return { ok: true, fechadas: 0, ignoradas: 0 };

  garantirCabecalhoFechamentoConciliacaoWMGJ(conc);

  const dados = conc.getDataRange().getValues();
  let fechadas = 0;
  let ignoradas = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const statusAtual = String(linha[7] || '').toUpperCase();
    const fechamentoAtual = String(linha[17] || '').toUpperCase();

    if (statusAtual === 'CONCILIADO_AUTO' || statusAtual === 'OK' || fechamentoAtual === 'FECHADO_AUTO') {
      ignoradas++;
      continue;
    }

    const registro = {
      competencia: linha[0],
      medico: linha[1],
      valor_producao: Number(linha[2]) || 0,
      valor_faturado: Number(linha[3]) || 0,
      valor_recebido: Number(linha[4]) || 0,
      dif_prod_fat: Number(linha[5]) || 0,
      dif_fat_rec: Number(linha[6]) || 0,
      status: linha[7],
      obs: linha[8],
      risco_ia: linha[9],
      causa_ia: linha[10],
      acao_ia: linha[11],
      prioridade_ia: linha[12],
      decisao_ia: linha[13],
      aplicavel_auto: linha[14],
      acao_final_ia: linha[15],
      justificativa_ia: linha[16]
    };

    const avaliacao = avaliarFechamentoConciliacaoWMGJ(registro);

    conc.getRange(i + 1, 18).setValue(avaliacao.decisao || 'NAO_FECHAR');
    conc.getRange(i + 1, 19).setValue(avaliacao.confianca || 0);
    conc.getRange(i + 1, 20).setValue(avaliacao.justificativa || '');
    conc.getRange(i + 1, 21).setValue(new Date());

    if (avaliacao.decisao === 'FECHAR_CONCILIADO' && avaliacao.pode_fechar === true) {
      const dentroTolerancia = Math.abs(registro.dif_prod_fat) <= 0.01 && Math.abs(registro.dif_fat_rec) <= 0.01;
      const confiancaOk = Number(avaliacao.confianca || 0) >= 0.95;

      if (dentroTolerancia && confiancaOk) {
        conc.getRange(i + 1, 8).setValue('CONCILIADO_AUTO');
        conc.getRange(i + 1, 9).setValue('Fechado automaticamente por IA com tolerância zero e confiança alta.');
        conc.getRange(i + 1, 18).setValue('FECHADO_AUTO');

        pend.appendRow([
          new Date(),
          'IA_FECHAMENTO_CONCILIACAO',
          JSON.stringify(registro),
          registro.valor_recebido,
          'Conciliação fechada automaticamente com diferença zero',
          'FECHADO_AUTO',
          JSON.stringify(avaliacao)
        ]);

        fechadas++;
      } else {
        pend.appendRow([
          new Date(),
          'IA_FECHAMENTO_BLOQUEADO',
          JSON.stringify(registro),
          registro.valor_recebido,
          'IA sugeriu fechamento, mas não passou nas travas determinísticas',
          'BLOQUEADO',
          JSON.stringify(avaliacao)
        ]);
        ignoradas++;
      }
    } else {
      ignoradas++;
    }
  }

  registrarLogWMGJ('IA_FECHAMENTO_CONCILIACAO', 'OK', 'Fechadas: ' + fechadas + ' | Ignoradas: ' + ignoradas);
  return { ok: true, fechadas, ignoradas };
}

function avaliarFechamentoConciliacaoWMGJ(registro) {
  const prompt = `Você é auditor operacional WMGJ. Avalie se esta conciliação pode ser fechada automaticamente.

Regras rígidas:
- Só pode fechar se valor_producao = valor_faturado = valor_recebido.
- Só pode fechar se dif_prod_fat = 0 e dif_fat_rec = 0.
- Nunca fechar se houver pagamento sem produção.
- Nunca fechar se houver produção sem pagamento.
- Nunca fechar se risco_ia for alto.
- Nunca alterar valores financeiros.
- Retorne APENAS JSON válido.

Formato:
{"decisao":"FECHAR_CONCILIADO ou NAO_FECHAR","pode_fechar":false,"confianca":0,"justificativa":""}

Registro:
${JSON.stringify(registro)}`;

  const raw = chamarGeminiWMGJ(prompt);
  return extrairJsonIAWMGJ(raw);
}

function garantirCabecalhoFechamentoConciliacaoWMGJ(sheet) {
  const campos = {
    18: 'FECHAMENTO_IA',
    19: 'CONFIANCA_FECHAMENTO_IA',
    20: 'JUSTIFICATIVA_FECHAMENTO_IA',
    21: 'DATA_FECHAMENTO_IA'
  };

  Object.keys(campos).forEach(col => {
    const idx = Number(col);
    if (!sheet.getRange(1, idx).getValue()) {
      sheet.getRange(1, idx).setValue(campos[col]);
    }
  });
}
