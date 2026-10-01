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
