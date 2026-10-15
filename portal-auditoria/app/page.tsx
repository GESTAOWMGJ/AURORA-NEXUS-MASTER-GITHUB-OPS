import Link from 'next/link';
export default function Home() {
  return <><p className="eyebrow">PLATAFORMA INSTITUCIONAL JFN</p><h1>Uma visão integrada.<br />Cada valor, uma evidência.</h1>
    <p className="lead">Auditoria hospitalar, confrontamento de faturamento e rastreabilidade da receita em um ambiente único.</p>
    <section className="panel"><h2>Escolha o ambiente</h2><p>O acesso institucional depende de autenticação e vínculo autorizado no backend. Não há cadastro público de instituições.</p>
    <div className="toolbar"><Link className="button" href="/auditoria/wmgj">Acesso à operação WMGJ</Link><Link className="button secondary" href="/demo">Explorar dados fictícios</Link></div></section>
    <section id="faturamento" className="panel"><h2>Confrontamento de faturamento</h2><p>Valores produzidos, apresentados, aprovados, glosados, faturados e recebidos são etapas distintas. Lacunas documentais permanecem visíveis.</p></section>
    <section id="evidencias" className="panel"><h2>Evidência antes da conclusão</h2><p>Divergências continuam abertas até resolução documentada. Fechar gerencialmente uma competência não apaga o histórico.</p></section></>;
}
