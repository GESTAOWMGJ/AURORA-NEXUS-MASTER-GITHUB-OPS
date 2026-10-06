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

### Diagnóstico e acesso de comando Windows — incremento 1.0.2

`tools/windows/DIAG_AURORA_HML.cmd` separa instalação comercial de validação
técnica. Sem argumentos, executa somente a preparação local idempotente do perfil
`aurora-hml`, sem leitura cloud, IAM, Functions ou Eventarc. O objetivo do primeiro
ato é deixar o comando utilizável, não provar todo o ambiente. A coleta pesada
fica no pós-instalação, quando o operador chama `DIAG_AURORA_HML.cmd verify`.
O coletor localiza o SDK no PATH e nos destinos usuais do instalador Windows; não
modifica o PATH nem instala outro SDK. Python 3 é necessário. Ausência no PATH não
prova ausência da ferramenta; lista de credenciais vazia não representa uma conta
ativa.

O perfil de comando versionado é `aurora-hml`. O coletor sempre o seleciona
explicitamente; não depende do perfil global ativo. Na primeira preparação, o
executável grava somente a configuração local de projeto. A criação usa
`--no-activate`; configurações existentes para outro projeto bloqueiam a operação.
A verificação de conta e identidade exata do HML fica no `verify`, fora do ato
inicial do cliente. A credencial permanece no armazenamento nativo do gcloud.
Nenhuma chave, senha, refresh token, access token ou arquivo de credenciais integra
o GitHub.

`DIAG_AURORA_HML.cmd login` abre o fluxo oficial `gcloud auth login --brief`
diretamente nesse perfil. Prefere o Chrome instalado por variável `BROWSER` local
ao processo, sem alterar o navegador padrão do Windows. A conta salva no navegador
pode ser escolhida no fluxo oficial; não se copiam cookies ou arquivos do perfil.
Senha, MFA e verificação de identidade, quando exigidos, ficam com o titular.
A aprovação desse login autoriza credencial local, não IAM, API nova ou deploy.
Todo login também gera o contrato de atualização pós-login: versão atual do
client, ingestão on-time de documentos, atualização de pendências e refresh da
interface. Essa atualização pertence ao runtime do client; não transforma o
primeiro ato de instalação em gate redundante. O helper Python sem argumentos só
mostra o plano; o diagnóstico não abre login.

O SDK obtém e renova seus tokens usando a credencial autorizada. Não é necessário
exportar token manualmente, criar chave de service account ou cadastrar segredo
para esse acesso de comando. Políticas de sessão, revogação e reautenticação ainda
podem exigir novo login. O perfil seleciona configurações; não restringe os direitos
IAM da conta e não constitui uma barreira de segurança entre projetos.

Comandos no Windows, a partir do checkout ou diretório de diagnóstico preparado:

```bat
DIAG_AURORA_HML.cmd
```

Somente quando necessário renovar a identidade:

```bat
DIAG_AURORA_HML.cmd login
```

Validação técnica pós-instalação:

```bat
DIAG_AURORA_HML.cmd verify
```

Referências do provedor: [configurações nomeadas](https://docs.cloud.google.com/sdk/docs/configurations),
[criação sem ativação global](https://docs.cloud.google.com/sdk/gcloud/reference/config/configurations/create)
e [login oficial](https://docs.cloud.google.com/sdk/gcloud/reference/auth/login).

O alvo é fixo no HML autorizado. A coleta compara ID/número/estado do projeto
antes de consultar IAM, Functions Gen2 e Eventarc na região homologada. Reutiliza
o planejador existente sem chamar sua aplicação. Nenhum valor de segredo,
documento Firestore, principal IAM, política completa ou erro bruto sai no relatório.
A projeção IAM preserva `bindings` como lista de objetos; projetar campos internos
de uma lista pode transformar sua estrutura e invalidar o planejamento. Condição
IAM, acesso negado e metadados inválidos continuam desconhecidos.
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
Testes: `test_hml_gate_readonly.py` e `test_hml_cli_access.py` em `scripts/tests`.
Login no navegador, credencial configurada e acesso autenticado ao HML têm evidências
diferentes; o relatório só confirma autenticação após a leitura válida do projeto.
Rollback: reverter lançador/helpers/testes/CI e, se autorizado, remover apenas o
perfil local `aurora-hml`. Isso não revoga a credencial compartilhada do SDK; não
executar revogação geral nem apagar o armazenamento gcloud como rollback de código.

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
