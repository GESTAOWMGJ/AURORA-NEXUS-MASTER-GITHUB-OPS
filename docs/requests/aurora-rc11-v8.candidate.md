# RC1.1 v8 — candidata inativa para revisão

Estado: PREPARED_NOT_AUTHORIZED. Este pacote é um modelo documental; não é a
request operacional e não representa aprovação humana. AURORA NEXUS permanece
o sistema-mãe, com WMGJ Operação como piloto.

## Escopo desta preparação

A correção do tail duplicado já está na main pelo PR #104. A revisão de
03/10/2026 confirmou a main `91665cc94c4bde9b82a75cd39905263c60e02191`:
19 arquivos YAML válidos, 94 blocos shell com `bash -n`, 12 passos críticos
RC1.1 únicos e um upload de evidência. O YAML histórico `89baefb` foi
rejeitado pelo parser, confirmando cobertura para o defeito original.

Os PRs #95 (`8a23778`), #98 (`c8f604c`) e #99 (`28edabd`) incorporam
essa main, estão zero commits atrás e tiveram seus checks concluídos com sucesso
nos respectivos SHAs. O guard do PR #105 (`99ac570`) também passou no CI.
O PR #107 continua empilhado sobre #98; sua revisão e integração são separadas.

`aurora-rc11-v8.candidate.json` usa as chaves do contrato fechado v8 do
workflow em `61880a9`, mas mantém `candidateOnly=true`, aprovações false,
`pairEvidenceAttested=false` e os valores ainda não comprovados como null.
O gate operacional deve rejeitar esta candidata. Nenhum identificador de runtime,
linha, hash documental ou aceite humano foi inventado.

O arquivo está em `docs/requests/`, fora do path que dispara RC1.1.
`.github/requests/aurora-rc11-run.json` permanece byte a byte inalterado
em relação à main e ao pai desta preparação. Não copiar a candidata para esse
path como forma de disparar ou testar o executor.

## Pendências para materializar a request imutável

| Pendência | Estado / evidência | Risco | Responsável sugerido | Próxima ação | Critério de aceite | Bloqueador real |
| --- | --- | --- | --- | --- | --- | --- |
| Integração do código revisado | PENDENTE; #98 e #107 em draft, CI não implanta | request ligada a código diferente do runtime | mantenedor + revisor humano | revisar e integrar em etapa separadamente autorizada | SHA final revisado e checks do mesmo SHA | revisão/integração ainda não comprovadas |
| Identidade do runtime | DESCONHECIDO para a futura v8; campos null | executar deployment/revision divergentes | plataforma | após deploy HML próprio e autorizado, obter metadados do Apps Script e ingestão | deployment ID, versão, revision e SHA implantado correlacionados | runtime da candidata ainda não comprovado |
| Par fiscal/bancário | PENDENTE; campos null, atestação false | seleção errada, replay ou falsa conciliação | auditor responsável + backend | inspeção limitada somente leitura e revisão das duas linhas | hashes, linhas, idempotência e binding coerentes, com atestação humana | evidência específica do par ausente |
| Gates HML | DESCONHECIDO nesta preparação | mutação sem acesso/recuperação/isolation comprovados | plataforma + segurança + QA | revalidar billing/orçamento, WIF/SA, Secret Manager/API e metadados de ALLOWED_EMAILS, usuários/memberships/MFA, ambiente protegido, Rules, App Check, backup/restore, DNS/HTTPS/SSL e smoke autenticado | evidência atual de cada gate, sem ler ALLOWED_EMAILS nem expor secrets | acesso administrativo/evidências atuais não disponíveis nesta preparação |
| Aprovação da execução | PENDENTE; deploymentApproved e firebaseWriteApproved false | autoaprovação ou uso de autorização antiga | aprovador humano distinto | revisar escopo e nova request final em commit exclusivo | aprovação separada sobre o SHA/request e no ambiente protegido | nenhuma aprovação específica da v8 |
| Materialização | BLOQUEADA pelas linhas anteriores; modelo fora do trigger | disparo prematuro ou request não imutável | mantenedor | somente após evidências/autorizações, produzir commit request-only | primeiro pai é o SHA efetivamente implantado, predecessor v7 preservado, contrato v8 aceito | IDs/hash/atestação/autorizações ainda ausentes |

A confirmação de recebimento deste plano ou uma aprovação genérica de patches não
preenche os gates de execução. `requestedAt` deve refletir a criação da request
final; `approvedBaseSha` deve ser seu primeiro pai real, e não o head deste modelo.

## Ordem e limites

Seguir `docs/AURORA_EXECUTION_DECISION_20261002.md`. Não aprovar nem reexecutar
o run histórico v7 `37093409122`. A futura v8 reutiliza keyring/runtime existentes:
não cria segredo, não altera IAM, não reconfigura a ponte e não publica Function.
Aprovação de Hosting/Rules/indexes, restore e envio do par continua separada.

Sem merge, deploy, segredo, usuário, DNS, permissão, produção, ingestão real ou
instalação Mac nesta preparação. O projeto vigente excluído pelo titular não foi
inspecionado. CI, implantação, ingestão e resultado financeiro são evidências
distintas.

Rollback documental: remover/reverter somente os dois arquivos de candidata
neste diretório. Nenhum estado cloud foi alterado.
