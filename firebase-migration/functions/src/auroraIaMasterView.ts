export function iaMasterSection(): string {
  return `<section class="section card" id="ia-master" aria-labelledby="ia-master-title">
  <h2 id="ia-master-title">IA Master</h2>
  <p>Desenvolvimento e operação com processamento local.</p>
  <div class="modules"><div class="module"><b>1</b><span>Motor nativo · regras explicáveis, sem tokens externos</span></div>
  <div class="module"><b>2</b><span>Modelo local · análise e propostas no PC conectado</span></div>
  <div class="module"><b>3</b><span>Melhorias · proposta, testes, revisão, CI e reversão</span></div>
  <div class="module"><b>4</b><span>Integrações · identidade própria e acesso limitado por plataforma</span></div></div>
  <div class="native-actions"><a class="btn primary" href="http://127.0.0.1:38765" target="_blank" rel="noopener noreferrer">Abrir IA Master neste PC</a><a class="btn" href="/organic">Aprendizado validado</a></div>
  <p class="sub">No primeiro acesso local, use “IA Master — Acesso local” na pasta do AURORA. O pareamento vale somente neste PC. A disponibilidade local e a sincronização precisam de confirmação própria; este painel não comprova conexão. O acesso local funciona apenas no PC servidor; no celular, use o portal.</p>
  <p class="sub">Serviços externos de IA ficam desativados. Conectar uma plataforma nesta conversa não provisiona credenciais no aplicativo.</p>
  </section>`;
}
