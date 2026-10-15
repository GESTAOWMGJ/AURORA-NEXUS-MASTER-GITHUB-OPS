import { notFound } from 'next/navigation';
import { LivePanel } from '../../../components/live-panel';
import { MONTH, ORG, monthInSaoPaulo } from '../../../lib/contracts.mjs';
export const dynamic = 'force-dynamic';
export default async function AuditPage({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ competence?: string | string[] }> }) {
  const { orgId } = await params, query = await searchParams;
  const competence = query.competence ?? monthInSaoPaulo();
  if (!ORG.test(orgId) || typeof competence !== 'string' || !MONTH.test(competence)) notFound();
  return <><p className="eyebrow">PAINEL INSTITUCIONAL</p><h1>Receita e governança</h1><p className="lead">Instituição: {orgId}. A seleção não concede acesso aos dados.</p>
    <form className="toolbar" action={`/auditoria/${orgId}`}><label htmlFor="competence">Competência</label><input type="month" id="competence" name="competence" defaultValue={competence} required /><button className="secondary" type="submit">Aplicar</button></form>
    <LivePanel key={`${orgId}:${competence}`} orgId={orgId} competence={competence} enabled={process.env.JFN_INTEGRATION_MODE === 'homologation'} /></>;
}
