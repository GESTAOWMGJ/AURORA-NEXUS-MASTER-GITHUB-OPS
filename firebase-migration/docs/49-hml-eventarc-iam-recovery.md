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

### Diagnóstico pronto para Windows — incremento 1.0.1

`tools/windows/DIAG_AURORA_HML.cmd` executa somente
`firebase-migration/scripts/hml_gate_readonly.py --collect`. O coletor localiza
o SDK no PATH e nos destinos usuais do instalador Windows; não modifica o PATH
nem instala outro SDK. Python 3 é necessário. Ausência no PATH não prova ausência
da ferramenta; lista de credenciais vazia não representa uma conta ativa.

Se retornar `AUTH_LOGIN_REQUIRED`, o titular pode executar o lançador com o
argumento `login`. Somente essa opção explícita abre o fluxo oficial interativo
`gcloud auth login --brief`: exige escolha da conta autorizada no navegador e
pode criar/atualizar a credencial local do CLI. Não solicita senha ao agente,
não exporta tokens e não concede acesso ao projeto. Ao concluir, repete as leituras.
Sem esse argumento, o diagnóstico nunca inicia login ou troca de identidade.

O alvo é fixo no HML autorizado. A coleta compara ID/número/estado do projeto
antes de consultar IAM, Functions Gen2 e Eventarc na região homologada. Reutiliza
o planejador existente sem chamar sua aplicação. Nenhum valor de segredo,
documento Firestore, principal IAM, política completa ou erro bruto sai no relatório.
Condição IAM, acesso negado e metadados inválidos continuam desconhecidos.
Binding direto ausente exige revisão, não concessão automática. Inventário
regional vazio é metadado observado, não prova de ausência global.

Código 0 significa conclusão desta coleta ou plano sem consultas; código 2
significa pendência. Ambos mantêm `releaseApproved=false`. Sem `--collect`, o
Python apenas apresenta o plano. Billing/orçamento, WIF, secrets, memberships/MFA,
App Check, backup/restore, DNS/SSL, acesso efetivo e autenticação da aplicação
continuam gates independentes. Sucesso do inventário não os promove.

Aprendizado AURORA-MO-001/M08/M09: distinguir descoberta de executável, credencial
configurada, autenticação válida, permissão de leitura, configuração observada e
ação autorizada. Estado operacional só muda com evidência da etapa correspondente.
Teste: `python -m unittest discover -s scripts/tests -p test_hml_gate_readonly.py -v`.
Rollback: remover o lançador/coletor e reverter teste/CI; o diagnóstico não modifica
cloud. Login manual possui ciclo de credenciais próprio.

### Recuperação administrativa separada

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

O workflow protegido executa primeiro o diagnóstico somente leitura com a mesma
identidade WIF já configurada. Ele verifica a conta ativa e o projeto aprovado,
obtém o número do projeto e reutiliza este script sem `--apply`. Bindings ausentes,
condicionais ou uma leitura negada interrompem o deploy antes do Firebase CLI.
O log contém apenas o resultado reduzido do diagnóstico; a política completa fica
em diretório temporário privado, apagado ao sair da etapa e nunca enviado como
artefato. Nenhuma permissão é concedida pelo preflight. A reparação administrativa
continua separada e exige revisão atual da política.

Incremento `AURORA-HML-IAM-PREFLIGHT-001`, baseline `4c121df2`: validação local pelo
teste de recuperação IAM e pelos checks de configuração existentes; CI, consulta
cloud e deploy exigem seus próprios resultados. Reversão: reverter somente esta
etapa e este registro; isso não reverte permissões, pois o incremento não as altera.

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
