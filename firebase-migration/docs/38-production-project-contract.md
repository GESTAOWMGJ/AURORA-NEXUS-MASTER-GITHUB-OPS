# AURORA NEXUS — contrato de projeto de produção

Código: AURORA-PROD-PROJECT-001. Versão: 2. Data: 05/10/2026.
Baseline observada: `68467209b55f1f8e281ecb5d21acb9a8211757cf`. Módulos: M08/M09/M10.
Reconciliado com a main `19937d96be37a570caa9e074a9c03d51543cdbc8` em 05/10/2026.
Estado operacional: **BLOCKED_PROJECT_NOT_VALIDATED**.

## Evidência e correção

A resposta da equipe Cloud Firestore de 02/10/2026 concedeu acesso CMEK ao
projeto HML existente. O candidato `aurora-nexus-prod-wmgj` não foi associado
a um projeto GCP existente e não recebeu essa concessão. Isso não determina
se o motivo era nome incorreto, erro de digitação ou outra hipótese; também
não constitui verificação atual de existência. O candidato fica apenas no
histórico do estado desejado, com `operationalUseAllowed=false`.

O request v1 tratava esse candidato como destino e o bootstrap criava projeto
quando `describe` falhava, inclusive em falhas de autorização. O contrato v2
remove essa criação e o vínculo automático de billing. Ausência, recusa,
timeout e resposta inválida encerram a execução, sem fallback para HML,
`wmgj-ops`, candidato histórico ou projeto padrão da CLI.

## Estado canônico e preflight

- `.github/requests/aurora-firebase-production.json`: `projectId`,
  `projectNumber` e `confirmation` nulos; status bloqueado.
- Estado desejado do domínio: mesmo ID/número nulos e mesmo bloqueio;
  fallback atual e todos os gates DNS/SSL/auth preservados.
- `production_project_contract.py`: validador comum ao Windows e ao workflow.
  A validação local precede login/bootstrap e autenticação WIF do workflow.
  Formato de ID válido, sozinho, não comprova projeto existente.
- A consulta GCP exige correspondência exata de `projectId`, `projectNumber`,
  `lifecycleState=ACTIVE` e billing já habilitado. Executa somente `describe`.
  Falta de permissão não é interpretada como inexistência e nunca autoriza criar.
- O workflow confere também a conta `aurora-prod-deploy` do projeto e o provider
  WIF `aurora-github/github` sob o número aprovado, antes da autenticação.
  Mantém main corrente, SHA imutável e environment protegido.

Referências técnicas: [metadados de projetos](https://docs.cloud.google.com/resource-manager/docs/view-update-projects),
[gcloud projects describe](https://docs.cloud.google.com/sdk/gcloud/reference/projects/describe)
e [billing describe](https://docs.cloud.google.com/sdk/gcloud/reference/billing/projects/describe).

## Futuro desbloqueio — mudança separada

1. Identificar um projeto GCP existente com ID e número explícitos, ativo e
   acessível, separado de HML/fallback, com billing habilitado. Registrar evidência
   sanitizada e aprovação na mudança; não colocar credenciais ou dados de cliente.
2. Revisar request v2 e estado desejado para o mesmo ID/número, status
   `READY_FOR_PROVISIONING` e confirmação
   `PROVISION_EXISTING_PRODUCTION_PROJECT`. Selecionar o SHA fonte revisado.
3. Bootstrap Windows requer Python 3 (`python` no PATH), gcloud e gh, além de
   `-ProductionProjectId` e `-ProductionProjectNumber` explícitos. Não cria
   projetos nem vincula billing. Uma vez desbloqueado e autorizado, continua
   sendo **mutante**: configura APIs, IAM, WIF, secrets e environment.
4. O environment deve conter `FIREBASE_PROD_PROJECT_ID`,
   `FIREBASE_PROD_PROJECT_NUMBER`, `GCP_PROD_WIF_PROVIDER` e
   `GCP_PROD_DEPLOY_SERVICE_ACCOUNT`, coerentes com o contrato revisado.
   A consulta live é repetida antes das mutações de plataforma.
5. CMEK de produção exige evidência própria. Existência do projeto não concede
   acesso CMEK; acesso CMEK HML não é herdado. Este patch não habilita CMEK,
   dados reais ou `CLINICAL_SENSITIVE` em produção.

`productionMutation=false` permanece o guardrail dos dados operacionais;
não significa que o provisionador de infraestrutura desbloqueado seja read-only.
O bloqueio do provisionamento é o status/identidade do contrato, verificado antes
de qualquer mutação. O workflow pode ser agendado por alteração do request na main,
mas este request bloqueado não chega à autenticação nem ao provisionamento.

## Verificação e reversão

Testes sintéticos cobrem contrato pendente, candidato histórico, HML/fallback,
campos ausentes, ID/número divergentes, WIF de outro projeto, projeto não ativo,
billing ausente, timeout, JSON inválido, `PERMISSION_DENIED` e `NOT_FOUND`.
O teste PowerShell executa o bootstrap bloqueado e exige zero chamadas gcloud/gh.
São testes de código; não comprovam provisionamento nem homologação de produção.

Reversão funcional deve manter o request e o domínio bloqueados/nulos e preservar
a proibição de criação automática. Não restaurar o candidato como default.
Nenhum projeto, recurso, variável remota ou permissão foi alterado por este patch.
Próximo gate: seleção/evidência de projeto existente em mudança separada.
