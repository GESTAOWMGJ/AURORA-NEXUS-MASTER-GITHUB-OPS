# Auditoria runtime da operação atual

## Controles que devem ser preservados

- deduplicação e idempotência;
- fila separada da memória-base;
- erro individual sem derrubar o lote;
- tentativas e reprocessamento explícito;
- lock, heartbeat e watchdog;
- fallback de IA identificado como fallback;
- chaves fora do código e dos logs;
- decisão humana para fechamento e impacto relevante;
- checkpoint que não declara deploy sem evidência.

## Achados prioritários

### P0 — segurança e integridade

1. **Endpoint legado:** token estático no payload. A fundação Firestore agora usa HMAC v2 sobre body e escopo, `keyId` rotacionável, timestamp, nonce transacional e segredo fora do código; o endpoint legado ainda deve ser aposentado somente após homologação.
2. **Hash atual:** usa ID, nome, tamanho e data. Acrescentar hash do conteúdo; manter fallback somente quando o blob não puder ser lido.
3. **Deploy:** o workflow de deploy executa rotinas operacionais, atualiza dashboard, roda ciclos Gmail e instala gatilhos. Separar `deploy-code`, `validate-readonly` e `operate-production`.
4. **Fonte do código:** definir `src/` como árvore única; arquivar `apps-script/` e `appsscript/` após comparação.

### P1 — qualidade do dado

1. Unificar esquema de logs.
2. Transformar JSON de célula em documentos tipados.
3. Separar estado, tipo, risco e revisão.
4. Corrigir cabeçalhos duplicados no índice Gmail antes do backfill.
5. Preservar cadeia de substituição de NFS-e.
6. Manter competências assistencial, fiscal, caixa e contábil distintas.

### P2 — observabilidade

- `workflowRuns` por execução;
- `runtimeLocks` com lease;
- `runtimeCheckpoints` por componente;
- `deadLetters` para falhas definitivas;
- métricas de aceitos, duplicados, erros, revisão humana e latência;
- auditoria imutável com hash antes/depois.

## Condição operacional

Não há evidência de um projeto Firebase vinculado ou de credenciais disponíveis nesta sessão. Portanto, o resultado correto é uma integração preparada, versionada e testável — não uma alegação falsa de migração em produção.
