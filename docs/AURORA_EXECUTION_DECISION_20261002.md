# AURORA NEXUS — decisão de execução HML

Estado: **NO-GO**. AURORA NEXUS permanece o sistema-mãe; WMGJ Operação,
o piloto. Baseline remota verificada em 03/10/2026: `main`
`91665cc94c4bde9b82a75cd39905263c60e02191`.

## Fato novo e contenção

A `main` contém a request histórica v7 e originou o run `37093409122`, ainda
aguardando o ambiente `firebase-homologation`. Esse run não deve ser aprovado
nem reexecutado. O commit que o disparou alterou workflow, request e teste; por
isso o primeiro gate request-only deve falhar antes de qualquer mutação. Mesmo
assim, o snapshot v7 conserva rotação de keyring e janela global de escrita e
não deve ser usado como caminho operacional.

A request v7 permanece byte a byte inalterada. O próximo contrato possível é
v8, somente após os pré-requisitos abaixo. O run v6 `37092175109` continua
histórico: restore e cleanup passaram; Hosting/Rules/indexes foram publicados;
o gate HMAC falhou com exit 77; não houve amostra real, reconciliação, SHADOW ou
Native Intelligence.

## Ordem obrigatória

1. Revisar e integrar separadamente o PR #98, já reconciliado com a `main`.
2. Revisar o hardening v8 empilhado: nenhuma mudança em request; acesso da
   Execution API restrito ao implantador; DRY_RUN global sempre preservado;
   par exato vinculado a hashes/linhas/idempotência; autorização HMAC efêmera;
   receipt durável reivindicado como `IN_PROGRESS` antes do primeiro POST e
   consumido somente após os dois envios; runtime e deployment pinados.
3. Confirmar no deploy protegido que `CLASPRC_JSON` pertence ao implantador
   compatível com `executionApi.access=MYSELF`. Falha mantém NO-GO.
4. Publicar Apps Script e backend pelo fluxo próprio, em SHA revisado, sem usar
   RC1.1 para criar segredo, alterar IAM, configurar ponte ou publicar Function.
5. Executar a inspeção **somente leitura** do par candidato, revisar por humano
   as duas linhas e registrar o contrato fechado: parent hash, row/content hash,
   hashes de idempotência e `pairBindingSha256`.
6. Criar a request v8 em um commit request-only cujo primeiro pai seja exatamente
   o SHA implantado. O predecessor v7 precisa conservar SHA-256
   `42b2a0628b8b8debd3a1becc462724b69fa5762208d64c8852fb2e1e26369c10`.
7. Somente depois submeter o run a aprovação humana separada no ambiente
   protegido. O autor da request não deve autoaprovar nem usar bypass.

## Escopo permitido da futura v8

- restaurar backup elegível em banco temporário e comprovar cleanup;
- validar runtime já publicado e implantar apenas Hosting/Rules/indexes;
- consumir keyring canônico existente, sem Secret Manager mutation;
- validar deployment Apps Script e revisão de `ingestWmgjEvent` pinados;
- manter o DRY_RUN global em `true` durante toda a execução;
- enviar exatamente um par fiscal/bancário previamente atestado e consumir um
  receipt ligado ao SHA/request e ao binding do par;
- reconciliar documentos, habilitar somente projeção SHADOW e testar a
  inteligência nativa.

Os dois POSTs são idempotentes, porém **não atômicos**. Falha parcial deixa o
receipt bloqueado e exige nova request/revisão humana; não autoriza retry cego.
Backfill genérico, produção, dado clínico, mutação da fonte, segredo/IAM,
redeploy de Function e reconfiguração da ponte permanecem fora do escopo.

## Gates vigentes

| Gate | Estado | Aceite antes da v8 |
| --- | --- | --- |
| Código/CI | PRs #95, #98 e #99 reconciliados; novos heads exigem CI próprio | checks verdes e revisão humana nos SHAs finais |
| Workflow | YAML e 12 blocos shell validados; hardening ainda draft | teste integral, unicidade dos passos e CodeQL no head final |
| Billing/orçamento | DESCONHECIDO nesta sessão | leitura atual de billing e orçamento/alertas |
| WIF/service account | WIF funcionou no run v6; menor privilégio não revalidado | revisar identidade e permissões efetivas |
| Secret/keyring | v6 rejeitou formato; v7 não deve executar | keyring canônico existente e escopo verificado sem expor valor |
| Apps Script | acesso `MYSELF` ainda não implantado/provado | deployer canônico executa nondev; terceiros não executam |
| Usuários/MFA/App Check | DESCONHECIDO | smoke autenticado, nega anônimo/outro tenant e valida MFA |
| Backup/restore | comprovado apenas no run v6 | repetir gate de backup e restore no run v8 aprovado |
| GitHub | branch retornou sem proteção; ambiente permitia self-review/bypass | required checks e aprovador humano separado |
| DNS/HTTPS/SSL | issue #32 continua pendente | evidência atual dos destinos autorizados |
| Mac/iMac | PR #95 reconciliado; instalação/round-trip/restart/rollback pendentes | ensaio nativo autorizado com saída correlacionada |

Ausência de acesso é DESCONHECIDO, não falha comprovada. CI, merge, deploy,
ingestão, instalação local e release comercial são estados separados. Nenhuma
request v8 deve ser criada enquanto o hardening, o deploy e a evidência do par
não estiverem concluídos.
