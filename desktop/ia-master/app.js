'use strict';
const el = id => document.getElementById(id);
let proposal = null;
function clearSession() { el('workspace').hidden = true; el('logout').hidden = true; el('result').textContent = ''; el('native-result').textContent = ''; el('prompt').value = ''; el('snapshot').value = ''; proposal = null; el('session').textContent = 'Abra “IA Master — Acesso local” na pasta AURORA deste Windows para iniciar uma sessão privada.'; }
async function request(route, body) {
  const response = await fetch(route, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) { clearSession(); throw Error('Acesso local necessário.'); }
  const data = await response.json();
  if (!response.ok) throw Error(data.code === 'LOCAL_MODEL_BUSY' ? 'O modelo está ocupado. Aguarde a consulta atual terminar.' : 'Operação não concluída: ' + (data.code || response.status));
  return data;
}
async function status() {
  const s = await request('/api/status'); el('workspace').hidden = false; el('logout').hidden = false;
  el('session').textContent = 'Sessão local · ' + s.orgId + ' · v' + s.version;
  el('model').textContent = s.model; el('model-state').textContent = s.modelState === 'AVAILABLE' ? 'Disponível neste PC' : 'Modelo local ainda indisponível';
  el('tokens').textContent = String(s.metrics.externalTokens); el('hardware').textContent = s.hardware.logicalCpuCount + ' threads';
  el('memory').textContent = s.hardware.freeRamGiB + ' GB livres / ' + s.hardware.totalRamGiB + ' GB RAM';
  el('sync').textContent = 'não confirmada'; el('integrations').replaceChildren();
  for (const i of s.integrations) { const div = document.createElement('div'); div.textContent = i.id + ' — ' + i.purpose + ' · integração local pendente de credencial e teste'; el('integrations').append(div); }
}
el('improve').addEventListener('click', async () => {
  el('improve').disabled = true; el('download').hidden = true; proposal = null; el('result').textContent = 'Processando no modelo local…';
  try { const r = await request('/api/improve', { prompt: el('prompt').value, classification: 'INTERNAL' }); proposal = r; el('result').textContent = r.proposal.text + '\n\nProposta para revisão · aplicação automática: não · tokens externos: 0'; el('download').hidden = false; }
  catch (e) { el('result').textContent = e.message; } finally { el('improve').disabled = false; }
});
el('native').addEventListener('click', async () => {
  el('native').disabled = true;
  try { const snapshot = JSON.parse(el('snapshot').value); const r = await request('/api/native', { snapshot, classification: 'INTERNAL' }); el('native-result').textContent = 'Prévia local; autenticidade da origem não comprovada.\n' + JSON.stringify(r.master, null, 2); }
  catch (e) { el('native-result').textContent = e.message; } finally { el('native').disabled = false; }
});
el('download').addEventListener('click', () => { if (!proposal) return; const blob = new Blob([JSON.stringify(proposal, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'aurora-proposta-' + proposal.proposalId.slice(0, 12) + '.json'; a.click(); URL.revokeObjectURL(url); });
el('logout').addEventListener('click', async () => { await request('/api/logout', {}); clearSession(); });
(async () => { const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket'); history.replaceState(null, '', '/'); try { if (ticket) await request('/api/session', { ticket }); await status(); } catch { clearSession(); } })();
