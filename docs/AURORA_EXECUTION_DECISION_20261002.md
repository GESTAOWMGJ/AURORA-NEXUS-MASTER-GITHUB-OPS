# AURORA NEXUS — decisão de execução HML

Estado: **NO-GO**. AURORA NEXUS permanece o sistema-mãe; WMGJ Operação,
o piloto. Baseline remota verificada em 03/10/2026: `main`
`91665cc94c4bde9b82a75cd39905263c60e02191`.

## Fato novo e contenção

A segunda tentativa do [run v7 37093409122](https://github.com/GESTAOWMGJ/automacao-gestao-wmgj/actions/runs/37093409122/attempts/2),
no SHA `91665cc94c4bde9b82a75cd39905263c60e02191`, terminou em falha
em 03/10/2026, 11:41 BRT. O job `111221038336` e seus logs foram consultados
em leitura. Esta revisão não disparou nem aprovou a execução.

### Comprovado nesta tentativa

- WIF, pré-requisitos, restore e cleanup concluíram com sucesso nos passos do job.
- A etapa de Hosting/Rules/indexes concluiu com mensagem de deploy completo;
  isso não comprova smoke autenticado ou homologação de toda a aplicação.
- Às 11:41:16 BRT, o Secret Manager confirmou a criação de uma nova versão do
  keyring existente. Portanto houve mutação parcial no HML; não descrever este
  run como sem alterações.
- Às 11:41:44 BRT, o redeploy pelo Firebase CLI falhou com HTTP 403,
  `secretmanager.secrets.setIamPolicy` negado no recurso do keyring.
  A mensagem não demonstra ausência do segredo; a criação de versão foi
  confirmada separadamente.
- Amostra real, reconciliação, SHADOW, teste de inteligência, verificação final
  do kill switch e upload de artefato ficaram skipped. Não há recibo de
  ingestão deste run nem comprovação atual do estado final do DRY_RUN.

O gate inicial foi registrado como success. A previsão anterior de que ele
impediria toda mutação não se confirmou e foi retirada deste documento.
Não aprovar ou reexecutar a v7 como remediação: ela pode gerar outra versão
de segredo e repetir alterações já concluídas.

### Pendência material de reconciliação do keyring/runtime

| Campo | Registro |
| --- | --- |
| Estado | FALHA COMPROVADA de autorização IAM durante o redeploy; consistência entre versão do segredo, revisão ativa da Function e ponte Apps Script DESCONHECIDA |
| Evidência | run/attempt/job acima; criação de versão seguida de HTTP 403; etapas de ingestão skipped |
| Risco | consumir uma versão diferente da ponte ou repetir rotação sem concluir o redeploy; não foi comprovado que esse descompasso ocorreu |
| Responsável sugerido | plataforma/segurança, com mantenedor Firebase/Apps Script |
| Próxima ação | inspecionar somente metadados das versões do keyring, secretEnvironmentVariables/revision/service account da Function e policy do segredo; conferir estado sanitizado da ponte e DRY_RUN por canal autorizado |
| Critério de aceite | versão canônica e consumidores reconciliados, acesso mínimo efetivo comprovado, revisão implantada identificada e prova HMAC sem escrita aprovada; depois preencher IDs da candidata |
| Bloqueador real | Firebase CLI solicitou setIamPolicy e recebeu 403; falta leitura administrativa atual para determinar binding existente e remediação mínima; gcloud indisponível neste runner |
| Limite da ação | não conceder papéis amplos, alterar IAM, gerar nova chave/versão, reiniciar fluxo, publicar Function ou modificar ponte automaticamente |

No PR #107 a v8 já separa publicação do runtime e consumo do keyring; seus
testes impedem criação de versões, alterações de IAM e redeploy de ingestão
dentro do RC1.1. Isso evita esse caminho na candidata, mas não corrige a
permissão nem reconcilia o estado cloud por si só. O deploy protegido próprio
também exige avaliação de IAM antes de qualquer execução autorizada.

A request operacional v7 permanece byte a byte inalterada. O modelo v8 em
`docs/requests/aurora-rc11-v8.candidate.json` continua inativo, com aprovações
false e valores não comprovados null. Nenhuma autorização antiga preenche
automaticamente seus gates. O histórico v6 permanece apenas como evidência
anterior; não substitui esta observação mais recente.

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
| WIF/service account | WIF funcionou na tentativa 2 da v7; setIamPolicy foi negado no redeploy | revisar identidade e permissões efetivas |
| Secret/keyring | v7 criou versão, mas redeploy falhou; consumidores ainda não reconciliados | keyring canônico existente e escopo verificado sem expor valor |
| Apps Script | acesso `MYSELF` ainda não implantado/provado | deployer canônico executa nondev; terceiros não executam |
| Usuários/MFA/App Check | DESCONHECIDO | smoke autenticado, nega anônimo/outro tenant e valida MFA |
| Backup/restore | restore e cleanup concluídos na tentativa 2 da v7 | repetir gate de backup e restore no run v8 aprovado |
| GitHub | branch retornou sem proteção; ambiente permitia self-review/bypass | required checks e aprovador humano separado |
| DNS/HTTPS/SSL | issue #32 continua pendente | evidência atual dos destinos autorizados |
| Mac/iMac | PR #95 reconciliado; instalação/round-trip/restart/rollback pendentes | ensaio nativo autorizado com saída correlacionada |

Ausência de acesso é DESCONHECIDO, não falha comprovada. CI, merge, deploy,
ingestão, instalação local e release comercial são estados separados. Nenhuma
request operacional v8 deve ser criada enquanto o hardening, o deploy e a evidência do par
não estiverem concluídos.
