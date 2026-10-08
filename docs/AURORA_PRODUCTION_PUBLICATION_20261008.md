# Publicação produtiva no mesmo workflow

Código candidato, sem deploy. M08–M10/AURORA-PROD-PROJECT-001. Alvo aprovado:
`wmgj-prod-jfn-20261005` / `616997609173`, `southamerica-east1`.
`wmgj-ops` responde no DNS legado; não é o projeto produtivo selecionado.
Consentimento existente permanece válido; autenticação e validação técnica são distintas.

## Evidência de 08/10/2026, 05:29–05:59 UTC

Xeon confirmou projeto ACTIVE, billing habilitado, DB `(default)` com PITR e
delete protection ativos. Functions e backups retornaram listas vazias. Agenda
diária de retenção 7d foi criada pelo proprietário às 05:52:52 UTC e confirmada
read-only às 05:55:54 UTC; nenhum backup READY estava disponível nesse corte.
Site produtivo reservado, customDomains vazio. Auth GET v2 oficial, com quota no
projeto correto, retornou 404 `CONFIGURATION_NOT_FOUND` por ID e número, enquanto
Identity Toolkit API estava ENABLED e Firebase ACTIVE. Configuração Auth ainda
não disponível, sem deduzir ausência de usuários. Bootstrap atual não executa
`initializeAuth`; a inicialização específica é a correção candidata verificável.
Config público do domínio continua apontando `wmgj-ops`.
As quatro variáveis GitHub e WIF ACTIVE correspondem ao projeto aprovado.
Build default real é Compute SA produtivo com Editor; não copiar seus grants
para o runtime. Publicação exige `aurora-prod-runtime@wmgj-prod-jfn-20261005.iam.gserviceaccount.com`
explícito no SDK/arquivo env produtivo. HML mantém sua própria identidade.
Run [37648242773](https://github.com/GESTAOWMGJ/AURORA-NEXUS-MASTER-GITHUB-OPS/actions/runs/37648242773)
preparou COLD_PRODUCTION; não publicou aplicativo. Reviewer existente preservado.

## Receita e gates

O workflow EXISTENTE mantém PROVISION_ONLY padrão e adiciona PUBLISH_BACKEND e
PUBLISH_HOSTING. Ambos exigem PUBLISH_PRODUCTION_BETA, main/SHA exatos, request
ancestral, CI Firestore verde no mesmo SHA, WIF e ambiente produtivo existente.
Publish não repete o PATCH de bootstrap da organização. Não configura IAM,
DNS, segredos, backup, banco ou scheduler. O config produtivo é próprio;
`firebase.json` conserva integralmente seu guard HML.

Preflight read-only: projeto/número/billing, DB protegido, agenda, backup READY
produtivo de até 24h, restore real `prod-restore-*` proveniente desse backup,
paridade dos guardrails, Auth email/MFA com TOTP habilitado e domínio canônico
exclusivo. Não usa HML como prova.
PITR ativo não é backup nem teste de restore. Fontes/dados clínicos não são lidos.
Runtime exige conta aprovada não desativada, Auth custom role com somente
users.get/createSession/create/update, datastore.user limitado ao DB default e
accessor nos três segredos específicos. Owner/Editor/firebase.admin no runtime
bloqueiam publicação. Metadata IAM fica em memória; só conta técnica/resultado
entram no recibo. Deployer requer acesso read-only de IAM para esse gate; não
usa a identidade Compute/Editor como substituto. Antes do Hosting, todas as
funções publicadas devem reportar esse runtime aprovado, ACTIVE e região correta.
Antes do Hosting, token nominal recente é verificado com revogação e MFA real;
custom/anonymous não satisfazem o aceite. Smoke verifica cookie, tenant, negativas,
TLS sem redirecionamento e manifests server/web no mesmo SHA. Valores de token,
e-mails, cookies ou configuração Firebase não entram em artefatos.

Backend tem escopo fixo de handlers, rules e indexes, sem agendamento duplicado.
Hosting exige todas as rotas ACTIVE e associação canônica ao alvo aprovado.
Builds/manifestos existentes são reutilizados; marca/channel HML dos instaladores
não é promovida silenciosamente. Publisher assinado activeRelease existente só
promove após o aceite canônico; este patch não emite certificado nem instala client.

## Disparo pelo proprietário dos efeitos

```powershell
gh workflow run aurora-firebase-production.yml --ref main `
  -f deployment_stage=PUBLISH_BACKEND `
  -f deploy_confirmation=PUBLISH_PRODUCTION_BETA `
  -f expected_main_sha=<SHA-main-atual> `
  -f validation_run_id=<CI-Firestore-success-no-mesmo-SHA> `
  -f restore_database=<prod-restore-comprovado>
```

PUBLISH_HOSTING usa os mesmos parâmetros/SHA após backend/associação canônica,
mais FIREBASE_PROD_SMOKE_UID e token MFA nominal temporário protegidos. Remover
o segredo temporário de smoke após o aceite administrativo. Não se recria consentimento.

Backup agendado: `gcloud firestore backups schedules create --database='(default)'
--retention=7d --recurrence=daily --project=wmgj-prod-jfn-20261005`.
O provedor escolhe a hora; não existe comando para forçar READY managed backup.
Clone PITR permite recuperação imediata, mas não equivale a esse backup.
Referências: [backup](https://firebase.google.com/docs/firestore/backups),
[PITR clone](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/databases/clone),
[Auth config](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/getConfig).

## Rollback e limites

O job captura versão anterior do Hosting antes da troca. Reverter pelo provider
à versão identificada; Functions por redeploy de SHA anterior verificado no mesmo
alvo. Primeira publicação sem versão anterior mantém contenção COLD_PRODUCTION
até correção, sem oferecer HML ao cliente. Nunca apagar dados/chaves como rollback.
Projeção, fonte, primeira ingestão, versão imutável e ensaio cloud/Xeon permanecem
aceites separados. CI/publicação/sessão não comprovam instalação ou ingestão real.

## Inicialização Auth específica, separada de publicação

`tools/windows/INITIALIZE_AURORA_PROD_AUTH.ps1` tem modo read-only padrão e
somente altera configuração ao receber `-ApplyAuthenticatedConfig`. O script
verifica contrato/projeto/número/billing antes, inicializa apenas diante de 404
`CONFIGURATION_NOT_FOUND` e configura email/senha, TOTP (janela adjacente 1),
domínio canônico exclusivo e desativa anonymous/phone. Não cria contas, copia
identidades HML nem imprime tokens/e-mails/segredos. Configurar MFA não equivale
a matrícula do autenticador ou sessão humana comprovada.

```powershell
& tools/windows/INITIALIZE_AURORA_PROD_AUTH.ps1 `
  -RepositoryRoot (Get-Location).Path -ApplyAuthenticatedConfig
```

Permissões do operador: `firebaseauth.configs.create`, `.get`, `.update` e
`serviceusage.services.use` para o quota project. Runtime não recebe essas
permissões de configuração. Fontes oficiais:
[initializeAuth](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.identityPlatform/initializeAuth),
[TOTP](https://docs.cloud.google.com/identity-platform/docs/admin/enabling-totp-mfa).

## Atualização verificada — 08/10/2026, 06:05–06:35 UTC

O diagnóstico Auth ausente acima foi superado às 06:05:56 UTC: initialization e
configuração autenticadas foram concluídas no projeto aprovado; email/senha,
MFA/TOTP e domínio auroranexus.com.br relidos e verificados. Nenhuma sessão MFA
nominal foi comprovada.

Às 06:33:12 UTC, CONFIGURE_AURORA_PROD_RUNTIME.ps1 criou/verificou a identidade
runtime aprovada: somente custom role Auth com quatro permissões e datastore.user
condicionado ao DB default no projeto; secretAccessor nos três segredos específicos.
Deployer recebeu leitor de metadata IAM e actAs somente nos SAs runtime/build.
Os roles existentes do build não foram alterados. A aplicação não foi publicada.
O script é idempotente, verifica contrato/projeto/número antes de escrita e recusa
custom roles/grants divergentes. Read-only é padrão; -Apply exige escopo já autorizado.

Coletor 1.0.1 instalado no Xeon, dois hashes do manifesto conferidos, 0 divergências;
1.0.0 e checkpoint anterior preservados. PR198 integrado em main 5d4762d, CI no
head f2ac1e3: Functions 641/641, regras 29/29, estáticos 3/3. Esse resultado não
é deploy nem recibo de ingestão. A publicação Apps Script no run 37738319750
parou em clasp push com invalid_grant; o status proprietário ainda não foi lido.
Backup produtivo nativo continua sem READY no corte de 06:35 UTC; PITR/agenda
não substituem esse recibo nem restore do mesmo backup.
