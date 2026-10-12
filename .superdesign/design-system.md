# Aurora Nexus — gestão clara

## Referência e identidade

Adaptação da linguagem editorial da referência de consultório aprovada pelo titular: base creme, bloco petróleo profundo, ouro em filetes e curvas, títulos serifados e espaço para leitura. A identidade do produto é Aurora Nexus. Preservar o ícone existente; não transferir nomes, iniciais profissionais, dados pessoais ou conteúdo clínico da referência.

Tokens canônicos: petróleo #073B4C; creme #F7F2E9; ouro #C59A45; superfície #FFFDF8; texto #173F48; apoio #53656A; linhas #D9D4C7. Risco #A53328; atenção #86501A; confirmado #246647; informação #175A70. Ouro claro funciona como detalhe, não como texto pequeno sobre creme.

Interface: Source Serif 4 nos títulos, Atkinson Hyperlegible Next nos controles e valores, com fontes locais licenciadas OFL. Fallback serif Georgia e sans do sistema. Raio 16 px, espaçamento principal 16/24/32 px, controles com área mínima de44px, foco visível, movimento reduzido quando solicitado pelo dispositivo. Sem neon, brilho intenso ou gráficos financeiros sem série comprovada.

## Linguagem e hierarquia

A primeira visão responde: o que pesa no bolso, o que precisa de atenção e qual a próxima ação. “Olho no bolso” enfatiza a prioridade com cifra grande, competência e fonte qualificada. Cópia quase provocativa, sem inventar perdas: “Contas vencidas não esperam”, “Receita em disputa”, “Faturar ainda não é receber”. Nunca somar exposições sobrepostas.

Ausência permanece “Sem fonte”, nunca zero. Glosa em revisão não equivale a perda definitiva. Previsão não é dinheiro disponível. Cenários de teste e modo observacional precisam de indicação explícita. Geração do resumo não comprova a data do extrato.

Navegação: Hoje, Financeiro, Pendências, Assistente Aurora, Equipe e conexões, Histórico. Detalhes técnicos em disclosures. Mobile mantém acesso ao menu. A próxima ação conserva as rotas e contratos existentes, autorização por empresa, CSRF e idempotência.

## Master

Ambiente separado para administrador com todas as unidades e segundo fator confirmado. Pedido → Proposta → Revisão → Verificação → Versão local. Modelo local; pareamento explícito e credencial em memória. Catálogo confirmado substitui entrada manual de caminhos. JSON e diagnósticos ficam nas opções avançadas. Mostrar indisponibilidade e limites sem fingir conexão, testes gerais, aplicação ou publicação. Cada passo depende do resultado confirmado e da revisão vigente.

## Implementação e evidência

Fontes atuais: auroraDesignSystem.ts, auroraExperience.ts, auroraFinancialPresentation.ts, auroraFrontend.ts e auroraIaMasterView/Client.ts. Prévia usa exclusivamente dados ilustrativos, está marcada TEST_ONLY e não aceita mutações operacionais. Render, navegação desktop/mobile, leitura sem duplicação de IDs e testes de valores precisam de comprovação própria. O canvas Superdesign ainda depende de autenticação; nenhum draft ou ID remoto foi presumido.
