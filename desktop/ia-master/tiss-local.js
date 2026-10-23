'use strict';
(() => {
  const el = id => document.getElementById(id);
  let analysis = null, plan = null, target = null, xml = '', generation = 0, clearing = false;
  let expiryTimer = null, expiresAt = null;
  const messages = {
    TISS_CONFIGURATION_REQUIRED: 'A configuração local do faturamento ainda precisa ser concluída.',
    TISS_PORTAL_CONFIGURATION_REQUIRED: 'O portal de homologação ainda não foi vinculado a esta organização.',
    TISS_REAL_PORTAL_GATE_BLOCKED: 'O XML pode ser conferido localmente. Nesta versão, o teste de preenchimento usa somente o exemplo sintético incluído.',
    TISS_GUIDE_REVIEW_REQUIRED: 'A guia apresenta divergências. Confira os apontamentos antes de preparar o preenchimento.',
    TISS_XSD_DOCUMENT_INVALID: 'XML incompatível com o esquema oficial TISS 4.03.00. Confira os campos e sua ordem.',
    TISS_XSD_RUNTIME_UNAVAILABLE: 'A validação XSD não está disponível nesta instalação. Solicite a conferência do componente.',
    TISS_XSD_SCHEMA_INTEGRITY_FAILED: 'Os esquemas oficiais estão ausentes ou divergentes. A análise foi bloqueada.',
    TISS_XSD_SCHEMA_COMPILE_FAILED: 'Não foi possível carregar os esquemas oficiais. A análise foi bloqueada.',
    TISS_MAPPING_INCOMPLETE: 'O mapeamento do portal não cobre todos os itens desta guia.',
    TISS_GUIDE_ALREADY_ATTEMPTED_REVIEW_REQUIRED: 'Esta guia já teve uma tentativa de preenchimento. Confira o resultado no portal antes de uma nova operação.',
    TISS_FILL_UNCERTAIN_REVIEW_REQUIRED: 'O resultado do preenchimento ficou incerto. Confira o portal; a tentativa não será repetida automaticamente.',
    TISS_REIMPORT_REQUIRED: 'A análise expirou ou pertence a outra sessão. Importe o arquivo novamente.',
    TISS_BROWSER_PORTAL_NOT_OPEN: 'Abra a página de homologação no navegador configurado.',
    TISS_BROWSER_TARGET_AMBIGUOUS: 'Há mais de uma aba compatível. Mantenha aberta apenas a aba que receberá o teste.',
    TISS_BROWSER_INTERACTIVE_LOGIN_REQUIRED: 'Conclua o acesso solicitado pelo próprio portal e confira a página.',
    TISS_EXECUTOR_RECONCILIATION_REQUIRED: 'Existe uma tentativa em andamento ou interrompida. A reconciliação precisa ser concluída antes de prosseguir.'
  };
  const issueLabels = {

    TUSS_CATALOG_VALIDATION_PENDING: 'Catálogo TUSS e vigência dos códigos ainda não conferidos.',
    CONTRACT_VALIDATION_PENDING: 'Preços, cobertura e autorização dependem do contrato aplicável.',
    TISS_HASH_UNVERIFIED: 'Hash do padrão TISS presente, ainda não verificado.',
    LINE_TOTAL_MISMATCH: 'Total do item diverge da conferência aritmética local.',
    DUPLICATE_GUIDE_IN_BATCH: 'A mesma identificação de guia aparece mais de uma vez no lote.'
  };
  const money = cents => Number.isSafeInteger(cents)
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100) : 'Não informado';
  function node(tag, value) { const item = document.createElement(tag); item.textContent = String(value ?? ''); return item; }
  function notice(value) { el('tiss-notice').textContent = value; }
  function reset() {
    clearTimeout(expiryTimer); expiryTimer = null; expiresAt = null;
    generation++; analysis = null; plan = null; target = null; xml = '';
    el('tiss-file').value = ''; el('tiss-summary').replaceChildren(); el('tiss-items').replaceChildren();
    el('tiss-issues').replaceChildren(); el('tiss-plan-output').replaceChildren(); el('tiss-guides').replaceChildren();
    el('tiss-analysis-panel').hidden = true;
    for (const id of ['tiss-analyze', 'tiss-plan', 'tiss-inspect', 'tiss-fill']) el(id).disabled = true;
  }
  function expire() { reset(); notice('A análise expirou. Importe o arquivo novamente para continuar.'); }
  function armExpiry(deadline) {
    clearTimeout(expiryTimer);
    const remaining = Number.isFinite(deadline) ? Math.max(0, Math.min(15 * 60 * 1000, deadline - Date.now())) : 0;
    expiresAt = Date.now() + remaining; expiryTimer = setTimeout(expire, remaining);
  }
  document.addEventListener('visibilitychange', () => { if (expiresAt !== null && Date.now() >= expiresAt) expire(); });
  async function request(route, body) {
    const response = await fetch('/api/tiss/' + route, { method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.status === 401) {
      reset(); window.dispatchEvent(new CustomEvent('aurora:local-session-invalid'));
      throw Error('Sessão encerrada. Abra novamente o acesso local da IA Master.');
    }
    const value = await response.json();
    if (!response.ok) throw Error(messages[value.code] || 'Operação interrompida para conferência: ' + (value.code || response.status));
    return value;
  }
  function decodeXml(bytes) {
    if (bytes.length === 0 || bytes.length > 1024 * 1024) throw Error('Selecione um XML de até 1 MB.');
    if ((bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)) throw Error('Exporte o XML em UTF-8 ou ISO-8859-1.');
    const head = String.fromCharCode(...bytes.subarray(0, 512));
    const encoding = head.match(/<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i)?.[1].toLowerCase();
    if (encoding && !['utf-8', 'iso-8859-1'].includes(encoding)) throw Error('A codificação declarada precisa ser UTF-8 ou ISO-8859-1.');
    if (encoding === 'iso-8859-1') {
      let text = '';
      // TextDecoder maps ISO-8859-1 to Windows-1252 in browsers. Decode the actual
      // ISO bytes directly, without silently changing the TISS source text.
      for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
      return text;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw Error('O arquivo não corresponde à codificação declarada. Exporte novamente sem alterar os valores.'); }
  }
  function table(rows, headings) {
    const result = document.createElement('table'), head = document.createElement('thead'), header = document.createElement('tr');
    for (const text of headings) header.append(node('th', text)); head.append(header); result.append(head);
    const body = document.createElement('tbody');
    for (const row of rows) { const tr = document.createElement('tr'); for (const text of row) tr.append(node('td', text)); body.append(tr); }
    result.append(body); return result;
  }
  function showGuide() {
    generation++;
    plan = null; target = null;
    el('tiss-plan-output').replaceChildren(); el('tiss-items').replaceChildren();
    el('tiss-inspect').disabled = true; el('tiss-fill').disabled = true;
    const guide = analysis?.analysis.guides[Number(el('tiss-guides').value)]; if (!guide) return;
    el('tiss-items').append(node('p', 'Guia ' + guide.providerGuideNumber + ' · total informado ' + money(guide.totals.generalCents)));
    const rows = guide.procedures.map(item => [item.sequence, item.tableCode + ' / ' + item.procedureCode,
      item.description, item.quantity, item.unitPrice, money(item.totalCents)]);
    if (rows.length) el('tiss-items').append(table(rows, ['Item', 'Tabela / código', 'Procedimento', 'Quantidade', 'Unitário (R$)', 'Total']));
    const expenses = (guide.otherExpenses || []).map(item => [item.sequence, item.expenseCode,
      item.tableCode + ' / ' + item.procedureCode, item.quantity, money(item.totalCents)]);
    if (expenses.length) { el('tiss-items').append(node('h3', 'Outras despesas')); el('tiss-items').append(table(expenses, ['Item', 'Categoria', 'Tabela / código', 'Quantidade', 'Total'])); }
    el('tiss-plan').disabled = analysis.dataMode !== 'PACKAGED_SYNTHETIC_FIXTURE' || analysis.analysis.validation.status !== 'VALIDATED_LOCAL';
  }
  async function analyze() {
    const attempt = generation; el('tiss-analyze').disabled = true; notice('Conferindo o XML no motor local…');
    try {
      const result = await request('analyze', { xml });
      if (attempt !== generation) return;
      analysis = result; xml = ''; armExpiry(Date.parse(result.expiresAt)); el('tiss-analysis-panel').hidden = false;
      const data = result.analysis;
      el('tiss-summary').replaceChildren(node('p', 'Lote ' + data.batchNumber + ' · ' + data.summary.guideCount + ' guia(s) · ' + data.summary.procedureCount + ' procedimento(s) · total ' + money(data.summary.totalCents)));
      el('tiss-summary').append(node('p', result.dataMode === 'PACKAGED_SYNTHETIC_FIXTURE'
        ? 'Exemplo sintético incluído: disponível para ensaio de preenchimento.'
        : 'Análise local em memória. Envio ao portal e persistência clínica permanecem desabilitados nesta versão.'));
      el('tiss-summary').append(node('p', 'Estrutura XSD oficial validada. TUSS, contrato e aprovação para faturamento permanecem pendentes.'));
      el('tiss-guides').replaceChildren();
      data.guides.forEach((guide, index) => { const option = node('option', 'Guia ' + guide.providerGuideNumber); option.value = String(index); el('tiss-guides').append(option); });
      el('tiss-issues').replaceChildren();
      for (const issue of data.validation.issues) el('tiss-issues').append(node('li', (issueLabels[issue.code] || issue.code) + ' · ' + issue.path));
      showGuide();
      notice(data.validation.status === 'VALIDATED_LOCAL' ? 'Conferências locais concluídas. As verificações pendentes estão indicadas abaixo.' : 'XML lido com divergências que precisam de revisão.');
    } catch (error) { if (attempt === generation) notice(error.message); }
  }
  el('tiss-file').addEventListener('change', async () => {
    const file = el('tiss-file').files?.[0]; if (!file) return;
    reset(); const attempt = generation;
    try { const value = decodeXml(new Uint8Array(await file.arrayBuffer())); if (attempt !== generation) return;
      xml = value; armExpiry(Date.now() + 15 * 60 * 1000); el('tiss-analyze').disabled = false; notice('Arquivo selecionado. Confira somente fontes autorizadas para esta organização.');
    } catch (error) { if (attempt === generation) notice(error.message); }
  });
  el('tiss-example').addEventListener('click', async () => {
    reset(); const attempt = generation;
    try { const response = await fetch('/tiss-fixture.xml', { cache: 'no-store' });
      if (!response.ok) throw Error('O exemplo sintético não está disponível nesta instalação.');
      const value = decodeXml(new Uint8Array(await response.arrayBuffer())); if (attempt !== generation) return;
      xml = value; await analyze();
    } catch (error) { if (attempt === generation) notice(error.message); }
  });
  el('tiss-analyze').addEventListener('click', analyze);
  el('tiss-guides').addEventListener('change', showGuide);
  el('tiss-plan').addEventListener('click', async () => {
    el('tiss-plan').disabled = true; const attempt = generation;
    try { const result = await request('plan', { analysisId: analysis.analysisId, guideIndex: Number(el('tiss-guides').value) });
      if (attempt !== generation) return; plan = result; target = null;
      el('tiss-plan-output').replaceChildren(node('p', result.fieldCount + ' campos preparados. Confira os dados e a aba antes do preenchimento.'));
      el('tiss-plan-output').append(table(Object.entries(result.fields), ['Campo mapeado', 'Valor do XML']));
      el('tiss-inspect').disabled = false; el('tiss-fill').disabled = true; notice('Plano de homologação preparado.');
    } catch (error) { if (attempt === generation) notice(error.message); }
    finally { if (attempt === generation && analysis) el('tiss-plan').disabled = false; }
  });
  el('tiss-inspect').addEventListener('click', async () => {
    el('tiss-fill').disabled = true; const attempt = generation;
    try { const result = await request('inspect', { planId: plan.planId }); if (attempt !== generation) return;
      target = result; const url = new URL(result.url); notice('Aba conferida: ' + url.origin + url.pathname + '. O teste preencherá o rascunho desta aba.'); el('tiss-fill').disabled = false;
    } catch (error) { if (attempt === generation) notice(error.message); }
  });
  el('tiss-fill').addEventListener('click', async () => {
    el('tiss-fill').disabled = true; el('tiss-inspect').disabled = true; const attempt = generation;
    try { const result = await request('fill', { planId: plan.planId, expectedPlanHash: plan.planHash,
      targetId: target.targetId, expectedUrl: target.url }); if (attempt !== generation) return;
      notice(result.state === 'FILLED_DRAFT'
        ? 'Rascunho sintético preenchido e ' + result.readbackCount + ' campos conferidos. Nenhum comando de envio foi executado pelo motor; efeitos próprios do portal precisam de revisão.'
        : 'A tentativa exige conferência no portal. Estado: ' + result.state + '. A repetição automática está bloqueada.');
    } catch (error) { if (attempt === generation) notice(error.message); }
  });
  el('tiss-clear').addEventListener('click', async () => {
    if (clearing) return; clearing = true; reset(); const attempt = generation;
    for (const id of ['tiss-file', 'tiss-example', 'tiss-clear']) el(id).disabled = true;
    try { await request('clear', {}); if (attempt === generation) notice('Dados da análise removidos da memória da sessão.'); }
    catch (error) { if (attempt === generation) notice(error.message); }
    finally { clearing = false; for (const id of ['tiss-file', 'tiss-example', 'tiss-clear']) el(id).disabled = false; }
  });
  window.addEventListener('aurora:local-session-ended', () => { reset(); notice('Abra uma sessão local para usar o faturamento.'); });
  window.addEventListener('aurora:local-session-ready', async () => {
    const attempt = generation;
    try { const state = await request('status'); if (attempt !== generation) return;
      notice(state.state === 'PENDING_CONFIGURATION' || state.state === 'CONFIGURATION_REQUIRES_REVIEW'
        ? 'O módulo está disponível. A configuração local do faturamento precisa ser concluída.'
        : 'Motor pronto para conferência local de XML TISS 4.03.00. Preenchimento disponível somente em ensaio sintético.');
    } catch (error) { if (attempt === generation) notice(error.message); }
  });
})();
