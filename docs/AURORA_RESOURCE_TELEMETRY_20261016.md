# AURORA-RESOURCE-OPT-001 — adaptador de snapshots de consumo

Data: 16/10/2026. Incremento subordinado ao PR #275 e à rotina existente
`AURORA-DAILY-UPDATES-001`. Baseline: `f7dfffbac242a30ee70a13cb473760956dee4f84`;
main de origem: `967d32a493b9930d77cac1030642c6fca28bb1f3`.

**Estado: SNAPSHOT_ADAPTER_IMPLEMENTED_RUNTIME_NOT_WIRED.**
O adaptador conecta dados serializados de `aiRuns` ao avaliador existente em memória.
Não busca registros reais, verifica sessão/membership, atesta bindings, persiste
agregados, registra auditoria ou habilita monitoramento. Nenhum runtime chama o novo
módulo neste incremento. A representação nativa `PURE_EVALUATOR_IMPLEMENTED_NOT_WIRED`
permanece sem promoção. Código/teste sintético não demonstram telemetria operacional.

## Fontes inspecionadas na baseline

| Fonte | Dados existentes | Uso e limite |
| --- | --- | --- |
| `firebase-migration/api/wmgj_api/openai_service.py` | `response.usage`, `response.id`, `_request_id`, latência e status | Resposta terminal observada; não retém modelo servido, tier, conta ou cada tentativa interna. Exceções posteriores à resposta podem perder o consumo. |
| `firebase-migration/api/wmgj_api/repositories.py` | `organizations/{orgId}/aiRuns/{runId}`, `usage`, IDs, revisão e timestamps | Fonte persistida preferida; transações, idempotência e auditoria já existem. Exige leitura autorizada e binding histórico da conta/ambiente. |
| `firebase-migration/api/wmgj_api/app.py` e `models.py` | GET com permissão `AI_RUN_READ`; POST com reserva idempotente; modelo configurado | O POST pode retornar `usage` vazio e `completedAt` ausente apesar da gravação. Usar readback persistido, não preencher ausências com zero. |
| `desktop/ia-master/server.cjs` | Retorno local com `outputTokens` de `eval_count`, modelo configurado e duração | O retorno inspecionado não fornece entrada/cache/identidade suficientes. Não incluído; custo local não é zero por inferência. |
| GitHub Actions / workflows | Identidade do run, SHA, tentativa, status e conclusão | Evidência de execução/CI, não contadores de requisições do provedor nem documento de cobrança. Não conectado ao consumo. |
| Preflight GCP e contratos | Estado `billingEnabled` e políticas | Não comprovam despesa. Nenhuma fatura/extrato ou tarifa efetiva foi conciliada neste incremento. |

Buscas por `usage`, `input_tokens`, `prompt_tokens`, `eval_count`, `billing` e
`token_count` orientaram a inspeção; não constituem inventário de toda a conta ou
prova de inexistência de outras fontes. Fixtures do repositório são sintéticas.

## Contrato e normalização implementados

`firebase-migration/functions/src/auroraAiRunUsage.ts` exporta
`reconcileStoredAiRunUsage(snapshots, scope)` e usa `reconcileResourceUsage` sem
alterar o avaliador original (blob Git `80d8f5d56aac232a62116d36b1c0bd80deea685d`).

O lote recebe escopo HML explícito, projeto/banco/organização, caminho canônico e
snapshot serializado. A referência opaca da conta é vinculada ao run/request/response
originais por um binding com referência de evidência. A presença dessa referência
NÃO verifica documento, autorização, titularidade ou segregação física do ambiente.
O chamador existente deverá verificar tudo isso antes de fornecer registros.

Mapeamento: `input_tokens` → entrada; `input_tokens_details.cached_tokens` → parcela
de cache da entrada; `output_tokens` → saída; `total_tokens` deve igualar entrada +
saída. Reasoning, quando informado, deve caber na saída e não é somado novamente.
Cache ausente não vira zero. Cache-write positivo ou campos não suportados bloqueiam
o lote até contrato específico; zero explícito é aceito. O parser não normaliza
contadores cumulativos nem certifica origem pelo formato dos números.

`requestId` original também discrimina `attemptId`; não é ordinal nem afirma que
houve uma única tentativa. `model` é somente o rótulo solicitado/configurado do
registro, não o modelo servido. Tier e modalidade ficam `UNKNOWN`. Custos efetivo e
estimado ficam `null`; nenhum preço, crédito, assinatura ou economia é inferido.

Exportações repetidas deduplicam pela identidade original. Revisões de revisão humana
não criam consumo. Requisições diferentes com contadores iguais continuam contadas.
Conflitos request/response/conta/caminho ou contadores divergentes bloqueiam o lote.
Uma linha inválida impede total parcial enganoso; os motivos são códigos fixos sem
conteúdo privado. Lote vazio retorna `NO_SOURCE`, não consumo zero. Limite: 1.000
snapshots, em memória. A saída é avaliação do lote, NÃO incremento somável entre
páginas sobrepostas; deduplicação persistente ainda não está implementada.

## Reutilização e pendências de integração

Usar a leitura existente com sessão, membership atual, escopo e sensibilidade; não
criar endpoint, executor, conta técnica ou coleção paralela. Preservar a reserva
`apiIdempotency` e o readback de `aiRuns`. Falha ao ler/reconciliar não deve reexecutar
a requisição do provedor. Replay deste adaptador apenas recalcula o snapshot.

A conclusão atual grava `usage` e `completedAt` sobre `payload`, mas calcula
`afterHash` somente de `payload`. Portanto, o hash não cobre necessariamente esses
valores gravados. Não corrigir hashes históricos retroativamente. Uma correção
subsequente deve auditar exatamente o payload persistido e testar repetição da
conclusão, concorrência, confirmação perdida e preservação do estado terminal.

Ainda faltam prova do binding histórico da conta/ambiente, modelo/tier efetivamente
servidos, cobertura de retries e erros pós-resposta, serialização de timestamps,
normalização temporal de fontes cumulativas e documentos de cobrança. Não há prova
de existência/quantidade de `aiRuns` operacionais pela inspeção de código.

## Validação executada e gates

44 testes sintéticos novos: PASS; zero falhas/skips. TypeScript 5.8.3 estrito com
`noUncheckedIndexedAccess`: PASS, nos dois módulos isolados. Node 22.16.0.
Execução leve em sandbox, não no Xeon. O avaliador usado no teste tem o mesmo blob
Git da baseline. O harness transpila os dois módulos e altera somente o caminho de
importação do teste para o JavaScript emitido. Não houve instalação de dependências.
A suíte integral do repositório e os 31 testes anteriores NÃO foram reexecutados;
não somar 31 + 44 como evidência de uma execução conjunta.

Comando previsto no workspace autorizado, com o `tsx` já existente:

```sh
cd firebase-migration/functions
node --import tsx --test test/aurora-resource-optimization.test.ts test/aurora-ai-run-usage.test.ts
npm run lint
```

O Xeon foi identificado online, mas uma inspeção remota foi bloqueada por segurança.
Não houve contorno, teste no Xeon ou carga no Mac. Processamento pesado continua
reservado ao Windows Xeon. Nenhum scheduler ou workflow foi criado/cancelado.

Antes de integração produtiva: verificar o SHA final e a main corrente; CI aplicável;
revisão independente por pessoa diferente do autor no SHA final; validação no Xeon;
HML com identidade real, isolamento negativo, bindings verificáveis, replay, falhas,
concorrência, readback e rollback. Manter PR draft e sem auto-merge. A CI anterior não
valida este incremento. Nenhuma dessas etapas é satisfeita por fixtures ou flags.

Rollback: reverter somente o commit do adaptador antes de promoção. Não houve deploy,
mutação de dados, migração, mudança de checkpoint, cancelamento ou instalação a desfazer.
Preservar o histórico, as autorizações humanas e as pendências técnicas.
