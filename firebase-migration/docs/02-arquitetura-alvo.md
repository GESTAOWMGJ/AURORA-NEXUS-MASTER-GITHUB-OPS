# Arquitetura-alvo multi-hospital

## Tenant e isolamento

```text
organizations/{orgId}
  members/{uid}
  facilities/{facilityId}
  sourceDocuments/{documentId}
    versions/{versionId}
    events/{eventId}
  integrationEvents/{idempotencyHash}
  auditEvents/{eventId}
  workflowRuns/{runId}
  runtimeLocks/{lockId}
  runtimeCheckpoints/{componentId}
  deadLetters/{itemId}
  aiRuns/{runId}
  actionItems/{actionId}
  approvals/{approvalId}
  periods/{YYYY-MM}
  ...domínios financeiros e hospitalares
```

A WMGJ usa `orgId=wmgj`. Cada novo hospital recebe organização e unidades próprias, sem compartilhar documentos, permissões ou chaves naturais.

## Camadas

1. **Fonte/evidência:** Gmail, Drive e documentos originais.
2. **Adaptadores:** Apps Script no período de transição; posteriormente Cloud Run/Functions com APIs Google.
3. **Ingestão:** HTTPS assinada, validação, idempotência e auditoria.
4. **Firestore:** projeções atuais + eventos imutáveis.
5. **Regras:** Auth, papéis, isolamento por organização e campos controlados.
6. **Aplicação:** React/TypeScript ou portal futuro sem dependência direta de abas.
7. **IA:** execução registrada com modelo, prompt, regra, hash de entrada, saída e decisão humana.

## Módulos permanentes

### Operação WMGJ

- documentos e versões;
- produtividade, escala e profissionais;
- NFS-e, extratos, impostos e financeiro;
- contratos, conciliações e fechamento;
- runtime, alertas, pendências e relatórios.

### Gestão hospitalar replicável

- contratos/POA/CNES/habilitações;
- contas hospitalares, autorizações e itens faturados;
- SIA/SIH/AIH/BPA/APAC/FAEC;
- glosas, recursos e recuperação;
- OPME, materiais, medicamentos, diárias e taxas;
- indicadores assistenciais, qualidade e NPS;
- riscos, achados, decisões, evidências e planos de ação.

## Arquivo binário

No primeiro ciclo, PDFs/XML/XLS permanecem no Drive. O Firestore armazena metadados, hash, URL autorizada, status, extração e vínculos. Migração para Cloud Storage é decisão posterior e separada.
