# AURORA NEXUS — decisão de execução HML

Estado: NO-GO. A request v6 foi executada parcialmente e falhou de modo fechado
antes de qualquer amostra real. Sistema-mãe AURORA NEXUS; piloto WMGJ Operação.
Baseline executada: main `f8699caa254ed058fea67beff2d275f51602b394`,
run `37092175109`. A reconciliação do PR #98 ainda exige SHA final e novo CI.

## Sequência concreta

1. Revisar o SHA final do PR #98 e os cinco checks; não reutilizar CI de SHA
   anterior. Os três alertas CodeQL encontrados nesta revisão dizem respeito a
   expressões regulares de URLs em testes estáticos. As verificações foram
   convertidas em comparações literais do código-fonte; aguardar novo scan.
2. Aprovar separadamente a integração da candidata e a publicação HML. Atenção:
   integrar arquivos `src/*.gs` ou `tools/*.sh` na main aciona o workflow
   `Deploy Apps Script WMGJ`. A aprovação de merge precisa incluir essa
   publicação automática HML; não é uma operação apenas documental.
3. Implantar a versão corrigida das Functions pelo fluxo HML protegido e
   comprovar os gates abaixo. O RC1.1 não publica o conjunto completo de
   Functions; pode reimplantar somente `ingestWmgjEvent` sob aprovação explícita
   de migração. Publicar apenas Hosting/Rules não leva as demais correções de
   política e cálculo ao backend.
4. Só após comprovar runtime, recuperação, identidade e escopo, criar uma
   request v7 em mudança separada. `approvedBaseSha` deve ser o primeiro pai
   real do futuro commit da request, após a integração/implantação aprovadas;
   não antecipar esse SHA. A request v6 presente na main é registro histórico e
   permanece byte a byte inalterada nesta candidata.
5. Submeter o run novo a aprovação humana separada no ambiente protegido, com
   a versão e os efeitos abaixo visíveis. Não reutilizar nem reexecutar as
   requests/runs anteriores.

## Escopo da futura execução RC1.1 v7 (não executado por esta candidata)

Restauração real para banco temporário HML e cleanup desse banco; verificação do
runtime existente; deploy Hosting/Rules/indexes; configuração da ponte Apps
Script; eventual migração autorizada de um segredo legado reconhecido para uma
nova versão do keyring existente, seguida de redeploy somente da ingestão (sem
criar secret ou alterar IAM); envio limitado ao par fiscal/bancário já previsto;
reconciliação, projeção SHADOW e kill switch. Cada efeito exige aprovação
específica da request. Nenhum backfill genérico, produção, fonte ou dado clínico.

A futura solicitação deve nascer inativa para revisão e só receber
`candidateOnly=false` no commit imutável autorizado. O executor exige confirmação
literal, request v7 nova, `approvedBaseSha` igual ao primeiro pai e tentativa
inicial. Preparar conteúdo não autoriza execução.

## Reconciliação do run v6 existente

O run `37092175109`, disparado pela main antes desta reconciliação, terminou com
falha no gate da ponte Apps Script (exit 77): o valor HMAC existente não era JSON
de keyring aceito nem legado hexadecimal de 64 caracteres. Restore e cleanup do
banco temporário passaram, e Hosting/Rules/indexes foram publicados. Não houve
migração de versão do secret, ativação de escrita, amostra real, reconciliação,
SHADOW, Native Intelligence ou upload final de evidência. Resolver o formato por
um fluxo revisado e revalidar os efeitos já ocorridos são pré-requisitos para uma
request v7; não corrigir o secret dentro desta candidata de código.

## Gates e bloqueadores reais

| Gate | Evidência atual | Próxima ação / aceite | Responsável sugerido |
| --- | --- | --- | --- |
| Código | CI no PR; aprovação humana pendente | cinco checks e revisão no SHA final | mantenedor/revisor |
| Billing/orçamento | desconhecido nesta sessão | comprovar billing e orçamento/alertas sem mutação | administrador HML |
| WIF/service account | autenticação WIF comprovada no run `37092175109`; menor privilégio integral não auditado | revisar permissões efetivas antes de nova execução | cloud/IAM |
| Secrets/API | leitura do keyring ocorreu, mas o formato foi rejeitado com exit 77; nenhum valor deve ser publicado | diagnosticar formato por canal seguro e definir migração explícita, sem ampliar IAM | cloud/IAM |
| Usuário/membership/MFA/App Check | não comprovado na candidata | smoke real autorizado; nega anônimo e outro tenant; valida MFA | QA/segurança |
| Rules e runtime | runtime da main verificado e Hosting/Rules/indexes publicados no run v6; Functions da candidata não publicadas | publicar Functions corrigidas pelo fluxo próprio e repetir smoke no SHA integrado | backend |
| Backup/restore | backup recente, restore real temporário e cleanup comprovados no run v6 | repetir o gate na futura request v7; evidência anterior não autoriza nova amostra | operações |
| Proteção GitHub | main retornou protected=false; ambiente pediu aprovação, mas permite self-review e bypass administrativo | required checks e revisor humano separado sem autoaprovação antes da promoção | administrador GitHub |
| DNS/HTTPS/SSL | pendências da issue #32, sem nova inspeção neste patch | evidência atual dos destinos autorizados | infraestrutura |
| iMac | cadastro/despacho não comprovam execução | PR #95 atualizado, diagnóstico local, teste nativo e rollback | desktop/titular |

Não há gcloud autenticado ou API Firebase administrativa disponível neste
ambiente de execução. Isso impede verificar gates cloud atuais por leitura;
não prova falta de recurso. O smoke real e o ensaio Mac precisam devolver
resultado verificável. Não registrar credenciais, e-mails, dados clínicos ou
links privados no PR.

## Limites de aceite

CI, revisão de código, implantação, instalação local, ingestão real e release
comercial são estados separados. Boot patcher multiplataforma, App Check ponta a
ponta e instalação nativa continuam sem comprovação de execução. Não promover
essas capacidades por existência de contrato, documentação ou disparo remoto.

## Incremento sem Mac

O coletor `firebase-migration/scripts/hml_readonly_preflight.py` permite auditar
metadados do HML sem ler valores de secrets. Não substitui o preflight protegido
do deploy nem comprova acesso efetivo do runtime. Nesta sessão retornou
`GCLOUD_UNAVAILABLE`; nenhum dos gates cloud foi promovido.

O gate de backup compartilhado agora exige validade de até 24h, expiração futura
e mesmo databaseUid, antes de deploy ou restore. Deploy sem backup elegível não
possui mais exceção automática. Detalhes e limites estão nos documentos 38 e 39
de `firebase-migration/docs`; o boot possui núcleo de observação read-only,
sem endpoint ou executor. Sua integração real permanece pendente.

Leitura GitHub em 03/10/2026: main `protected=false` e lista de rulesets visíveis
vazia. A configuração do ambiente `firebase-homologation` continua sem revalidação
administrativa. Esses escopos são distintos; não inferir proteção do ambiente
pelo estado da branch nem alterar permissões automaticamente.

## Núcleo de observação do boot — candidata

O módulo `api/wmgj_api/boot_observer.py` valida o contrato canônico e o vínculo
entre contexto server-side, manifesto e evidências. A saída pública é minimizada;
o evento de auditoria é apenas uma intenção privada com persisted=false.
Nenhuma rota, fonte real, escrita ou atualização de aplicativo foi conectada.
Os testes exercitam fontes sintéticas; não validam Auth/App Check/Firestore reais.

Próximo gate de código: adaptador consistente sobre o checkpoint existente,
revogação atual, empacotamento da fonte canônica e transporte que exponha somente
public_status. Próximo gate operacional: smoke autenticado autorizado em HML.
O Release Cockpit não recebe promoção de prontidão operacional por esse núcleo.
