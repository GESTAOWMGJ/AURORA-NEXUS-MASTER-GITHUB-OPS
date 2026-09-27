# Aurora Nexus — Refinamento visual V2

Data: 26/09/2026. Continuação da proposta visual do PR #31.
Estado: código de apresentação atualizado em branch de revisão; sem merge ou deploy.

## Direção visual

A primeira leitura é financeira: faturamento dominante, recebimentos, valores a receber e diferença de conciliação. O cabeçalho foi reduzido e os filtros recolhidos. A navegação usa barra lateral no computador e barra inferior em celulares estreitos. O modo foco recolhe a navegação no desktop, sem alterar autorização ou dados.

Base grafite/navy #090e17; superfícies #111a27; faturamento e ação principal #32d2fa; recebimentos #40efa5; pendências #ffcb62; alerta crítico #ff6b82; marca secundária #b7a9ff. A intensidade identifica significado, não substitui texto ou evidência. Estados não aferidos permanecem neutros.

## Componentes alterados

- `firebase-migration/api/wmgj_api/static/dashboard.html`: composição, navegação, controles compactos, cartões financeiros, comparação e central de alertas.
- `firebase-migration/api/wmgj_api/static/aurora-visual.css`: identidade, estados semânticos, responsividade, foco, movimento reduzido, cores forçadas e impressão.
- `firebase-migration/api/wmgj_api/static/aurora-visual.js`: apresentação dos sinais já renderizados, comparação, modo foco e filtros. Não solicita dados, não escreve cookies ou armazenamento e não desoculta o dashboard.
- `firebase-migration/functions/src/auroraAuthGate.ts`: apresentação do login e do shell privado. A lógica de autorização e sessão permanece igual à revisão anterior.

O controlador `dashboard.js` e o contrato de snapshot não foram modificados.

## Semântica financeira

Faturado não é recebido; recebido não é lucro; diferença de conciliação não é prejuízo. O contrato atual não oferece lucro líquido: o componente permanece como **Não aferido**, sem cálculo fictício.

O comparativo é um gráfico de barras independente, com base zero e escala comum, derivado dos três valores BRL já exibidos. Não é série temporal, tendência ou soma de etapas. Valor ausente, negativo ou em moeda não comparável não é convertido em barra positiva ou zero apurado. Dados negativos recebem sinal de conferência, não uma conclusão contábil local.

Alertas respeitam a severidade fornecida pelo controlador. O contador permanece desconhecido com o painel bloqueado. Zero achados críticos não mantém aparência crítica; dados ausentes não aparecem como sucesso.

## Verificações locais executadas

- Layout em 12 larguras: 320, 375, 390, 430, 540, 768, 950, 1024, 1280, 1440, 1600 e 1920 px, sem overflow detectado na fixture.
- Login em 320, 390, 768 e 1440 px, sem dashboard ou valores financeiros na página de login.
- IDs do controlador preservados; IDs únicos; painel e aviso de demonstração ocultos por padrão.
- Filtros, foco de teclado, modo foco e recuperação ao mudar para viewport móvel.
- Barras proporcionais aos valores da fixture; ausência distinta de zero; valores negativos não tratados como barras positivas; reset de alertas e contagens.
- Movimento reduzido, estilos de impressão e ausência de erros de execução do script visual no navegador local.
- 11 pares centrais de contraste entre 6,65:1 e 16,26:1. Não é certificação integral de acessibilidade.
- Transpilação sintática TypeScript e regressão do Auth Gate com Firebase simulado: login anônimo, sessão autorizada, sessão revogada, usuário não autorizado, métodos, flags de cookie e logout.
- Comparação textual: cabeçalhos de segurança, handlers de sessão/autorização e JavaScript de login idênticos à revisão visual anterior.

## Limites da evidência

As prévias e o ensaio visual usam dados integralmente fictícios, não valores da WMGJ. A fixture não executa o `dashboard.js` completo; autenticação foi ensaiada com mocks, não na nuvem. A transpilação não equivale ao build integral do projeto. Os registros de testes e prévias acompanham o pacote de revisão entregue separadamente.

## Condições antes de produção

O shell autenticado atual ainda não entrega automaticamente o dashboard FastAPI. Validar essa integração privada e o controlador integral em homologação, inclusive expiração/revogação de sessão, indisponibilidade de fontes, isolamento de organização e todos os caminhos de acesso. Toda rota pública deve manter login obrigatório; não publicar fixtures, arquivos de ensaio ou demonstração pública.

Esta revisão não altera DNS, permissões, regras Firestore, dados financeiros, credenciais ou integrações externas. Não executa operações financeiras e não efetua merge ou publicação.
