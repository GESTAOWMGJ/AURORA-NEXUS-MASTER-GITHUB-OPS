import { Dashboard, type DashboardData } from '../../components/dashboard';
import { demoDashboard } from '../../lib/demo.mjs';
import { difference, compareReply, proposeClosing } from '../../lib/reconciliation.mjs';
import { brl } from '../../lib/contracts.mjs';
export default function DemoPage() {
  const delta = difference(100000, 85000), reply = compareReply(15000, 5000, true);
  const closing = proposeClosing({ independentBlockers: [], openFindings: 2, evidenceComplete: false, humanApproved: true });
  return <><p className="eyebrow">DEMONSTRAÇÃO SEM CONEXÃO EXTERNA</p><h1>Confrontamento, sem perder o contexto.</h1>
    <p className="notice">Todos os valores e registros abaixo são fictícios. Não representam a WMGJ, hospital ou paciente real.</p>
    <Dashboard data={demoDashboard() as DashboardData} demo />
    <section className="panel"><h2>Exemplo determinístico de pergunta × resposta</h2><dl>
      <dt>Diferença hipotética</dt><dd>{brl(delta.deltaCents! / 100)}</dd><dt>Explicação aceita com evidência fictícia</dt><dd>{brl(50)}</dd>
      <dt>Saldo ainda não explicado</dt><dd>{brl(reply.residualCents! / 100)}</dd></dl>
      <p>O exemplo admite fechamento gerencial com ressalvas, mantém {closing.openFindings} achados abertos e não autoriza pagamentos.</p>
      <p className="muted">Simulação local do método. Não grava resposta administrativa, não fecha competência e não altera Firestore.</p></section></>;
}
