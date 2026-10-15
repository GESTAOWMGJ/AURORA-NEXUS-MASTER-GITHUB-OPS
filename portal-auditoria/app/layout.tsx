import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata: Metadata = { title: 'JFN | Governança e Auditoria', description: 'Ambiente de homologação institucional.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body><a className="skip" href="#conteudo">Ir para o conteúdo</a>
    <header><Link className="brand" href="/">JFN <span>CONSULTORIA & AUDITORIA HOSPITALAR</span></Link><span className="badge">HOMOLOGAÇÃO · SOMENTE LEITURA</span></header>
    <div className="workspace"><aside><p className="eyebrow">GOVERNANÇA HOSPITALAR</p><nav aria-label="Navegação principal">
      <Link href="/">Acesso institucional</Link><Link href="/demo">Demonstração sintética</Link>
      <a href="#faturamento">Confrontamento</a><a href="#evidencias">Fontes e evidências</a><a href="#integracao">Estado da integração</a>
    </nav><p className="muted">Contrato. Receita. Evidência.<br />Decisão documentada.</p></aside>
    <main id="conteudo">{children}<section id="integracao" className="panel"><h2>Estado da integração</h2>
      <p>React e Next.js compõem a interface. Firebase autentica. O backend existente valida permissões e consulta Firestore. Gmail, Drive, Sheets e Apps Script permanecem preservados.</p>
      <p className="muted">Sem publicação em produção, migração, fechamento, pagamento ou gravação de dados por esta interface.</p></section></main></div>
    <footer>JF Neto SM Ltda · Auditoria e governança hospitalar · JFN-AUD-FAT-001</footer></body></html>;
}
