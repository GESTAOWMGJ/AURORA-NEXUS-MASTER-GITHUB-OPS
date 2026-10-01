# Hardening integrado — gate de homologação

## Resultado desta otimização

A fundação permanece sem deploy e com produção inalterada. O hardening cobre quatro superfícies independentes:

| Superfície | Controle incorporado |
|---|---|
| Ingestão | HMAC v2 rotacionável, nonce, escopo por organização/tipo, idempotência semântica e `sourceVersion` monotônico |
| Firestore | acesso fail-closed por unidade, domínios separados, snapshots sanitizados e coleções servidor-only |
| FastAPI/OpenAI | ID Token revogável, App Check, MFA, Structured Outputs, grounding, revisão otimista e `store=false` |
| Dashboard | somente leitura, sem persistência local, estados de transporte/frescor/completude/severidade separados |

PixVerse permanece fora do runtime e sem geração; existe somente um brief sintético para comunicação futura.

## Invariantes

1. A Cloud Function é o único writer do espelho legado na Fase 1.
2. `eventId` e `occurredAt` identificam a tentativa e não alteram a identidade semântica da operação.
3. Mesma chave idempotente e mesma operação retorna duplicata; mudança semântica retorna `409`.
4. O backfill legado usa `sourceVersion=1`; uma alteração posterior falha fechada até existir versionador durável.
5. Resposta HTTP 2xx só avança checkpoint quando confirma, de modo inequívoco, `accepted` ou `duplicate` e devolve IDs.
6. Cabeçalho clínico quarentena a aba antes da leitura das linhas.
7. Narrativa e nome do arquivo não entram no evento documental genérico; o ator do Apps Script é pseudonimizado.
8. Agregado sem `facilityId` exige `allFacilities=true`.
9. IA nunca aprova, fecha ou produz decisão clínica; toda saída continua pendente de revisão humana.

## Validações locais concluídas

- FastAPI/Pydantic/segurança: 24 testes Python.
- Dataset de avaliação offline: 3 casos sintéticos válidos.
- Dashboard: 3 testes estáticos e `node --check`.
- Functions/Apps Script: 23 testes e build TypeScript estrito.
- JSON, shell, YAML e `git diff --check`: validação estática.

Os testes de Security Rules exigem Firebase Emulator Suite com Java 21+. O ambiente local possui Java 17; portanto, nenhum resultado de Rules é alegado localmente. O workflow `validate-firestore-migration.yml` instala Java 21 e executa os 17 cenários no GitHub sem comando de deploy.

## Gates ainda bloqueantes

- CI verde no commit exato do PR;
- projeto Firebase exclusivo de homologação;
- keyring HMAC e App Check provisionados fora do repositório;
- TTL de `requestNonces.expiresAt` habilitado;
- organização `wmgj`, memberships e `allFacilities` revisados;
- `wmgjFirestoreDiagnostico()` e dry run conferidos;
- versionador durável por linha antes de dual-write;
- avaliação OpenAI live somente com casos sintéticos, custo aprovado e configuração de retenção validada;
- aprovação humana antes de qualquer deploy, backfill ou mudança de leitura.
