# AURORA-FIN-SOC-001 — Relatório Financeiro aos Sócios

## Objetivo

Instituir como habilidade nativa do AURORA NEXUS o relatório financeiro societário mensal, derivado do fechamento canônico e disponibilizado na plataforma em formato institucional imprimível/PDF.

A habilidade não cria um fechamento paralelo. A fonte de verdade continua sendo `monthlyClosings/{YYYY-MM}`, cujo snapshot é imutável após aprovação.

## Gatilho

A rotina é event-driven: quando o fechamento mensal canônico transita para `CLOSED`, o AURORA cria uma versão imutável do relatório societário e atualiza o ponteiro canônico da competência.

A política operacional esperada é executar o fechamento no último dia útil aplicável. Se o fechamento ocorrer depois, o relatório segue o fechamento efetivo; a habilidade não inventa calendário de feriados nem antecipa um fechamento ainda não aprovado.

## Regras de segurança financeira

- ausência de evidência nunca é convertida em zero;
- faturamento nunca é tratado como recebimento;
- glosa informada nunca é glosa aceita;
- exceções potencialmente sobrepostas nunca são somadas automaticamente;
- o relatório não aceita glosa, não baixa recebível e não executa cobrança externa;
- o relatório não executa pagamento, não altera documento-fonte e não autoriza distribuição;
- distribuição permanece dependente do gate societário e de decisão humana expressa;
- o relatório usa apenas dados agregados e sanitizados, sem identificadores de pacientes.

## Snapshot financeiro canônico

`monthlyClosings/{YYYY-MM}.financialCents` deve utilizar centavos inteiros e `null` quando o valor não estiver comprovado:

| Campo | Significado |
|---|---|
| `forecastCents` | receita prevista |
| `billableCents` | produção elegível/faturável |
| `billedCents` | receita faturada |
| `receivableCents` | recebível comprovado |
| `receivedCents` | crédito bancário conciliado |
| `recoverableCents` | receita recuperável sustentada |
| `glossCents` | glosas/divergências informadas, sem presunção de aceite |
| `expensesCents` | despesas comprovadas |
| `taxesCents` | tributos comprovados |
| `transfersCents` | repasses comprovados |
| `closingResultCents` | resultado apurado no fechamento |

`exceptionSummary.openCount` e `exceptionSummary.openAmountCents` devem representar somente exemplares canônicos não sobrepostos.

## Estados do relatório

- `BLOCKED_CLOSING`: fechamento ainda não está `CLOSED`;
- `REQUIRES_HUMAN_APPROVAL_EVIDENCE`: fechamento fechado, mas a evidência de aprovação humana não está materializada no snapshot;
- `READY_FOR_PDF`: fechamento fechado e aprovação humana presente.

`READY_FOR_PDF` significa apenas que o documento institucional pode ser produzido. Não significa autorização de distribuição financeira.

## Persistência

- `shareholderReportVersions/{reportId}`: versão imutável por hash do fechamento;
- `shareholderReports/{YYYY-MM}`: ponteiro canônico atual, com referência à versão anterior quando houver;
- `auditEvents`: registro `SHAREHOLDER_REPORT_DRAFTED`, sem mutação da fonte.

Conflitos de versão preservam o histórico; a versão anterior não é apagada.

## Plataforma

Rota privada: `/reports/shareholders?competence=YYYY-MM`.

Acesso restrito a `platform_admin`, `org_admin`, `director` ou permissão explícita `shareholder.report.read`, sempre com escopo organizacional amplo.

A página possui layout institucional A4 e comando local de impressão/exportação PDF. Nenhum envio aos sócios é automático.

## Conteúdo mínimo mensal

1. organização e competência;
2. estado do fechamento;
3. síntese prevista → faturável → faturada → recebível → recebida;
4. receita recuperável;
5. glosas/divergências;
6. despesas, tributos e repasses;
7. resultado de fechamento;
8. exceções abertas e seu valor somente quando sustentado;
9. completude do snapshot;
10. evidência de aprovação humana;
11. gate societário e vedação de distribuição automática.

## Integração com AURORA-REV-SAN-001

Pontas soltas continuam no motor de saneamento até `ENCERRADO_COM_EVIDÊNCIA`. O relatório societário apenas consolida o estado canônico do fechamento e não transforma pendência em resolução.

## Critérios de aceite

- testes comprovam `null != 0`;
- nenhuma informação sensível de paciente é propagada para o relatório;
- a transição para `CLOSED` cria versão imutável e idempotente;
- a rota privada está antes do catch-all do Hosting;
- nenhum código de envio, pagamento ou distribuição automática é introduzido;
- build TypeScript e suíte de Functions devem ficar verdes no SHA final antes de qualquer merge/deploy.
