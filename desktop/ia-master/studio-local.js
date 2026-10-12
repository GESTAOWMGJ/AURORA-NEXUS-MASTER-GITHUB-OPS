'use strict';
// The owner session is the existing local HttpOnly cookie. It grants no cloud role or MFA claim.
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount({ document, window, fetch: window.fetch.bind(window), location: window.location });
})(function () {
  const SCHEMA = 'aurora.master.studio.v1', ID = /^[a-f0-9]{32}$/, SHA = /^[a-f0-9]{40}$/, DIGEST = /^[a-f0-9]{64}$/;
  const REPOSITORY = 'GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS';
  const publicationStates = { INTENT_RECORDED: 'Publicação registrada', BRANCH_PUSH_INTENT: 'Envio da branch registrado',
    BRANCH_CONFIRMED: 'Branch confirmada no GitHub', PR_CREATE_INTENT: 'Criação de proposta registrada',
    PR_UNCONFIRMED: 'Proposta ainda não confirmada', BRANCH_UNCONFIRMED: 'Branch ainda não confirmada',
    DRAFT_CONFIRMED: 'Proposta draft confirmada', REMOTE_CONFLICT: 'Publicação divergente; revisão necessária',
    BASE_CHANGED: 'A origem mudou; promoção pendente', RETRY_OBSERVATION: 'Conferindo tentativa anterior',
    RETRY_READY: 'Ausência anterior conferida; nova tentativa disponível', CI_OBSERVED: 'Consulta dos testes registrada' };
  const ciStates = { BASE_CHANGED: 'A origem mudou; testes anteriores não liberam promoção',
    INCOMPLETE_REMOTE_LIST: 'Consulta incompleta; testes não comprovados', NO_CHECKS_OBSERVED: 'Nenhum teste observado',
    REMOTE_CHECKS_FAILED: 'O GitHub informou falha nos testes', REMOTE_CHECKS_PENDING: 'Testes em andamento',
    REMOTE_CHECKS_NON_SUCCESS: 'Há testes sem resultado de aprovação',
    REMOTE_CHECKS_PASSED: 'Testes informados pelo GitHub passaram; a promoção continua pendente' };
  const states = {
    CONTEXT_BOUND: 'Pedido registrado', PROPOSED: 'Proposta pronta para revisão', VALIDATED: 'Proposta validada',
    STAGING: 'Preparando cópia isolada', PATCH_STAGED: 'Cópia isolada pronta', CHECK_FAILED: 'Verificação pendente',
    STATIC_CHECKS_PASSED: 'Verificações estáticas aprovadas', PREPARING_VERSION: 'Preparando versão local',
    VERSION_PREPARED: 'Versão local preparada', STAGING_BLOCKED: 'Preparação interrompida; revisão necessária',
    PREPARATION_BLOCKED: 'Versionamento interrompido; revisão necessária'
  };
  const messages = {
    LOCAL_AUTH_REQUIRED: 'A sessão local terminou. Reabra “IA Master — Acesso local” na pasta AURORA do Windows.',
    STUDIO_NOT_CONFIGURED: 'O repositório ainda precisa ser vinculado na configuração local da IA Master.',
    STUDIO_CONFIG_INVALID: 'A configuração local do repositório precisa ser revisada.',
    STUDIO_VERSION_CONFLICT: 'Esta tarefa mudou em outra janela. Atualize a tarefa e confira o resultado antes de continuar.',
    STUDIO_BASE_CHANGED: 'A versão de origem mudou. Inicie outro pedido com o código atual.',
    STUDIO_SOURCE_CHANGED: 'A fonte vinculada mudou. Inicie outro pedido com o código atual.',
    STUDIO_WORKSPACE_CHANGED: 'A cópia isolada mudou. Preserve a tarefa para revisão.',
    STUDIO_LOCKED: 'Esta tarefa está em uso. Atualize a tarefa quando a operação terminar.',
    STUDIO_STATE_CONFLICT: 'Esta etapa não está disponível no estado atual. Atualize a tarefa para conferir.',
    STUDIO_PATH_REJECTED: 'Selecione somente arquivos autorizados do catálogo.',
    STUDIO_SENSITIVE_CONTENT: 'O conteúdo foi recusado por conter possível segredo ou dado protegido.',
    STUDIO_CONTENT_LIMIT: 'O contexto excede o limite. Escolha menos arquivos ou módulos menores.',
    STUDIO_MODEL_CONTEXT_LIMIT: 'O pedido não cabe no contexto do modelo. Reduza o texto e indique um trecho menor.',
    STUDIO_MODEL_OUTPUT_TRUNCATED: 'O modelo interrompeu a resposta. A proposta incompleta foi recusada.',
    STUDIO_MODEL_UNAVAILABLE: 'O modelo local está indisponível. Você pode revisar ou importar uma proposta estruturada.',
    STUDIO_MODEL_BUSY: 'O modelo local está ocupado. Aguarde a consulta em andamento.',
    STUDIO_PROPOSAL_INVALID: 'A proposta não atende ao formato seguro. Confira o JSON e os hashes da fonte.',
    STUDIO_EDIT_AMBIGUOUS: 'O trecho da alteração não é único no arquivo. A proposta precisa ser refinada.',
    STUDIO_CHECK_FAILED: 'A verificação falhou. Consulte a tarefa e refine a proposta antes de preparar a versão.',
    STUDIO_GIT_FAILED: 'O repositório não respondeu como esperado. Preserve a tarefa e confira a configuração local.',
    STUDIO_GIT_TREE_UNSUPPORTED: 'A árvore do repositório não é compatível com a preparação isolada.',
    STUDIO_OPERATION_BLOCKED: 'A operação foi interrompida. Atualize a tarefa e preserve o histórico.',
    REQUEST_TIMEOUT: 'A resposta demorou além do limite. Atualize a tarefa para conferir se a etapa foi concluída.',
    LOCAL_OFFLINE: 'A IA Master local não respondeu. Reabra o acesso local e use “Atualizar acesso”.',
    INVALID_RESPONSE: 'A resposta local não corresponde ao contrato esperado. A operação foi interrompida.',
    INPUT_INVALID: 'Confira o pedido, os arquivos selecionados e os intervalos de linhas.',
    REVIEW_REQUIRED: 'Abra as alterações e marque que revisou a proposta antes de continuar.'
  };
  Object.assign(messages, {
    PUBLISH_NOT_CONFIGURED: 'A publicação não está habilitada na configuração revisada deste PC.',
    PUBLISH_CONFIG_INVALID: 'A configuração de publicação precisa ser revisada.',
    PUBLISH_INPUT_INVALID: 'O pedido de publicação não corresponde à tarefa preparada.',
    PUBLISH_LOCKED: 'A publicação está em andamento. Consulte a tarefa após a operação.',
    PUBLISH_RECORD_INVALID: 'O registro de publicação precisa ser preservado e revisado.',
    PUBLISH_TASK_CHANGED: 'A tarefa mudou. Atualize e confira os hashes antes de publicar.',
    PUBLISH_SOURCE_CHANGED: 'A fonte ou versão preparada mudou. Preserve a tarefa para revisão.',
    PUBLISH_EXECUTABLE_CHANGED: 'A ferramenta de publicação difere da versão revisada.',
    PUBLISH_LOCAL_CHECK_FAILED: 'A conferência local de publicação não foi concluída.',
    PUBLISH_LOCAL_CONFIGURATION_UNSAFE: 'A configuração Git impede a publicação no destino fixo.',
    PUBLISH_REMOTE_UNAVAILABLE: 'O GitHub não respondeu. Consulte a tentativa anterior antes de repetir.',
    PUBLISH_REMOTE_INVALID: 'A resposta do GitHub não confirmou o contrato esperado.',
    PUBLISH_REMOTE_CONFLICT: 'A branch ou proposta diverge. Nenhuma versão será sobrescrita.',
    PUBLISH_BASE_CHANGED: 'A origem do produto avançou. Uma nova proposta revisada é necessária.',
    PUBLISH_AUTHORIZATION_UNCONFIRMED: 'A conta local do GitHub não confirmou autorização para este produto.',
    PUBLISH_AUDIT_UNAVAILABLE: 'A auditoria não confirmou a etapa. Preserve o registro antes de continuar.',
    PUBLISH_RECOVERY_REQUIRED: 'Use “Verificar publicação” para conferir a tentativa anterior antes de repetir.'
  });
  function safePath(value) {
    return typeof value === 'string' && value.length <= 180 && /^[A-Za-z0-9_./-]+$/.test(value) &&
      !value.startsWith('/') && !value.includes('//') && !value.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) &&
      !/(?:^|\/)(?:node_modules|secrets?|credentials?|private|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|\/|$)/i.test(value) &&
      /\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|html|css|txt)$/.test(value);
  }
  function validTask(value, orgId) {
    return value && value.schemaVersion === SCHEMA && ID.test(value.id) && value.orgId === orgId &&
      SHA.test(value.baseRevision) && Number.isSafeInteger(value.version) && value.version >= 1 &&
      Object.hasOwn(states, value.state) && typeof value.summary === 'string' && value.summary.length <= 600 &&
      typeof value.prompt === 'string' && value.prompt.length <= 6000 && ['PUBLIC', 'INTERNAL'].includes(value.classification);
  }
  function taskActions(task, reviewed, diffVersion) {
    const current = task && reviewed && diffVersion === task.version;
    return {
      propose: !!task && !task.staged && ['CONTEXT_BOUND', 'PROPOSED', 'VALIDATED', 'CHECK_FAILED'].includes(task.state),
      diff: !!task?.proposal && !['CONTEXT_BOUND', 'STAGING', 'PREPARING_VERSION'].includes(task.state),
      validate: !!current && !task.staged && ['PROPOSED', 'VALIDATED'].includes(task.state),
      stage: !!current && task.state === 'VALIDATED',
      verify: !!current && ['PATCH_STAGED', 'CHECK_FAILED'].includes(task.state),
      prepare: !!current && task.state === 'STATIC_CHECKS_PASSED'
    };
  }
  function validateCapabilities(value, orgId) {
    if (!value || value.schemaVersion !== SCHEMA || value.authenticatedOrgId !== orgId || value.externalAiEnabled !== false ||
      value.modelCanExecuteCommands !== false || value.arbitraryCodeExecution !== false || !value.repository ||
      !['AVAILABLE', 'NOT_CONFIGURED', 'CONFIG_INVALID'].includes(value.repository.state) ||
      !Array.isArray(value.repository.allowedPaths) || value.repository.allowedPaths.length > 100 ||
      !value.repository.allowedPaths.every(safePath) || new Set(value.repository.allowedPaths).size !== value.repository.allowedPaths.length ||
      !Array.isArray(value.repository.fileCatalog) || !value.operations ||
      !['NOT_IMPLEMENTED', 'NOT_CONFIGURED', 'DRAFT_PR_ONLY'].includes(value.operations.publish) ||
      !Number.isSafeInteger(value.limits?.maxFiles) || value.limits.maxFiles < 1 || value.limits.maxFiles > 10 ||
      !Number.isSafeInteger(value.limits?.maxContextBytes) || value.limits.maxContextBytes < 1 || value.limits.maxContextBytes > 50000)
      throw Error('INVALID_RESPONSE');
    if (value.operations.publish === 'DRAFT_PR_ONLY' && (!value.publisher ||
      value.publisher.schemaVersion !== 'aurora.master.publisher.v1' || value.publisher.state !== 'CONFIGURED_AUTH_NOT_OBSERVED' ||
      value.publisher.repository !== REPOSITORY || value.publisher.baseBranch !== 'main' ||
      value.publisher.publish !== 'OPT_IN_DRAFT_ONLY_AUTH_NOT_OBSERVED' ||
      value.publisher.ci !== 'REMOTE_METADATA_ONLY' || value.publisher.modelCanExecuteCommands !== false ||
      value.publisher.canMerge !== false || value.publisher.canDeploy !== false || value.publisher.canDispatch !== false ||
      value.publisher.credentialReadByApplication !== false)) throw Error('INVALID_RESPONSE');
    const names = new Set();
    for (const file of value.repository.fileCatalog) {
      if (!file || !value.repository.allowedPaths.includes(file.path) || names.has(file.path) ||
        !['EDITABLE', 'CONTENT_LIMIT', 'SENSITIVE_CONTENT', 'UNAVAILABLE'].includes(file.state) ||
        (file.byteLength !== null && (!Number.isSafeInteger(file.byteLength) || file.byteLength < 0)) || typeof file.exists !== 'boolean')
        throw Error('INVALID_RESPONSE');
      names.add(file.path);
    }
    if (names.size !== value.repository.allowedPaths.length) throw Error('INVALID_RESPONSE');
    return value;
  }
  function validPublication(value, task, orgId) {
    if (!value || value.schemaVersion !== 'aurora.master.publisher.v1' || value.orgId !== orgId ||
      value.taskId !== task.id || value.taskVersion !== task.version || value.repository !== REPOSITORY ||
      value.headSha !== task.preparedVersion?.commit || value.baseSha !== task.baseRevision ||
      value.proposalFingerprint !== task.proposalFingerprint || !DIGEST.test(value.receiptSha256) ||
      !Number.isSafeInteger(value.publicationVersion) || value.publicationVersion < 1 ||
      !Object.hasOwn(publicationStates, value.state) || value.deployed !== false || value.merged !== false ||
      value.projectTestsRunLocally !== false || !Array.isArray(value.history) || value.history.length < 1 ||
      value.history.length > 40 || !Number.isSafeInteger(value.historyEventCount) ||
      value.historyEventCount !== value.publicationVersion || value.historyEventCount < value.history.length) return false;
    if (value.pullRequest !== null) {
      const pr = value.pullRequest;
      if (!pr || !Number.isSafeInteger(pr.number) || pr.number < 1 ||
        pr.url !== 'https://github.com/' + REPOSITORY + '/pull/' + pr.number || pr.draft !== true ||
        pr.headSha !== value.headSha || pr.baseSha !== value.baseSha) return false;
    }
    if (value.observedPullRequest != null) {
      const pr = value.observedPullRequest;
      if (!Number.isSafeInteger(pr.number) || pr.number < 1 ||
        pr.url !== 'https://github.com/' + REPOSITORY + '/pull/' + pr.number || pr.draft !== true ||
        pr.headSha !== value.headSha || !SHA.test(pr.baseSha) ||
        value.pullRequest && pr.number !== value.pullRequest.number) return false;
    }
    let previous = null;
    for (const event of value.history) {
      if (!event || !Object.hasOwn(publicationStates, event.state) || !Number.isSafeInteger(event.version) ||
        event.version < 1 || event.version > value.publicationVersion || !DIGEST.test(event.eventHash) ||
        !(event.previousEventHash === null || DIGEST.test(event.previousEventHash)) ||
        previous && (event.version !== previous.version + 1 || event.previousEventHash !== previous.eventHash)) return false;
      previous = event;
    }
    if (previous.version !== value.publicationVersion || previous.state !== value.state) return false;
    if (value.ci !== null) {
      const ci = value.ci;
      if (!ci || !Object.hasOwn(ciStates, ci.state) || ci.ciVerified !== false || ci.actualCheckout !== 'NOT_OBSERVED' ||
        ci.requiredCoverage !== 'NOT_OBSERVED' || ci.proposedHeadSha !== value.headSha ||
        ci.apiHeadSha !== value.headSha || ci.currentHeadSha !== value.headSha || ci.preparedBaseSha !== value.baseSha ||
        !SHA.test(ci.currentBaseSha) || ci.baseCurrent !== (ci.currentBaseSha === value.baseSha) ||
        typeof ci.completeRemoteListing !== 'boolean' || !Array.isArray(ci.checks) || ci.checks.length > 100 ||
        !Array.isArray(ci.runs) || ci.runs.length > 100 ||
        [...ci.checks, ...ci.runs].some(item => item.apiHeadSha !== value.headSha || item.actualCheckout !== 'NOT_OBSERVED')) return false;
      for (const run of ci.runs) if (!Number.isSafeInteger(run.id) || run.id < 1 ||
        run.url !== 'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id) return false;
    }
    return true;
  }
  function mount(env) {
    const d = env.document, w = env.window, get = id => d.getElementById(id);
    if (!get('local-studio') || env.location.hostname !== '127.0.0.1' || env.location.protocol !== 'http:') return null;
    let orgId = null, caps = null, task = null, context = null, busy = false, closed = true, epoch = 0, diffVersion = null, syncRequired = false;
    const controllers = new Set(), fileRows = new Map();
    const buttonIds = ['studio-create', 'studio-propose', 'studio-import', 'studio-diff', 'studio-validate', 'studio-stage', 'studio-verify', 'studio-prepare', 'studio-refresh-task', 'studio-refresh-history', 'studio-publish', 'studio-reconcile-publication', 'studio-read-ci'];
    function say(text, error = false) { get('studio-notice').textContent = text; get('studio-notice').setAttribute('data-error', String(error)); }
    function controlStates() {
      const a = taskActions(task, get('studio-reviewed').checked, diffVersion), unavailable = closed || busy || syncRequired;
      get('studio-create').disabled = unavailable || caps?.repository.state !== 'AVAILABLE';
      get('studio-propose').disabled = unavailable || !a.propose;
      get('studio-import').disabled = unavailable || !a.propose;
      for (const name of ['diff', 'validate', 'stage', 'verify', 'prepare']) get('studio-' + name).disabled = unavailable || !a[name];
      get('studio-refresh-task').disabled = closed || busy || !task;
      get('studio-refresh-history').disabled = closed || busy || !caps;
      get('studio-reconnect').disabled = busy;
      get('studio-reviewed').disabled = unavailable || diffVersion !== task?.version;
      const ready = !unavailable && task?.state === 'VERSION_PREPARED' && caps?.operations.publish === 'DRAFT_PR_ONLY';
      const publication = task?.publication;
      get('studio-publish').disabled = !ready || !get('studio-reviewed').checked || diffVersion !== task?.version ||
        Boolean(publication?.pullRequest || publication?.observedPullRequest) || Boolean(publication && !['INTENT_RECORDED', 'BRANCH_CONFIRMED', 'BRANCH_UNCONFIRMED', 'RETRY_READY'].includes(publication.state));
      get('studio-reconcile-publication').disabled = !ready || !publication;
      get('studio-read-ci').disabled = !ready || !(publication?.pullRequest || publication?.observedPullRequest);
      for (const row of fileRows.values()) { row.checkbox.disabled = unavailable || row.file.state !== 'EDITABLE'; row.focus.disabled = unavailable; row.start.disabled = unavailable; row.end.disabled = unavailable; }
    }
    function endSession() {
      epoch++; closed = true; orgId = null; caps = null; task = null; context = null; diffVersion = null; syncRequired = false; busy = false;
      for (const controller of controllers) controller.abort(); controllers.clear();
      get('studio-content').hidden = true; get('studio-request').value = ''; get('studio-json').value = '';
      get('studio-reviewed').checked = false;
      for (const id of ['studio-diff-output', 'studio-context-receipt', 'studio-source-files', 'studio-task-receipt', 'studio-version-receipt', 'studio-model-context', 'studio-catalog', 'studio-history', 'studio-task-history', 'studio-publication-receipt', 'studio-publication-history']) get(id).replaceChildren();
      get('studio-task-panel').hidden = true; get('studio-task-title').textContent = ''; get('studio-task-state').textContent = ''; get('studio-access-kind').textContent = ''; get('studio-repository').textContent = '';
      fileRows.clear(); say(messages.LOCAL_AUTH_REQUIRED); controlStates();
    }
    async function request(route, body, timeout = 120000) {
      if (!/^\/api\/(?:status|studio\/(?:capabilities|context|tasks(?:\/[a-f0-9]{32}(?:\/(?:propose|proposal|diff|validate|stage|verify|prepare|publish-draft|reconcile-publication|read-ci))?)?))$/.test(route)) throw Error('INPUT_INVALID');
      const generation = epoch, controller = new AbortController(); controllers.add(controller);
      const timer = w.setTimeout(() => controller.abort(), timeout);
      try {
        const response = await env.fetch(route, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (generation !== epoch) throw Error('LOCAL_AUTH_REQUIRED');
        if (response.status === 401) { endSession(); if (typeof w.dispatchEvent === 'function') w.dispatchEvent(new w.Event('aurora:local-session-invalid')); throw Error('LOCAL_AUTH_REQUIRED'); }
        if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw Error('INVALID_RESPONSE');
        const raw = await response.text(); if (generation !== epoch) throw Error('LOCAL_AUTH_REQUIRED'); if (raw.length > 1200000) throw Error('INVALID_RESPONSE');
        let value; try { value = JSON.parse(raw); } catch { throw Error('INVALID_RESPONSE'); }
        if (!response.ok) throw Error(typeof value.code === 'string' && Object.hasOwn(messages, value.code) ? value.code : 'STUDIO_OPERATION_BLOCKED');
        return value;
      } catch (error) {
        if (Object.hasOwn(messages, error.message)) throw error;
        throw Error(error.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'LOCAL_OFFLINE');
      } finally { w.clearTimeout(timer); controllers.delete(controller); }
    }
    function receipt(target, rows) {
      const list = d.createElement('dl'); list.className = 'studio-receipt';
      for (const [label, value] of rows) { const term = d.createElement('dt'), desc = d.createElement('dd'); term.textContent = label; desc.textContent = String(value); list.append(term, desc); }
      get(target).replaceChildren(list);
    }
    function renderTask(value, preserveKnownReview = false) {
      if (!validTask(value, orgId) || value.publication && !validPublication(value.publication, value, orgId)) throw Error('INVALID_RESPONSE');
      const changed = task?.id !== value.id || task?.version !== value.version || task?.proposalFingerprint !== value.proposalFingerprint;
      const keepReview = preserveKnownReview && task?.id === value.id && task?.proposalFingerprint === value.proposalFingerprint &&
        DIGEST.test(value.proposalFingerprint || '') && diffVersion === task.version && get('studio-reviewed').checked;
      task = value;
      if (changed && !keepReview) { diffVersion = null; get('studio-reviewed').checked = false; get('studio-diff-output').textContent = ''; }
      if (keepReview) diffVersion = value.version;
      get('studio-task-title').textContent = value.summary; get('studio-task-state').textContent = states[value.state];
      receipt('studio-task-receipt', [['Tarefa', value.id], ['Revisão da tarefa', value.version], ['Código de origem', value.baseRevision], ['Classificação', value.classification],
        ...(DIGEST.test(value.proposalFingerprint || '') ? [['Hash da proposta', value.proposalFingerprint]] : [])]);
      get('studio-model-context').replaceChildren();
      if (value.modelContext) {
        const p = d.createElement('p'); p.textContent = value.modelContext.complete === true ? 'O modelo recebeu os arquivos completos deste contexto.' : 'O modelo recebeu trechos limitados. Os arquivos completos continuam vinculados à tarefa para validação.';
        get('studio-model-context').append(p);
        for (const file of Array.isArray(value.modelContext.files) ? value.modelContext.files : []) {
          if (!safePath(file.path)) continue;
          const line = d.createElement('p'); line.textContent = file.path + ' · linhas ' + file.startLine + ' a ' + file.endLine + (file.complete ? ' · completo' : ' · trecho'); get('studio-model-context').append(line);
        }
      }
      get('studio-version-receipt').replaceChildren();
      const version = value.preparedVersion;
      if (version && version.state === 'PREPARED_LOCAL_ONLY' && SHA.test(version.commit) && SHA.test(version.tree) && version.pushed === false && version.deployed === false && /^refs\/heads\/aurora-studio\/[a-f0-9]{32}$/.test(version.branch)) {
        receipt('studio-version-receipt', [['Resultado', 'Versão preparada somente neste PC'], ['Commit', version.commit], ['Branch local', version.branch], ['Árvore', version.tree], ['Testes do projeto', 'Não executados'], ['CI e publicação', value.publication ? 'Consultar recibo de publicação abaixo' : 'Não executadas']]);
      }
      get('studio-publication-receipt').replaceChildren(); get('studio-publication-history').replaceChildren();
      if (value.publication) {
        if (!validPublication(value.publication, value, orgId)) throw Error('INVALID_RESPONSE');
        const p = value.publication;
        receipt('studio-publication-receipt', [['Resultado', publicationStates[p.state]],
          ['Revisão da publicação', p.publicationVersion], ['Commit enviado', p.headSha], ['Origem revisada', p.baseSha],
          ['Proposta GitHub', p.pullRequest ? p.pullRequest.url + ' · draft' : p.observedPullRequest ? p.observedPullRequest.url + ' · draft encontrado; origem alterada' : 'Ainda não confirmada'],
          ...(p.observedPullRequest ? [['Base observada do draft', p.observedPullRequest.baseSha]] : []),
          ['Testes GitHub', p.ci ? ciStates[p.ci.state] : 'Ainda não consultados'],
          ['Checkout executado pela CI', 'Não observado; promoção não liberada'], ['Implantação', 'Não executada'],
          ['Hash do registro local', p.receiptSha256]]);
        const list = d.createElement('ol'); list.className = 'studio-timeline';
        for (const event of p.history) { const row = d.createElement('li'); row.textContent = 'Publicação ' + event.version + ' · ' + publicationStates[event.state] + ' · ' + String(event.at || '');
          const digest = d.createElement('code'); digest.textContent = event.eventHash; row.append(digest); list.append(row); }
        get('studio-publication-history').append(list);
      }
      const history = d.createElement('ol'); history.className = 'studio-timeline';
      for (const event of Array.isArray(value.history) ? value.history.slice(-40) : []) {
        if (!Object.hasOwn(states, event.state) || !Number.isSafeInteger(event.version)) continue;
        const li = d.createElement('li'); li.textContent = 'Revisão ' + event.version + ' · ' + states[event.state] + ' · ' + String(event.at || '');
        if (DIGEST.test(event.eventHash || '')) { const code = d.createElement('code'); code.textContent = event.eventHash; li.append(code); } history.append(li);
      }
      get('studio-task-history').replaceChildren(history); get('studio-task-panel').hidden = false; controlStates();
    }
    function renderCatalog() {
      get('studio-catalog').replaceChildren(); fileRows.clear();
      const labels = { CONTENT_LIMIT: 'Arquivo acima do limite local', SENSITIVE_CONTENT: 'Conteúdo protegido; leitura bloqueada', UNAVAILABLE: 'Leitura indisponível' };
      for (const file of caps.repository.fileCatalog) {
        const row = d.createElement('div'); row.className = 'studio-file';
        const label = d.createElement('label'), checkbox = d.createElement('input'); checkbox.type = 'checkbox'; checkbox.disabled = file.state !== 'EDITABLE';
        const name = d.createElement('span'); name.textContent = file.path; label.append(checkbox, name); row.append(label);
        const hint = d.createElement('small'); hint.textContent = file.state === 'EDITABLE' ? (file.exists ? file.byteLength + ' bytes · fonte versionada' : 'Novo arquivo autorizado') : labels[file.state]; row.append(hint);
        const details = d.createElement('details'), summary = d.createElement('summary'); summary.textContent = 'Indicar um trecho para o modelo'; details.append(summary);
        const focusLabel = d.createElement('label'), focus = d.createElement('input'); focus.type = 'checkbox'; focusLabel.append(focus, d.createTextNode(' Usar intervalo de linhas')); details.append(focusLabel);
        const range = d.createElement('div'); range.className = 'studio-range';
        const start = d.createElement('input'), end = d.createElement('input');
        for (const [input, title] of [[start, 'Linha inicial'], [end, 'Linha final']]) { input.type = 'number'; input.min = '1'; input.step = '1'; input.setAttribute('aria-label', title + ' em ' + file.path); const wrap = d.createElement('label'); wrap.textContent = title; wrap.append(input); range.append(wrap); }
        details.append(range); row.append(details); fileRows.set(file.path, { file, checkbox, focus, start, end });
        checkbox.addEventListener('change', () => { get('studio-selection').textContent = Array.from(fileRows.values()).filter(r => r.checkbox.checked).length + ' arquivo(s) selecionado(s)'; });
        get('studio-catalog').append(row);
      }
      get('studio-selection').textContent = 'Escolha até ' + caps.limits.maxFiles + ' arquivos; contexto de até ' + caps.limits.maxContextBytes + ' bytes.';
      get('studio-repository').textContent = caps.repository.state === 'AVAILABLE' ? 'Repositório vinculado · ' + caps.repository.projectId : messages[caps.repository.state === 'CONFIG_INVALID' ? 'STUDIO_CONFIG_INVALID' : 'STUDIO_NOT_CONFIGURED'];
      get('studio-publish-config').textContent = caps.operations.publish === 'DRAFT_PR_ONLY'
        ? 'Destino: repositório público do AURORA. A conta GitHub será conferida pelo serviço local antes do envio.'
        : 'Publicação não habilitada na configuração revisada deste PC. O preparo local continua disponível.';
    }
    async function loadHistory() {
      const value = await request('/api/studio/tasks', undefined, 30000);
      if (!Array.isArray(value.tasks) || value.tasks.length > 100 || value.persistent !== true) throw Error('INVALID_RESPONSE');
      const list = d.createElement('div'); list.className = 'studio-history-list';
      for (const item of value.tasks) {
        if (!ID.test(item.id) || !Object.hasOwn(states, item.state) || typeof item.summary !== 'string' || item.summary.length > 600) throw Error('INVALID_RESPONSE');
        const button = d.createElement('button'); button.type = 'button'; button.className = 'studio-history-item'; button.textContent = item.summary + ' · ' + states[item.state];
        button.addEventListener('click', () => run(async () => { const result = await request('/api/studio/tasks/' + item.id, undefined, 30000); renderTask(result.task); context = null; syncRequired = false; say('Tarefa retomada. Confira o histórico e abra as alterações antes de continuar.'); })); list.append(button);
      }
      if (!value.tasks.length) { const p = d.createElement('p'); p.textContent = 'Nenhum pedido registrado neste repositório.'; list.append(p); }
      get('studio-history').replaceChildren(list);
    }
    async function connect(detail) {
      if (busy) return;
      busy = true; controlStates();
      try {
        const status = await request('/api/status', undefined, 30000);
        if (typeof status.orgId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(status.orgId) || detail?.orgId && detail.orgId !== status.orgId) throw Error('INVALID_RESPONSE');
        orgId = status.orgId; caps = validateCapabilities(await request('/api/studio/capabilities', undefined, 30000), orgId);
        closed = false; get('studio-content').hidden = false; get('studio-access-kind').textContent = 'Sessão do proprietário local · ' + orgId + ' · sem comprovação de login ou MFA no portal';
        renderCatalog(); await loadHistory(); syncRequired = !!task;
        say(caps.repository.state === 'AVAILABLE' ? 'Pronto para desenvolver com o código autorizado deste PC.' : get('studio-repository').textContent);
      } catch (error) { if (error.message === 'LOCAL_AUTH_REQUIRED') endSession(); else { closed = true; get('studio-content').hidden = true; say(messages[error.message] || messages.INVALID_RESPONSE, true); } }
      finally { busy = false; controlStates(); }
    }
    async function run(operation, mutation = false) {
      if (closed || busy || mutation && syncRequired) return;
      busy = true; const generation = epoch; controlStates();
      try { await operation(); }
      catch (error) {
        if (generation !== epoch || closed) return;
        if (error.message === 'LOCAL_OFFLINE') { endSession(); if (typeof w.dispatchEvent === 'function') w.dispatchEvent(new w.Event('aurora:local-session-invalid')); say(messages.LOCAL_OFFLINE, true); return; }
        if (mutation && task) syncRequired = true;
        say(messages[error.message] || messages.INVALID_RESPONSE, true);
      } finally { if (generation === epoch) { busy = false; controlStates(); } }
    }
    function selection() {
      const chosen = Array.from(fileRows.values()).filter(row => row.checkbox.checked);
      if (!caps || !chosen.length || chosen.length > caps.limits.maxFiles || chosen.some(row => row.file.state !== 'EDITABLE') || chosen.reduce((sum, row) => sum + row.file.byteLength, 0) > caps.limits.maxContextBytes) throw Error('INPUT_INVALID');
      const focus = [];
      for (const row of chosen) if (row.focus.checked) {
        const startLine = Number(row.start.value), endLine = Number(row.end.value);
        if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) throw Error('INPUT_INVALID');
        focus.push({ path: row.file.path, startLine, endLine });
      }
      return { paths: chosen.map(row => row.file.path), classification: 'INTERNAL', ...(focus.length ? { focus } : {}) };
    }
    async function mutate(action, extra = {}) {
      const a = taskActions(task, get('studio-reviewed').checked, diffVersion);
      if (syncRequired || !a[action === 'proposal' ? 'propose' : action]) throw Error(action === 'validate' || action === 'stage' || action === 'prepare' ? 'REVIEW_REQUIRED' : 'INPUT_INVALID');
      const pending = { propose: 'Gerando proposta no modelo deste PC…', proposal: 'Conferindo o patch estruturado…', validate: 'Conferindo fonte e hashes da proposta…', stage: 'Preparando uma cópia isolada…', verify: 'Executando as verificações estáticas…', prepare: 'Preparando commit e branch locais…' };
      say(pending[action]); const before = task;
      const result = await request('/api/studio/tasks/' + task.id + '/' + action, { expectedVersion: task.version, ...extra });
      const expectedState = { propose: 'PROPOSED', proposal: 'PROPOSED', validate: 'VALIDATED', stage: 'PATCH_STAGED', verify: 'STATIC_CHECKS_PASSED', prepare: 'VERSION_PREPARED' }[action];
      if (result.task?.id !== before.id || result.task?.version <= before.version || result.task?.state !== expectedState ||
        !['propose', 'proposal'].includes(action) && result.task?.proposalFingerprint !== before.proposalFingerprint) throw Error('INVALID_RESPONSE');
      renderTask(result.task, !['propose', 'proposal'].includes(action)); say(states[task.state] + '.');
      // Carry a reviewed, identical proposal only across our confirmed CAS transitions; refresh or a new proposal clears it.
      await loadHistory();
    }
    get('studio-create').addEventListener('click', () => run(async () => {
      const prompt = get('studio-request').value;
      if (typeof prompt !== 'string' || prompt.trim().length < 8 || prompt.length > 6000 || prompt.includes('\0') || prompt.includes('\r')) throw Error('INPUT_INVALID');
      const result = await request('/api/studio/context', selection());
      const c = result.context;
      if (!c || c.schemaVersion !== SCHEMA || c.orgId !== orgId || !ID.test(c.id) || !SHA.test(c.baseRevision) || !Array.isArray(c.files)) throw Error('INVALID_RESPONSE');
      context = c;
      const created = await request('/api/studio/tasks', { contextId: c.id, prompt, classification: 'INTERNAL' }); renderTask(created.task); syncRequired = false;
      receipt('studio-context-receipt', [['Código de origem', c.baseRevision], ['Arquivos vinculados', c.files.length], ['Limite do modelo', 'Trechos limitados; os arquivos completos ficam preservados']]);
      get('studio-source-files').replaceChildren();
      for (const file of c.files) {
        if (!safePath(file.path) || !caps.repository.allowedPaths.includes(file.path) || typeof file.content !== 'string' || file.content.length > 30000 || !(file.beforeSha256 === null || DIGEST.test(file.beforeSha256))) throw Error('INVALID_RESPONSE');
        const details = d.createElement('details'), summary = d.createElement('summary'), hash = d.createElement('p'), source = d.createElement('pre');
        summary.textContent = file.path; hash.textContent = 'beforeSha256: ' + (file.beforeSha256 === null ? 'null · arquivo novo' : file.beforeSha256); source.textContent = file.content; source.className = 'studio-diff'; source.tabIndex = 0;
        details.append(summary, hash, source); get('studio-source-files').append(details);
      }
      get('studio-json').value = '';
      say('Pedido registrado. Gere a proposta neste PC ou importe um patch estruturado.'); await loadHistory();
    }, true));
    get('studio-propose').addEventListener('click', () => run(() => mutate('propose'), true));
    get('studio-import').addEventListener('click', () => run(async () => {
      const raw = get('studio-json').value; if (raw.length > 350000) throw Error('INPUT_INVALID'); let proposal;
      try { proposal = JSON.parse(raw); } catch { throw Error('STUDIO_PROPOSAL_INVALID'); }
      await mutate('proposal', { proposal }); get('studio-json').value = '';
    }, true));
    get('studio-diff').addEventListener('click', () => run(async () => {
      if (!taskActions(task, false, null).diff) throw Error('INPUT_INVALID');
      const result = await request('/api/studio/tasks/' + task.id + '/diff', undefined, 30000);
      if (result.taskId !== task.id || result.version !== task.version || typeof result.diff !== 'string' || result.diff.length > 700000 || result.validation?.proposalFingerprint !== task.proposalFingerprint) throw Error('STUDIO_VERSION_CONFLICT');
      get('studio-diff-output').textContent = result.diff; diffVersion = task.version; get('studio-reviewed').checked = false;
      say('Alterações abertas. Confira os arquivos e marque a revisão para avançar.');
    }));
    get('studio-reviewed').addEventListener('change', controlStates);
    for (const action of ['validate', 'stage', 'prepare']) get('studio-' + action).addEventListener('click', () => run(() => mutate(action), true));
    get('studio-verify').addEventListener('click', () => run(async () => { await mutate('verify', { recipeId: 'SYNTAX_AND_DIFF_V1' }); say('Verificações estáticas aprovadas. Os testes do projeto e o CI ainda precisam ser executados.'); }, true));
    async function publicationAction(operation) {
      if (!task || task.state !== 'VERSION_PREPARED' || caps.operations.publish !== 'DRAFT_PR_ONLY' ||
        operation === 'publish-draft' && (!get('studio-reviewed').checked || diffVersion !== task.version)) throw Error('REVIEW_REQUIRED');
      const before = task;
      const result = await request('/api/studio/tasks/' + task.id + '/' + operation,
        { expectedVersion: task.version, proposalFingerprint: task.proposalFingerprint }, 190000);
      if (!validTask(result.task, orgId) || result.task.id !== before.id || result.task.version !== before.version ||
        result.task.state !== 'VERSION_PREPARED' || result.task.proposalFingerprint !== before.proposalFingerprint ||
        !validPublication(result.publication, result.task, orgId) ||
        result.task.publication?.receiptSha256 !== result.publication.receiptSha256 ||
        result.task.publication?.publicationVersion !== result.publication.publicationVersion) throw Error('INVALID_RESPONSE');
      renderTask(result.task, true); say(result.publication.ci ? ciStates[result.publication.ci.state] : publicationStates[result.publication.state]);
    }
    for (const [id, action] of [['studio-publish', 'publish-draft'], ['studio-reconcile-publication', 'reconcile-publication'], ['studio-read-ci', 'read-ci']])
      get(id).addEventListener('click', () => run(() => publicationAction(action), true));
    get('studio-refresh-task').addEventListener('click', () => run(async () => {
      const result = await request('/api/studio/tasks/' + task.id, undefined, 30000); renderTask(result.task); syncRequired = false; say('Tarefa atualizada. Abra as alterações para conferir a revisão atual.');
    }));
    get('studio-refresh-history').addEventListener('click', () => run(loadHistory));
    get('studio-reconnect').addEventListener('click', () => connect());
    w.addEventListener('aurora:local-session-ready', event => connect(event.detail));
    w.addEventListener('aurora:local-session-ended', endSession);
    w.addEventListener('pagehide', endSession);
    if (get('workspace') && !get('workspace').hidden) connect(); else controlStates();
    return { endSession, connect, taskActions, getState: () => ({ orgId, closed, task, context, syncRequired, busy, diffVersion }), renderTask };
  }
  return { mount, safePath, validTask, validateCapabilities, taskActions, validPublication };
});
