# Aurora Nexus — gestão clara

## Referência e identidade

Adaptação da linguagem editorial da referência de consultório aprovada pelo titular: base creme, bloco petróleo profundo, ouro em filetes e curvas, títulos serifados e espaço para leitura. A identidade do produto é Aurora Nexus. Preservar o ícone existente; não transferir nomes, iniciais profissionais, dados pessoais ou conteúdo clínico da referência.

Tokens canônicos: petróleo #073B4C; creme #F7F2E9; ouro #C59A45; superfície #FFFDF8; texto #173F48; apoio #53656A; linhas #D9D4C7. Risco #A53328; atenção #86501A; confirmado #246647; informação #175A70. Ouro claro funciona como detalhe, não como texto pequeno sobre creme.

Interface: Source Serif 4 nos títulos, Atkinson Hyperlegible Next nos controles e valores, com fontes locais licenciadas OFL. Fallback serif Georgia e sans do sistema. Raio 16 px, espaçamento principal 16/24/32 px, controles com área mínima de44px, foco visível, movimento reduzido quando solicitado pelo dispositivo. Sem neon, brilho intenso ou gráficos financeiros sem série comprovada.

A continuação de 15/10/2026 aplica a marca visível com o mesmo `/aurora-icon.svg` nas páginas reais de acesso, segurança da própria conta e downloads. Não trocar o ícone ou a identidade do aplicativo por uma variante de referência. Login e segundo fator mantêm a hierarquia de títulos e os tokens existentes; o primeiro acesso ganha explicação em português sem alterar a autorização.

## Linguagem e hierarquia

A primeira visão responde: o que pesa no bolso, o que precisa de atenção e qual a próxima ação. “Olho no bolso” enfatiza a prioridade com cifra grande, competência e fonte qualificada. Cópia quase provocativa, sem inventar perdas: “Contas vencidas não esperam”, “Receita em disputa”, “Faturar ainda não é receber”. Nunca somar exposições sobrepostas.

Ausência permanece “Sem fonte”, nunca zero. Glosa em revisão não equivale a perda definitiva. Previsão não é dinheiro disponível. Cenários de teste e modo observacional precisam de indicação explícita. Geração do resumo não comprova a data do extrato.

Navegação: Hoje, Financeiro, Pendências, Assistente Aurora, Equipe e conexões, Histórico. Detalhes técnicos em disclosures. Mobile mantém acesso ao menu. A próxima ação conserva as rotas e contratos existentes, autorização por empresa, CSRF e idempotência.

## Master

Ambiente separado para administrador com todas as unidades e segundo fator confirmado. Pedido → Proposta → Revisão → Verificação → Versão local. Modelo local; pareamento explícito e credencial em memória. Catálogo confirmado substitui entrada manual de caminhos. JSON e diagnósticos ficam nas opções avançadas. Mostrar indisponibilidade e limites sem fingir conexão, testes gerais, aplicação ou publicação. Cada passo depende do resultado confirmado e da revisão vigente.

O incremento em revisão acrescenta progresso visual por etapa e resumo legível dos recibos, preservando os detalhes avançados. Tocar em parear com o campo vazio deve apenas orientar e focar a entrada do código, sem fazer request. Histórico sem recibo detalhado deve explicar a ausência sem invalidar a etapa registrada. A conferência por diff não registra validação; preparo e publicação exigem o recibo de verificação vinculado à proposta.

## Acesso e recuperação

O segundo fator usa `mfa-form` com um único submit; o botão de ajuda sobre perda do autenticador é separado. Enter segue o mesmo handler de confirmação e não deve gerar autenticações duplicadas. As descrições acessíveis ligam o código à orientação e ao status.

Após ação do usuário, o foco acompanha o campo visível e pronto: código do autenticador, e-mail de recuperação, nova senha depois de validar o link e retorno ao acesso. Não roubar foco durante respostas atrasadas, após saída/retorno da página ou na abertura automática de um link. Preservar a limpeza de material sensível e todas as regras existentes de sessão, senha e MFA.

A metapolítica CSP `form-action 'none'` na página de acesso restringe envios HTML nativos antes da inicialização ou em falha do JavaScript. Isso não substitui os handlers e gates existentes. No Chrome, o formulário válido sem módulo JavaScript permaneceu na mesma URL após Entrar, sem acrescentar os campos à URL, em prévia inerte local.

## Implementação e evidência

Fontes atuais: auroraDesignSystem.ts, auroraExperience.ts, auroraFinancialPresentation.ts, auroraFrontend.ts e auroraIaMasterView/Client.ts. Prévia usa exclusivamente dados ilustrativos, está marcada TEST_ONLY e não aceita mutações operacionais. Render, navegação desktop/mobile, leitura sem duplicação de IDs e testes de valores têm provas próprias. Em 15/10/2026, autenticação e importações no projeto Superdesign existente foram confirmadas. O painel mantém o mesmo draft e histórico; três variantes de acesso preservam suas direções e IDs, sem escolha implícita de versão operacional. Links Art Déco são demonstrações de navegação, não autenticação. Estado por alvo em resume.json; publicação e dado real exigem recibos separados.

As páginas reais de acesso e conta usam auroraAuthGate.ts, auroraLoginClient.ts, auroraPasswordRecovery.ts e auroraAccountSecurity.ts; downloads usam auroraDownloads.ts. Arquivos de referência em `.superdesign/context` não constituem implementação ou instalação. O acesso à ferramenta Superdesign citado acima também não comprova autenticação no Aurora.

Histórico da primeira fase: 55 testes locais e compilação passaram, com smoke sintético em 1440 × 1000 e 390 × 844. Após as correções de histórico, a continuação registrou 161 testes: 160 pass, zero fail e um skip de symlink no Windows; build passou. A CI do SHA final permanece uma evidência separada.

Smoke Chrome desta continuação: marca real na tela de acesso, segundo fator sem overflow em largura de 1225 px e foco em `mfa-code` confirmados. Acesso e Master também foram conferidos em 320 px sem overflow horizontal; Master em 1440 × 1000. Fallback sem módulo JavaScript observado conforme acima; botão MFA acionou o resolver fictício uma vez. Enter está coberto nos testes do handler, mas seu smoke nativo não foi confirmado pela automação do navegador. PR #265 continua draft. Nenhuma dessas provas declara instalação, autenticação real, publicação ou dados operacionais verificados; o fechamento final cabe à entrega com seus recibos próprios.
