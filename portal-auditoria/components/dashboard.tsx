import { brl } from '../lib/contracts.mjs';
export type DashboardData = {
  snapshot: { orgId: string; competence: string; generatedAt: string; policyVersion: string;
    completeness: string; severity: string;
    financial: { billedAmount: number | null; receivedAmount: number | null; pendingAmount: number | null; reconciliationDifference: number | null; currency: string };
    audit: { openFindings: number | null; criticalFindings: number | null; overdueActions: number | null; evidenceGaps: number | null };
    pipeline: { total: number | null; validated: number | null; pendingHumanReview: number | null };
    sources: { source: string; completeness: string; freshness: string; missing: boolean; lastSuccessAt: string | null }[] };
  freshness: { state: string; ageSeconds: number; generatedAt: string };
};
const states: Record<string,string> = { COMPLETE: 'Completo', PARTIAL: 'Parcial', EMPTY: 'Sem dados', INVALID: 'Inválido',
  FRESH: 'Atual', DELAYED: 'Atrasado', STALE: 'Desatualizado', UNKNOWN: 'Não aferido', NOMINAL: 'Sem alerta', ATTENTION: 'Atenção', BLOCKED: 'Bloqueio independente' };
export function Dashboard({ data, demo = false }: { data: DashboardData; demo?: boolean }) {
  const { snapshot: s, freshness } = data;
  return <>
    <div className="summary"><span>{demo ? 'EXEMPLO FICTÍCIO' : `INSTITUIÇÃO: ${s.orgId}`}</span><span>Competência {s.competence}</span></div>
    <div className="metrics">
      {[['Faturamento apresentado', brl(s.financial.billedAmount)], ['Recebimento informado', brl(s.financial.receivedAmount)],
        ['Recebível informado', brl(s.financial.pendingAmount)], ['Achados abertos', s.audit.openFindings ?? 'Não informado']].map(([name, value]) =>
        <article className="metric" key={name}><h2>{name}</h2><strong>{value}</strong></article>)}
    </div>
    <section id="faturamento" className="panel"><p className="eyebrow">JFN-AUD-FAT-001</p><h2>Confrontamento e rastreabilidade</h2>
      <p>Contrato → produção → faturamento → glosas → nota fiscal → recebimento → repasses.</p>
      <div className="notice">O snapshot atual fornece indicadores agregados. Contratos, produção detalhada, notas e repasses ainda não têm um contrato de leitura integrado a esta tela. Nenhuma etapa ausente foi presumida.</div>
      <dl><dt>Diferença de conciliação informada pela fonte</dt><dd>{brl(s.financial.reconciliationDifference)}</dd>
      <dt>Lacunas documentais</dt><dd>{s.audit.evidenceGaps ?? 'Não informado'}</dd>
      <dt>Pendências de revisão humana</dt><dd>{s.pipeline.pendingHumanReview ?? 'Não informado'}</dd></dl>
      <p className="muted">Valor pendente não equivale a glosa, perda ou recuperação. Fechamento gerencial com ressalvas não encerra achados nem autoriza pagamentos.</p>
    </section>
    <section id="evidencias" className="panel"><h2>Fontes e qualidade dos dados</h2>
      <p>Completude: <strong>{states[s.completeness] ?? s.completeness}</strong> · Atualidade: <strong>{states[freshness.state] ?? freshness.state}</strong> · Situação: <strong>{states[s.severity] ?? s.severity}</strong></p>
      <div className="table-scroll"><table><caption>Estado das fontes — não substitui os documentos originais.</caption><thead><tr><th>Fonte</th><th>Completude</th><th>Atualidade</th><th>Ausente</th></tr></thead>
        <tbody>{s.sources.map((source, index) => <tr key={index}><td>{source.source}</td><td>{states[source.completeness]}</td><td>{states[source.freshness]}</td><td>{source.missing ? 'Sim' : 'Não'}</td></tr>)}</tbody></table></div>
      <p className="muted">Snapshot: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(s.generatedAt))} · America/Sao_Paulo · Regra: {s.policyVersion}</p>
    </section>
  </>;
}
