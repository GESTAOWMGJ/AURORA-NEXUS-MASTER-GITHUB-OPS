# AURORA NEXUS — Finance Signal

Data: 26/09/2026. Escopo: redesign visual solicitado pelo proprietário, não alteração da lógica financeira.

## Direção gráfica

Centro de comando financeiro com fundo escuro, tipografia sans-serif, números tabulares grandes, cartões de dinheiro saturados e alertas com significado. Sem animações contínuas, cintilação ou fundos decorativos concorrendo com a leitura.

| Papel | Cor | Aplicação |
|---|---|---|
| Base | `#080c16` | Fundo do aplicativo |
| Superfície | `#101827` | Painéis e login |
| Faturamento | `#30d7ff` | Cartão de faturamento; marca Nexus |
| Recebimentos / resultado positivo apurado | `#49f5a4` | Recebimentos; token visual para lucro quando houver fonte apropriada |
| Pendência | `#ffcb57` | A receber e divergência que exige conferência |
| Prejuízo apurado / crítico | `#ff647c` | Alertas críticos; token visual para perda quando houver fonte apropriada |
| Navegação editorial | `#b39aff` | Categorias e identificação do ambiente |
| Ação primária | `#c0fa65` | Entrar e aplicar escopo |

Faturamento não é recebimento. Recebimento não é lucro. Pendência não significa inadimplência. Diferença de conciliação, inclusive negativa, não equivale a prejuízo.

O contrato atual do painel fornece faturado, recebido, pendente e diferença de conciliação, mas não resultado líquido. Por isso lucro/prejuízo permanece explicitamente não aferido. Os seletores visuais `data-finance="profit"` e `data-finance="loss"` ficam disponíveis para uma futura integração com dados financeiros adequadamente apurados; não há cálculo ou valor sintético em produção.

## Implementação

- `firebase-migration/api/wmgj_api/static/dashboard.html`: identidade Aurora Nexus, leitura financeira prioritária e navegação por seções. IDs consumidos pelo script existente preservados.
- `firebase-migration/api/wmgj_api/static/aurora-visual.css`: tema responsivo, estados sem dados, impressão, teclado e movimento reduzido. Não altera autenticação.
- `firebase-migration/api/wmgj_api/static/aurora-visual.js`: observação apenas de alterações de conteúdo nos indicadores e alertas. Ausência de valor torna o cartão neutro; contagem crítica zero não fica vermelha; intensidade do painel deriva da severidade existente. Não consulta APIs, não armazena dados, não lê credenciais e não remove a proteção `hidden`.
- `firebase-migration/functions/src/auroraAuthGate.ts`: estilo e texto do login e do shell privado; sem mudança nas verificações, lista de acesso, cookies, cabeçalhos, endpoints ou roteamento.

A atualização de dados e os estados online, parcial, atrasado e offline continuam sob controle do script existente. A revisão visual não introduz feed, streaming, integração de IA, cálculo de lucro ou ações financeiras automáticas.

## Segurança e limite de publicação

O login continua sendo a primeira página para visitantes sem sessão no Auth Gate. Nenhum cartão financeiro foi adicionado ao HTML de login. Não publicar demonstração nem expor os assets do painel como aplicação pública para contornar o Auth Gate.

O Auth Gate atual devolve um shell privado de acesso autenticado. Esta revisão de estilo NÃO conecta automaticamente esse shell ao dashboard FastAPI nem resolve a ponte de autenticação/App Check entre eles. Integração privada do painel, homologação completa e publicação continuam como etapas separadas. Não apresentar commit/PR como deploy.

O mecanismo de demonstração já existente em `dashboard.js` não é alterado nem habilitado por esta revisão. As prévias de design foram renderizadas apenas em teste local, com fixture explicitamente sintética, sem publicação em domínio.

## Validação executada localmente

Chromium: 1440, 1024, 768, 430, 390, 375 e 320 pixels, sem overflow da página ou dos cartões na fixture. Login verificado em 1280, 390 e 320 pixels, com senha presente e sem markup de dashboard.

Verificados: IDs únicos; dashboard e banner de demo inicialmente ocultos; valores ausentes neutros; achados críticos zero neutros; reset do sinal de alerta; movimento reduzido; impressão; ausência de erro JavaScript na fixture visual.

Testes de regressão com Firebase simulado: login anônimo, sessão autorizada, sessão revogada, e-mail não permitido, método negado, flags do cookie, token ausente/não autorizado, lista de acesso vazia e logout. Transpilação sintática TypeScript aprovada. Esses testes não substituem build integral nem autenticação em nuvem real.

Contrastes calculados para sete pares principais de texto/fundo: 6,46:1 a 16,55:1. Isto é uma verificação dos pares selecionados, não certificação completa de acessibilidade.

A fixture visual não executou `dashboard.js` completo nem consultou dados WMGJ. As imagens são prévias de design, não comprovação de operação ou saldo.

## Critérios para publicação privada

1. Aprovar a composição visual em computador e celular.
2. Executar a suíte integral e a integração autenticada do ambiente.
3. Verificar acesso anônimo em todos os domínios e rotas, inclusive assets e parâmetros de demonstração; nenhum bypass é permitido.
4. Confirmar entrega dos arquivos CSS/JS atrás da estratégia de acesso aprovada, sem expor aplicação pública.
5. Validar carregamento real, atualização, dados parciais, ausência, expiração e logout.
6. Publicar com rollback disponível, sem ampliar permissões ou alterar dados financeiros.

Rollback: reverter os commits desta revisão ou o commit de merge; nenhuma migração de banco é necessária.
