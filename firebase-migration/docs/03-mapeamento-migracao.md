# Mapeamento da base-mestre para Firestore

| Fonte atual | Destino canônico | Observação |
|---|---|---|
| `01_CADASTRO_ARQUIVOS` | `sourceDocuments` | Índice e vínculo ao Drive |
| `02_PRODUTIVIDADE_MENSAL` | `productivityRecords` | Manter competência assistencial |
| `03_PRODUTIVIDADE_MEDICO` | `productivityRecords` | Chave por competência/profissional/unidade |
| `04_CENTRO_CUSTOS` | `financialEntries` | Classificar centro de custo |
| `05_FINANCEIRO_MENSAL` | `periods` + `financialEntries` | Separar previsto, emitido, recebido e aberto |
| `06_NFS_E` | `invoices` | Preservar substituição, chave e versão |
| `07_ESCALA` | `shifts` | Períodos, unidade, responsável e evidência |
| `07_IMPOSTOS` | `taxObligations` | Competência, vencimento, valor, situação |
| `08_EXTRATOS_BRADESCO` | `bankTransactions` | Deduplicar por conta/data/valor/histórico/hash |
| `08_CONTRATOS_E_ATAS` | `contracts` | Vigência, partes, obrigações, evidência |
| `13_CONTROLE_PIPELINE` | `runtimeCheckpoints` | Uma entidade por componente |
| `14_MEMORIA_BASE_DOCUMENTOS` | `sourceDocuments/versions` | Extração e classificação versionadas |
| `15_FILA_PROCESSAMENTO` | `workflowRuns`/`deadLetters` | Estado único e tentativa estruturada |
| `21_GMAIL_INDEXACAO_FATURAMENTO` | `sourceDocuments` + `integrationEvents` | Não copiar campos desalinhados sem reconciliação |
| `23_CONTROLE_CICLOS_AUTOMATICOS` | `workflowRuns` | Uma execução por `runId` |
| `24_AUTOMACAO_GATILHOS` | `runtimeCheckpoints` | Estado desejado e observado separados |
| `25_TRAVA_WATCHDOG` | `runtimeLocks` | Lease e heartbeat no servidor |
| `42_CHECKPOINT_OPERACIONAL` | `runtimeCheckpoints` | Evidência, bloqueio e próxima ação |

## Normalização financeira do piloto

O backfill mantém o valor exibido na Sheet para proveniência e cria centavos inteiros somente por allowlist explícita:

| Aba | Campo canônico | Cabeçalhos aceitos no piloto |
|---|---|---|
| `06_NFS_E` | `totalCents` | `valor_total`, `valor_nf`, `valor_nota`, `valor_nfs_e`, `valor_nfse`, `valor` |
| `08_EXTRATOS_BRADESCO` | `amountCents` | `valor`, `valor_lancamento`, `valor_transacao` |
| `08_EXTRATOS_BRADESCO` | `liquidatedAmountCents` | `valor_liquidado`, `valor_conciliado` |

Formato monetário ausente permanece ausente. Formato ambíguo, fração de centavo, overflow ou conflito entre dois cabeçalhos interrompe a linha e impede avanço do checkpoint. `05_FINANCEIRO_MENSAL` permanece evidência resumida e não é somado aos lançamentos detalhados, evitando dupla contagem. Os cabeçalhos reais devem ser conferidos no `DRY_RUN` antes do primeiro envio.

## Estados canônicos

```text
RECEIVED → QUEUED → CLASSIFIED → EXTRACTED → NORMALIZED
→ PENDING_EVIDENCE / PENDING_HUMAN_REVIEW / BLOCKED
→ VALIDATED → CLOSED

Falhas: FAILED → DEAD_LETTER → reprocessamento explícito
```

`documentType`, `riskLevel`, `reviewState`, `sourceSystem` e `tags` são dimensões separadas; não viram estados concorrentes.
