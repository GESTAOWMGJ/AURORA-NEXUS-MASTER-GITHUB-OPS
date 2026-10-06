# Produção — bootstrap autorizado e checkpoint de 06/10/2026

Estado: **IDENTIDADE E SEGREDOS CONFIGURADOS; APLICATIVO NÃO PUBLICADO**.
Baseline: `67ff80d147c0ea96692becf2adf8f04bc0b3fb8c` (PR #160 integrado).
O titular autorizou especificamente Required reviewers com GESTAOWMGJ,
`firebase-production`, projeto/número abaixo, WIF/IAM, segredos próprios,
publicação deste checkpoint e deploy validado.

## Evidências concluídas

- GitHub confirmou `Environment "firebase-production" updated` após salvar
  Required reviewers com `GESTAOWMGJ`. A revisão do job continua obrigatória.
- GCP reconfirmou `wmgj-prod-jfn-20261005`, número `616997609173`,
  `ACTIVE`, com faturamento habilitado.
- Criada a identidade
  `aurora-prod-deploy@wmgj-prod-jfn-20261005.iam.gserviceaccount.com`.
- Aplicados os quatro papéis do bootstrap integrado: `roles/firebase.admin`,
  `roles/datastore.owner`, `roles/secretmanager.viewer` e
  `roles/serviceusage.serviceUsageAdmin`. São permissões de provisionamento;
  não constituem validação de suficiência para publicar todas as Functions.
- Pool `aurora-github` ativo e provider `github` configurado. A condição foi
  relida e comparada com o repositório canônico, `refs/heads/main`,
  `firebase-production` e o workflow direto
  `.github/workflows/aurora-firebase-production.yml@refs/heads/main`.
- `roles/iam.workloadIdentityUser` concedido na identidade de provisionamento
  ao principal do ambiente nesse pool. Nenhuma chave JSON de service account.
- Os três segredos de produção têm versão `ENABLED` verificada:
  `AURORA_NEXUS_ALLOWED_EMAILS`, `AURORA_NEXUS_CSRF_HMAC_KEY` e
  `WMGJ_INGEST_HMAC_KEYRING`.
- Apenas a política de e-mails autorizados foi reutilizada de HML, conforme o
  bootstrap existente. As chaves criptográficas são novas, de 256 bits;
  a chave de ingestão permanece inativa. Nenhuma senha, sessão, documento ou
  dado operacional foi copiado. Valores de segredos não foram registrados.
- Resultado remoto: `AURORA_PROD_CLOUD_BOOTSTRAP_OK`, exit code 0.

## Contrato candidato e validação local

Request e estado desejado passam a declarar o ID/número efetivamente verificados,
com `READY_FOR_PROVISIONING`. Isso autoriza somente o provisionamento existente.
Continuam `COLD_PRODUCTION`, projeção desligada/SHADOW, sem mutação de produção,
sem mutação de fonte e sem dado clínico sensível.

Build TypeScript, 13 testes comportamentais do contrato e nove testes estáticos
passaram. Destino divergente, seleção incompleta, HML, candidato histórico e
relaxamento dos guardrails continuam rejeitados. CI do novo SHA é uma evidência
separada a consultar no PR; os testes locais não comprovam deploy.

## Bloqueio atual e continuidade

Ao tentar salvar `FIREBASE_PROD_PROJECT_ID`, o GitHub abriu `Confirm access`
com passkey, GitHub Mobile, autenticador ou código por e-mail. A verificação
segura não foi concluída. As variáveis ainda exibiam o destino histórico.
Não houve tentativa de contornar essa verificação. A autorização do titular
continua válida; autenticação do provedor é uma exigência distinta.

Após concluir essa autenticação, salvar no ambiente:

| Variável | Valor autorizado |
| --- | --- |
| FIREBASE_PROD_PROJECT_ID | wmgj-prod-jfn-20261005 |
| FIREBASE_PROD_PROJECT_NUMBER | 616997609173 |
| GCP_PROD_DEPLOY_SERVICE_ACCOUNT | aurora-prod-deploy@wmgj-prod-jfn-20261005.iam.gserviceaccount.com |
| GCP_PROD_WIF_PROVIDER | projects/616997609173/locations/global/workloadIdentityPools/aurora-github/providers/github |

O workflow integrado provisiona infraestrutura; não publica o aplicativo.
Banco, configuração Firebase própria de produção, identidade de runtime,
acesso nominal, backup/restore, publicação, smoke positivo/negativo e rollback
continuam pendentes de evidência produtiva. O `firebase.json` existente conserva
o bloqueio exclusivo de HML. Nenhum workflow produtivo foi aprovado/disparado
nesta etapa, nenhum banco criado e nenhum dado operacional ingerido.

## Aprendizado e reversão

M08/M09/M10: autorização, autenticação do provedor, configuração, CI,
provisionamento e publicação têm evidências independentes. Uma primeira listagem
dos providers retornou NOT_FOUND após a criação do pool; a consulta posterior
confirmou o pool ACTIVE e a retomada idempotente concluiu o bootstrap. Não
substituir uma verificação ausente por uma declaração de sucesso.

O request candidato pode ser revertido sem apagar recursos. Para contenção
administrativa, desabilitar o provider WIF suspende novos acessos federados;
não excluir bancos, chaves ou versões de segredo como rollback automático.
O deploy HML `37381514382` permanece a referência funcional anterior. Este
checkpoint não declara produção validada, certificação ou prontidão comercial.
