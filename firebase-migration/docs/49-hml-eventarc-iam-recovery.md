# Recuperação do deploy integral HML: IAM do Eventarc

Estado: ferramenta implementada e testada com políticas sintéticas. Aplicação IAM,
novo deploy integral e sincronização Windows–cloud exigem evidência operacional
própria. Nenhum identificador de ambiente ou política real integra este pacote.

## Finalidade

A versão fixada `firebase-tools@14.17.0` lê a política do projeto, calcula bindings
ausentes e tenta gravá-los na primeira implantação de serviços de eventos.
Um erro nessa gravação não prova que todos os três bindings estejam ausentes;
exige leitura atual antes da correção.

O código dessa verificação está em
[checkIam.ts da versão fixada](https://github.com/firebase/firebase-tools/blob/v14.17.0/src/deploy/functions/checkIam.ts).
A referência do provedor para alteração de política é
[gcloud projects set-iam-policy](https://docs.cloud.google.com/sdk/gcloud/reference/projects/set-iam-policy).

## Escopo da correção

Somente os bindings solicitados por essa versão do Firebase CLI:

| Principal | Papel no projeto HML |
| --- | --- |
| `service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com` | `roles/iam.serviceAccountTokenCreator` |
| `PROJECT_NUMBER-compute@developer.gserviceaccount.com` | `roles/run.invoker` |
| `PROJECT_NUMBER-compute@developer.gserviceaccount.com` | `roles/eventarc.eventReceiver` |

Esses papéis são concedidos no projeto e têm alcance material: Token Creator
permite emissão de credenciais de contas de serviço; Run Invoker permite invocar
serviços do projeto. Esta é a compatibilidade solicitada pelo CLI fixado, não uma
alegação de mínimo privilégio ideal para produção. Uma futura migração para
identidade dedicada e escopo por recurso requer mudança e homologação próprias.

Não conceder Owner, Editor ou Project IAM Admin à conta do GitHub para resolver
este incidente. A preparação deve ocorrer com uma identidade administrativa já
autorizada, sem exportar chaves ou tokens. O script não autentica nem eleva privilégios.
Uma condição IAM já existente para o mesmo principal/papel exige revisão específica;
o script não a converte em permissão irrestrita.

## Diagnóstico e aplicação

Em Linux ou Cloud Shell com `gcloud` autenticado, a partir deste checkout revisado.
Definir `AURORA_HML_PROJECT_ID` e `AURORA_HML_PROJECT_NUMBER` com os identificadores
confirmados do ambiente autorizado. Não são credenciais. O script exige prefixo
HML, bloqueia nomes de produção e compara ambos os identificadores com o servidor:

```sh
python3 firebase-migration/scripts/repair-hml-eventarc-iam.py \
  --project "$AURORA_HML_PROJECT_ID" \
  --expected-project-number "$AURORA_HML_PROJECT_NUMBER" \
  --evidence-dir "$HOME/aurora-iam-review"
```

O diretório deve ser novo, fora do repositório. Código de saída `3` significa plano
de adições pendente; `0` significa bindings já presentes; `2` significa bloqueio.
Política original e plano ficam em arquivos privados. Não publicar esses arquivos
como artefato público de Actions, PR, Notion ou evidência aberta.

Depois de revisar os bindings efetivamente ausentes, copiar `policySha256` do
plano para a operação autorizada:

```sh
python3 firebase-migration/scripts/repair-hml-eventarc-iam.py \
  --project "$AURORA_HML_PROJECT_ID" \
  --expected-project-number "$AURORA_HML_PROJECT_NUMBER" \
  --evidence-dir "$HOME/aurora-iam-apply" \
  --apply --confirm "APPLY_HML_EVENTARC_BINDINGS:$AURORA_HML_PROJECT_ID" \
  --expected-policy-sha256 HASH_DO_PLANO_REVISADO
```

O script relê a política, confere o hash, preserva `etag`, condições, membros e
configuração de auditoria, adiciona somente os bindings ausentes e verifica o
resultado no servidor. Mudança concorrente não é repetida automaticamente.
`apply-started.json` sem `result.json` significa resultado incerto/falha: reler IAM
antes de qualquer nova tentativa. `BINDINGS_VERIFIED` não comprova políticas Deny,
restrições organizacionais, acesso efetivo, deploy ou sincronização.

## Retomar publicação e verificar

1. Revalidar o SHA atual da `main`.
2. Executar o workflow existente `Deploy Aurora Firebase Homologation` com projeto
   HML, `DEPLOY_HOMOLOGATION`, `SHADOW_UPDATE` e `expected_main_sha` atual.
3. Usar a aprovação normal do ambiente `firebase-homologation`; manter checks,
   backup recente, PITR, proteção contra exclusão e smoke autenticado.
4. Verificar Functions, Hosting, Rules, índices e todas as rotas do contrato.
5. Separadamente, conectar o Windows pelo adaptador autenticado homologado e exigir
   recibo remoto, hash, idempotência e reconciliação. Não mudar flags do gateway
   `LOCAL_BOOTSTRAP` para simular uma capacidade não implementada.

Uma verificação pós-ingestão não substitui publicação integral nem comprova
sincronização física Windows. Um gateway que declara sincronização não implementada
precisa de adaptador autenticado e testes próprios; não pode ser ativado por flags.

## Reversão e evidência

Registrar apenas adições efetivamente realizadas e seu horário nos logs privados
do operador. Reverter por remoção nominal dessas adições, após verificar que não
passaram a sustentar outro serviço. Não restaurar cegamente uma política completa
antiga: isso poderia apagar mudanças legítimas de outros administradores.
O script não automatiza remoção, troca de executores ou desbloqueio de dados reais.

Testes locais e CI usam mocks, sem identidade GCP, rede ou escrita cloud:

```sh
python3 -m unittest discover -s firebase-migration/scripts -p test_hml_eventarc_iam.py -v
```
