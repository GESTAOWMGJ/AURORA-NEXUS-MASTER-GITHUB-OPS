# Liberação de produção — checkpoint de 05/10/2026

Solicitação do titular: liberar produção. Estado: **PREPARAÇÃO; NÃO IMPLANTADO**.
Baseline funcional HML: `cdaf833e763d99e0b50640158480a1be13ee3bc3`, deploy
`37381514382`. Não confundir essa evidência com produção.

## Verificação ao vivo

Consultas somente leitura via gateway Windows e sessão GCP existente:

| Recurso | Resultado |
| --- | --- |
| Projeto | `wmgj-prod-jfn-20261005` |
| Número | `616997609173` |
| Lifecycle | `ACTIVE` |
| Billing | `billingEnabled=true` |
| Banco Firestore | lista vazia |
| Secrets de produção | lista vazia |
| SA `aurora-prod-deploy` | `NOT_FOUND` |
| Provider `aurora-github/github` | `NOT_FOUND` |

A sessão do navegador está autenticada no GitHub. O CLI `gh` do gateway não
possui sessão. Isso não invalida o acesso do navegador nem do conector GitHub.

O environment `firebase-production` existe, sem required reviewers. Contém apenas
`FIREBASE_PROD_PROJECT_ID=aurora-nexus-prod-wmgj` e uma service account do mesmo
candidato histórico. Essas configurações não correspondem ao projeto verificado.

## Trabalho validado

PR #160 reconciliado com `cdaf833e...`, preservando o vínculo ao nome canônico do
repositório e a UX do #163. Build TypeScript, 32 testes direcionados e 11 testes
comportamentais passaram. Cinco workflows passaram no head reconciliado
`dd248468a5f085f17dc01c516d98427d5b24f24c`.

Correção subsequente: o bootstrap WIF passa a conferir `workflow_ref`, claim do
workflow direto. `job_workflow_ref` descreve o workflow reutilizável chamado e não
é o contrato apropriado para este workflow, que não usa `workflow_call`.
Preservados repositório exato, `refs/heads/main` e environment exato.
Referência: https://docs.github.com/en/actions/reference/security/oidc

## Bloqueio observado

A revisão automática da ferramenta rejeitou o clique para ativar **Required
reviewers**, classificando a mudança de configuração do ambiente de produção
como sensível e exigindo confirmação específica em tempo de ação. Nenhuma
proteção foi alterada. Não substituir essa operação por outro meio para contornar
a rejeição.

Configuração concreta para revisão pelo titular:

- Environment: `firebase-production`.
- Required reviewer: `GESTAOWMGJ`; manter revisão antes do job cloud.
- Projeto: `wmgj-prod-jfn-20261005`; número `616997609173`.
- SA: `aurora-prod-deploy@wmgj-prod-jfn-20261005.iam.gserviceaccount.com`.
- Provider: `projects/616997609173/locations/global/workloadIdentityPools/aurora-github/providers/github`.
- Trust WIF restrita a este repositório, main, environment e workflow de produção.
- Bootstrap existente usa `roles/firebase.admin`, `roles/datastore.owner`,
  `roles/secretmanager.viewer` e `roles/serviceusage.serviceUsageAdmin`; esses
  papéis são de provisionamento, não comprovação de suficiência para deploy.
- Segredos próprios de produção, sem chave JSON de service account e sem
  copiar senhas, sessões ou dados operacionais da homologação.

## Próximas evidências necessárias

1. Configurar proteções/variáveis e bootstrap WIF após superar a rejeição acima.
2. Promover o ID/número verificados em mudança explícita no request e no estado
   desejado. O request continua bloqueado neste checkpoint.
3. Implementar e validar publicação própria de produção. O deploy Firebase atual
   e seu `firebase.json` continuam exclusivos HML; endpoints ainda apresentam
   metadados HML e os instaladores atuais apontam para HML.
4. Provisionar e testar acesso nominal, autenticação, isolamento, secrets, banco,
   backup/restore, smoke positivo/negativo e rollback no SHA final.
5. Preservar bloqueio de dados reais e clínicos até evidências próprias de produção.

Aprendizado M08/M09/M10: sucesso HML não promove identidade, credenciais, dados ou
metadados de ambiente. Validar claims OIDC pelo tipo real de workflow e confrontar
ID/número/variáveis antes de qualquer mutação. Registro persistido na fonte mestre;
nenhuma nova regra de runtime ou aprendizagem orgânica ativa foi implantada.

## Reconciliação documental após merge do PR #160

Baseline da main conferida: `67ff80d147c0ea96692becf2adf8f04bc0b3fb8c`.
O request registra o projeto `wmgj-prod-jfn-20261005`, número
`616997609173`, usando a evidência ACTIVE/billing habilitado acima, já
registrada pelo PR #160. Não houve nova consulta GCP nesta reconciliação.
`expectedSourceSha` aponta à baseline indicada, anterior ao commit deste patch.

`confirmation=null` e `status=BLOCKED_PROJECT_NOT_VALIDATED` permanecem
inalterados. O nome do status é preservado por compatibilidade com o contrato;
neste checkpoint o projeto está identificado, mas a prontidão produtiva não está
comprovada. WIF, service account, secrets próprios e proteção do environment
continuam pendentes de evidência atual. Nenhum desses recursos é declarado pronto.

O estado desejado do domínio permanece bloqueado com ID/número nulos: sua
promoção e a confirmação de provisionamento pertencem a mudança posterior,
após comprovação dos gates. Não foram alterados workflow, validador, bootstrap,
IAM, secrets, environment, HML, DNS, fallback ou flags operacionais.

Escopo: request/checkpoint e expectativas dos testes existentes que exigiam
ID/número nulos. A validação continua rejeitando este request antes de consultas
externas ou autenticação. Nenhum merge ou workflow produtivo foi disparado.
Reversão: restaurar os três campos do request da baseline; manter confirmação,
status e flags bloqueados.

Validação local deste patch: 11 testes Python de contrato e 9 testes estáticos
de provisionamento passaram. O teste de contrato mocka consultas e comprova
zero chamadas externas no estado bloqueado. PowerShell não está disponível no
executor local; o ensaio comportamental PowerShell permanece a cargo da CI
existente. Estes resultados não comprovam implantação nem recursos produtivos.
