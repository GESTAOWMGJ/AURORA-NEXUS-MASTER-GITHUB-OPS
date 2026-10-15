'use client';
import { useEffect, useRef, useState } from 'react';
import { authorizedHeaders, login, logout } from '../lib/firebase-client';
import { parseDashboard } from '../lib/contracts.mjs';
import { Dashboard, type DashboardData } from './dashboard';
const messages: Record<string,string> = { INTEGRATION_DISABLED: 'Conexão desabilitada. Homologação ainda não ativada.',
  FIREBASE_NOT_CONFIGURED: 'Firebase de homologação não configurado.', HOMOLOGATION_PROJECT_REQUIRED: 'Este projeto não é de homologação autorizada.',
  ORG_NOT_ALLOWED: 'Instituição não habilitada neste ambiente.', SCOPE_DENIED: 'O backend não autorizou acesso a esta instituição.',
  SNAPSHOT_NOT_FOUND: 'Não há snapshot para esta competência. Ausência não é valor zero.', AUTH_REJECTED: 'Sessão recusada ou expirada. Entre novamente.',
  UPSTREAM_NOT_CONFIGURED: 'Backend de homologação não configurado.', UPSTREAM_RATE_LIMIT: 'Limite de consultas atingido. Não houve atualização.' };
export function LivePanel({ orgId, competence, enabled }: { orgId: string; competence: string; enabled: boolean }) {
  const [authenticated, setAuthenticated] = useState(false), [busy, setBusy] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  async function load(needsLogin: boolean) {
    const current = ++generation.current;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setData(null); setError('');
    try {
      if (needsLogin) await login();
      if (current !== generation.current) return;
      setAuthenticated(true);
      const headers = await authorizedHeaders();
      const query = new URLSearchParams({ orgId, competence });
      const response = await fetch(`/api/dashboard?${query}`, { headers, cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code ?? 'READ_FAILED');
      const parsed = parseDashboard(body, orgId, competence) as unknown as DashboardData;
      if (current === generation.current) setData(parsed);
    } catch (e) {
      if (current !== generation.current || controller.signal.aborted) return;
      const code = e instanceof Error ? e.message : '';
      setError(messages[code] ?? 'Consulta não concluída. Nenhum dado foi substituído por estimativas.');
    } finally { if (current === generation.current) setBusy(false); }
  }
  async function leave() { generation.current++; request.current?.abort(); setData(null); setAuthenticated(false); setBusy(false); setError(''); try { await logout(); } catch { setError('Saída local concluída; feche a aba antes de trocar de usuário.'); } }
  return <>
    <div className="toolbar"><button disabled={!enabled || busy} onClick={() => load(!authenticated)}>{busy ? 'Consultando…' : authenticated ? 'Atualizar dados' : 'Entrar com Google e consultar'}</button>
      {authenticated && <button className="secondary" onClick={leave}>Sair e limpar tela</button>}</div>
    {!enabled && <p className="notice">Integração externa desabilitada. A demonstração utiliza somente dados fictícios.</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    <div aria-live="polite" aria-busy={busy}>{data ? <Dashboard data={data} /> : <section className="panel"><h2>Área institucional protegida</h2><p>Os indicadores aparecem somente após autorização do backend para a instituição e competência selecionadas.</p></section>}</div>
  </>;
}
