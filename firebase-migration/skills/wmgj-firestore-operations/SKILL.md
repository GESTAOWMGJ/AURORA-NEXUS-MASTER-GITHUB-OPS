# WMGJ Firestore Operations Skill

## Missão

Evoluir a WMGJ de planilha operacional para sistema auditável, multi-hospital e orientado a eventos, sem perder evidência, continuidade ou decisão humana.

## Hierarquia das fontes

1. Documento original em Gmail/Drive.
2. Dado estruturado validado.
3. Evento e auditoria no Firestore.
4. Código oficial versionado no GitHub.
5. Execução comprovada do Apps Script/Functions.
6. Dashboard e relatório como síntese.

Em divergência, prevalece a evidência primária. Código não implantado não prova execução. Relatório não substitui a base.

## Fluxo obrigatório

```text
fonte → captura → hash → idempotência → fila → extração → classificação
→ validação → projeção canônica → conciliação → dashboard → relatório
→ revisão/decisão humana quando exigida
```

## Estados

Use somente:

`RECEIVED`, `QUEUED`, `CLASSIFIED`, `EXTRACTED`, `NORMALIZED`, `PENDING_EVIDENCE`, `PENDING_HUMAN_REVIEW`, `BLOCKED`, `VALIDATED`, `CLOSED`, `FAILED`, `DEAD_LETTER`.

Tipo documental, risco, origem, revisão e tags são campos separados.

## Ações permitidas à IA

- extrair e normalizar;
- classificar com confiança;
- comparar regras e documentos;
- detectar duplicidade e inconsistência;
- priorizar risco;
- explicar evidência;
- gerar minuta de relatório;
- propor plano de ação;
- criar teste/eval.

## Ações proibidas sem humano

- fechar competência;
- reconhecer resultado financeiro definitivo;
- aprovar pagamento ou distribuição;
- substituir documento-fonte;
- decidir pertinência médica/jurídica/regulatória final;
- apagar evidência ou histórico;
- alterar papel/permissão;
- declarar deploy ou migração concluídos sem prova.

## Registros obrigatórios para IA

`provider`, `model`, `promptVersion`, `ruleSetVersion`, `schemaVersion`, `inputHash`, `outputHash`, `confidence`, `evidenceRefs`, `reviewState`, `reviewer`, `decision` e timestamps.

## Runtime

- todo job tem `runId`;
- todo item tem idempotency key;
- lock é lease com expiração;
- heartbeat é persistido;
- erro individual não derruba lote;
- retry é limitado;
- falha definitiva vai para dead-letter;
- ação destrutiva exige confirmação e log.

## Migração

1. DRY RUN.
2. Backfill em lotes pequenos.
3. Reconciliação.
4. Dual write.
5. Dois fechamentos paralelos.
6. Cutover progressivo.
7. Arquivamento somente após aceite formal.

## Regra-mãe

**Nada fecha sem evidência. Nada distribui sem validação. Nada automatiza decisão crítica sem humano.**
