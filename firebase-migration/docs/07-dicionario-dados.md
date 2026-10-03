# Dicionário mínimo canônico

Todo documento operacional deve conter:

| Campo | Tipo | Regra |
|---|---|---|
| `orgId` | string | isolamento obrigatório |
| `schemaVersion` | number | inicia em 1 |
| `entityType` | string | lista branca no backend |
| `entityKey` | string | chave natural antes do hash |
| `source` | map | sistema, ID, URL, hash e método |
| `workflowState` | enum | estado único |
| `reviewState` | enum | revisão separada |
| `riskLevel` | enum | LOW/MEDIUM/HIGH/CRITICAL |
| `sensitivity` | enum | classificação de acesso |
| `competence` | YYYY-MM | quando aplicável |
| `createdAt` | timestamp | servidor |
| `updatedAt` | timestamp | servidor |
| `migration` | map | evento, idempotência e origem |

## IA

Cada `aiRuns/{runId}` deve guardar:

- provedor e modelo;
- versão do prompt;
- versão das regras e schema;
- hash de entrada;
- campos extraídos;
- confiança e limitações;
- referências de evidência;
- estado de revisão;
- revisor, decisão e data;
- hash da saída.

Nunca registrar “Gemini” ou “GPT” como origem quando foi usado fallback local.

## Fechamento mensal

`monthlyClosings/{YYYY-MM}` é snapshot imutável após aprovação e contém:

- competências separadas;
- receita prevista, emitida, recebida e aberta;
- despesas, tributos, repasses e glosas;
- divergências e evidências;
- aprovações exigidas;
- hashes das regras, dados e relatório;
- status `OPEN`, `BLOCKED`, `PENDING_APPROVAL` ou `CLOSED`.

### Relatório financeiro aos sócios

A habilidade `AURORA-FIN-SOC-001` deriva somente de um fechamento mensal canônico. O snapshot `monthlyClosings/{YYYY-MM}` deve expor `financialCents` com centavos inteiros ou `null` quando não houver evidência suficiente: `forecastCents`, `billableCents`, `billedCents`, `receivableCents`, `receivedCents`, `recoverableCents`, `glossCents`, `expensesCents`, `taxesCents`, `transfersCents`, `closingResultCents`, `cashBalanceCents` e `distributableCents`.

`exceptionSummary.openCount` e `exceptionSummary.openAmountCents` representam somente exemplares canônicos não sobrepostos.

Quando o fechamento transita para `CLOSED`, o motor cria `shareholderReportVersions/{reportId}` como versão imutável e atualiza `shareholderReports/{YYYY-MM}` como ponteiro canônico. A geração não autoriza distribuição, pagamento, aceite de glosa, cobrança externa, baixa de recebível ou mutação de documento-fonte.
