# AURORA NEXUS — preflight HML por metadados

Incremento `hml-readonly-preflight.v1`, release train `1.0.0-rc.1`.
AURORA NEXUS é o sistema-mãe; WMGJ Operação é o piloto. Preparado em
02/10/2026 (America/Sao_Paulo) e reconciliado em 03/10/2026 sobre a main
`91665cc94c4bde9b82a75cd39905263c60e02191`. O SHA final da candidata depende do
CI pós-merge-forward. Não requer Mac.

## Uso e efeitos

Plano padrão, sem consultar cloud ou autenticar:

```sh
python3 firebase-migration/scripts/hml_readonly_preflight.py
```

Coleta com identidade de leitura já autorizada e gcloud disponível:

```sh
python3 firebase-migration/scripts/hml_readonly_preflight.py --collect
```

O alvo é fixo `wmgj-hml-jfn-20260927`. O programa não aceita outro projeto,
não troca configurações gcloud, não faz login e não cria permissões/recursos.
São oito consultas `list`/`describe`: projeto, billing do projeto, API de
secrets, metadados de duas versões de secrets, banco, agendas e backups.
Não lista contas de billing nem projetos vizinhos; não consulta documentos,
usuários ou memberships. O gcloud pode manter seus caches/logs locais normais;
`cloudMutation=false` descreve o escopo remoto, não promete zero I/O do SDK.

Não existe `secrets versions access` neste coletor. Verificar a versão ENABLED
não prova conteúdo válido, permissão efetiva do runtime ou login funcionando.
O preflight de deploy existente continua separado e ainda lê valores no seu
fluxo protegido; não acioná-lo como se fosse a coleta de metadados.

A saída tem somente códigos de evidência, estados e plano de ação. Não publica
stdout/stderr bruto, conta de billing, projectNumber, databaseUid, nomes de
backups, valores de secrets, identidade de usuário ou dados clínicos.

## Estados e aceite

- `COMPROVADO`: apenas o metadado nomeado pelo gate, no instante da consulta.
- `PENDENTE`: consulta válida mostrou divergência ou ausência concreta.
- `DESCONHECIDO`: acesso/CLI indisponível, timeout, erro ou metadado insuficiente.

Cada gate inclui evidência, risco, responsável sugerido, próxima ação, critério
de aceite e bloqueador. `releaseApproved` permanece false. Billing enabled não
comprova orçamento/alertas; metadata de backup não comprova restauração.

O plano retorna 0 apenas por ter sido renderizado. `--collect` retorna 2 porque
os gates amplos exigem evidência separada. Nenhum consumidor deve interpretar
exit code isolado como autorização. Orçamento, WIF/SA, acesso efetivo aos secrets,
usuários/memberships/MFA, ambiente protegido, Rules publicadas, App Check, restore,
DNS/TLS e smoke autenticado permanecem explícitos e desconhecidos neste coletor.
O relatório é instantâneo; repetir as leituras antes da proposta de liberação.

## Gate de backup compartilhado

Os workflows de deploy HML e RC1.1 passam os metadados já lidos para
`--check-backup` via stdin. Esse modo não chama gcloud, não lê secrets e emite
somente o resultado do gate. Retorna 0 exclusivamente quando um backup:

1. está READY e pertence ao banco default do HML autorizado;
2. tem o mesmo `databaseUid` do banco atual (recriar o mesmo nome não basta);
3. tem snapshot não futuro, com idade de até 24h, e expiração posterior a agora.

Falha, ausência ou metadado incompleto retornam 2 antes de deploy/restore. A
exceção antiga de bootstrap sem backup READY foi removida. A política de 24h já
existia no RC1.1; este patch a reutiliza e acrescenta expiração/identidade física.
Mesmo com retorno 0, `releaseApproved=false`; ensaio de restore continua separado.

## Validação e rollback

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s firebase-migration/scripts/tests -p test_hml_readonly_preflight.py -v
```

Fixtures sintéticas cobrem leituras fixas, ausência de shell/credenciais, erro
sem vazamento, timeout, projeto divergente, secret disabled, campos ausentes,
backup antigo/futuro/expirado, banco recriado e gates que não podem ser promovidos.
O CI de Firestore executa essa suíte. Testes não fazem chamadas cloud.

Rollback: reverter o commit candidato antes de integração; nenhuma mudança
cloud foi feita por esta preparação. Não dispensar o gate de recuperação para
contornar um erro de validação: revisar o metadado e a origem do bloqueio.

## Evidência operacional posterior e limite

O run protegido v6 `37092175109`, separado deste coletor, comprovou backup READY,
restore real em banco temporário e cleanup. Também publicou Hosting, Rules e
indexes da main. Em seguida falhou fechado com exit 77 porque o keyring HMAC não
estava em um dos formatos aceitos; não houve nova versão do secret, redeploy da
Function de ingestão nem amostra real. Isso não transforma o preflight read-only
em executor e não autoriza reexecução. A request v7 posterior já existe e gerou
o run `37093409122`, ainda sem aprovação. Como o commit de disparo também alterou
workflow e teste, o gate request-only deve falhar antes de mutação; ainda assim,
não aprovar nem reutilizar esse snapshot. Uma futura request v8 só pode nascer em
commit separado após hardening, merge, deploy pinado, inspeção read-only do par
exato e atestação humana independente. O RC v8 apenas consome keyring e ponte já
configurados; não altera Secret Manager, IAM, Function ou DRY_RUN global.

## Referências técnicas consultadas em 02/10/2026

- https://docs.cloud.google.com/sdk/gcloud/reference/secrets/versions/describe
- https://docs.cloud.google.com/sdk/gcloud/reference/billing/projects/describe
- https://docs.cloud.google.com/sdk/gcloud/reference/firestore/backups/list
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.locations.backups
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases
