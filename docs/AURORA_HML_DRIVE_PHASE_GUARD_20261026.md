# AURORA-HML-DRIVE-PHASE-GATE-001 — Gate de fase, fila e contenção

**Revisão técnica:** a avaliação original foi complementada pela [auditoria AURORA-DRIVE-STATUS-002](AURORA_PR342_AUDIT_20261026.md). O critério original baseado em varredura era insuficiente; o contrato v2 não atesta extração sem READBACK.

**Data:** 26/10/2026
**Módulo:** Drive documental WMGJ / Apps Script canônico
**Ambiente:** HML `wmgj-hml-jfn-20260927`; sem produção
**Baseline Git:** `8264dccededd498299d0565414e6b5ebd1aaffd6`
**Escopo:** a mesma fonte privada previamente autorizada. O hash de escopo é tratado como condição de igualdade, não como dado de origem.

## Evidências operacionais anteriores ao patch

1. O READBACK histórico `40194120781` comprovou 255 registros (51 canônicos, 192 aliases, 12 pendências). As 12 exclusões do piloto documental são declaradas, não removidas. [Investigação #327](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/pull/327).
2. O workflow `40274154147` remediou metadados de 282 linhas e retornou 282 pendências humanas justificadas, 0 pendências injustificadas segundo o contrato vigente. Isso **não representa 282 documentos recuperados**.
3. O workflow `40276554643` habilitou `LIVE_ENUMERATION` antes de resolver um achado de revisão sobre cabeçalhos de fila. Não há prova suficiente de sincronização integral.
4. A ação protegida `ACTIVATE` no [run 40277310678](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/40277310678) retornou `REMEDIATE_ONLY`, 1 trigger, 0 duplicados e primeiro ciclo sob `AURORA_CONTINUOUS_DRIVE_REMEDIATION_GATE`, sem nova enumeração nessa chamada.

## Correções candidatas

- Promoção: se `ID_ORIGEM`, `STATUS`, `TENTATIVAS` ou `OBSERVACAO` estiver ausente ou inválido, retornar `AURORA_DRIVE_QUEUE_CONTRACT` antes de avaliar pending/justified. Cabeçalho ausente jamais significa fila vazia.
- Contenção: `ACTIVATE` retorna explicitamente `phase=REMEDIATE_ONLY` e `continuousExtraction=false` e valida o retorno do primeiro ciclo antes de atestar êxito; instalar trigger não equivale a extrair.
- Ciclo: a fase `LIVE_ENUMERATION` é novamente verificada **depois de obter a trava compartilhada** e antes de cada requisição. Uma fase antiga/cacheada não autoriza continuação após rollback/pausa.
- Estado: `liveEnumerationEnabled` distingue permissão de enumeração do mero registro de trigger; no contrato original, `continuousExtractionVerified` dependia de um ciclo pós-habilitação com varredura. A auditoria reproduziu falso positivo; STATUS v2 mantém esse indicador falso sem READBACK canônico e usa `recentCycleVerified`/`enumerationObserved` para execução e varredura.
- O GitHub Actions protegido exige o contrato de `ACTIVATE` em contenção, sem chamar coleta real na fase pausada.

## Critérios de segurança

- Zero mudança de projeto, tenant, escopo Drive, enrollment, origem, IAM, OAuth, credenciais, autorização de produção ou rotina Gmail/dashboard.
- Reutilizar exatamente o trigger já configurado; não criar motor, agente ou segunda via de coleta.
- Apenas testes sintéticos para o patch. Ingestão e promoção real exigem novo READBACK e os gates HML no SHA canônico, além de revisão.
- Não transformar `scopedQueueRemediated` ou casos `REVISAR_HUMANO` em `fullSynchronizationVerified`.
- Preservar o resultado documental utilizável com exclusões e cobertura por indicador, sem inferir fatos financeiros.
- **Rollback de código:** reverter exclusivamente o commit de correção após validação do SHA; não descartar recibos nem reativar enumeração por rollback. Manter `REMEDIATE_ONLY` até prova em execução protegida.
- **Rollback de fase:** usar apenas mecanismo protegido de configuração autorizado; verificar retorno e trigger único. Não manipular propriedades privadas por agente local.

## Aceite de desenvolvimento

Testes dirigidos por Node em Windows Xeon: `test-aurora-drive-ingest-run.cjs`, `test-drive-full-ingest.js`, `test-drive-activation.js`; 113 aprovados/0 falhas, incluindo 6 novos de regressão. A validação CI e a publicação HML são etapas distintas ainda não comprovadas por este documento.

## Próximo gate

Após revisão do PR/CI, publicar o Apps Script canônico no HML, verificar código publicado, executar STATUS protegido, revalidar fila e recibos. Somente promover `LIVE_ENUMERATION` com zero pendências injustificadas, cabeçalhos válidos e prova posterior de leitura, sem ampliar as fontes.
