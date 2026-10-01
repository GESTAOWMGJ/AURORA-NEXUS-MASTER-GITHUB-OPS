# FastAPI + OpenAI — camada de domínio de homologação

## Decisão

A Cloud Function permanece como único writer do espelho legado na Fase 1. O FastAPI nasce como BFF para:

- ler projeções agregadas e sanitizadas;
- autenticar Firebase ID Tokens, validar App Check e confirmar membership ativa;
- iniciar rascunhos de IA com idempotência;
- registrar saída, hashes e metadados da execução;
- receber decisão humana com revisão otimista;
- servir o dashboard sem expor coleções brutas.

O FastAPI não oferece rota de ingestão legada. Assim, não existem dois writers concorrentes para a mesma projeção.

```text
Apps Script → Cloud Function HMAC → organizations/{orgId}/...

Usuário → Firebase Auth → FastAPI
                         ├─ dashboardSnapshots (leitura)
                         ├─ OpenAI Responses API
                         ├─ aiRuns (servidor)
                         ├─ approvals (servidor)
                         └─ auditEvents (servidor)
```

## Endpoints

| Endpoint | Finalidade |
|---|---|
| `GET /health/live` | confirma somente que o processo responde |
| `GET /health/ready` | confirma configuração e acesso ao Firestore |
| `GET /v1/organizations/{orgId}/dashboards/operational` | lê snapshot agregado por competência |
| `POST /v1/organizations/{orgId}/ai-runs` | reserva chave idempotente, executa rascunho e registra auditoria |
| `GET /v1/organizations/{orgId}/ai-runs/{runId}` | consulta execução |
| `POST /v1/organizations/{orgId}/ai-runs/{runId}/reviews` | decisão humana com `expectedRevision` |

## Contrato OpenAI

- Responses API;
- Structured Outputs derivados de Pydantic com `extra="forbid"`;
- `store=false` em toda chamada;
- sem ferramentas, web search, upload, file search, MCP ou execução de código;
- fatos não confiáveis entram como input de usuário, nunca como instruções do sistema;
- toda referência produzida precisa existir no conjunto de `evidenceRefs` de entrada;
- `needsHumanReview=true` é obrigatório;
- `abstained=true` impede achados;
- identificadores diretos comuns são bloqueados antes da chamada e novamente na saída;
- `CLINICAL_SENSITIVE` permanece bloqueado por padrão;
- `safety_identifier` recebe somente hash de `orgId:UID`.

Structured Outputs garante aderência ao schema, não veracidade. A aplicação valida grounding, recusa/incompletude, revisão humana e regras determinísticas após a resposta. Referências oficiais: https://developers.openai.com/api/docs/guides/structured-outputs e https://developers.openai.com/api/docs/guides/safety-best-practices.

## Trilha mínima de `aiRuns`

```text
provider, model, promptVersion, rulesetVersion, schemaVersion,
inputHash, outputHash, responseId, requestId, latencyMs, usage,
sensitivity, evidenceRefs, status, reviewState, reviewerUid,
createdAt, completedAt, reviewedAt, revision
```

Prompt clínico bruto, raciocínio interno, token, chave e texto integral de evidência não entram em `auditEvents`.
