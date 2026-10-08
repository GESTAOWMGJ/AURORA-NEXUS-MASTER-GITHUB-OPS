# Instalação canônica retomável — componente 1.0.1

Baseline: `68ee776b5ce24520f8412448774efa468ab1ca35`. Produto permanece na
linhagem atual; versão deste componente não altera a versão registral.

Os instaladores Python do coletor e do cliente Windows incluem o transporte
aprovado e `aurora_deployment.py` em `integration/1.0.1`, com manifesto SHA-256.
O patch de retomada deriva da main `d5f502eaeb89d66c50024ecb4240ed021e76b676`;
o componente anterior e o schema de checkpoint v1 permanecem compatíveis.
O checkpoint fica em `integration/state/integration-setup.json`. Não há banco,
serviço, scheduler, varredura de documentos, alteração de IAM ou segredo novo.
O builder de executáveis Go e o aplicativo Mac original ainda não incorporam
este fluxo. Não apresentar esta implementação Python como instalador comercial
assinado ou atualização binária completa.

Para preparar somente o componente numa instalação existente:

```text
python desktop/install_windows_beta.py prepare-integration --target CAMINHO_ABSOLUTO_DA_INSTALACAO
```

Após a preparação, usar o módulo instalado e os caminhos absolutos da amostra
estruturada autorizada e do diretório de estado:

```text
python CAMINHO/aurora_deployment.py --input AMOSTRA_JSON --origin https://ORIGEM_AUTORIZADA --org ORGANIZACAO --state-dir ESTADO
```

Sem opção adicional, a execução valida localmente, sem rede. `--connect` faz
somente ping autenticado. `--send` envia a amostra explicitamente autorizada.
As opções são exclusivas. Ambas usam `AURORA_INTEGRATION_TOKEN` somente do
ambiente do processo; a chave é provisionada no fluxo administrativo existente,
com MFA e escopos `integration.read` e `documents.ingest`. Não passar segredo
em argumento, arquivo de amostra, checkpoint, comentário ou log.

## Retomada e evidência

- Cada tentativa revalida entrada, organização, destino e credencial corrente.
- Um erro retorna código sanitizado e próxima ação para credencial, rota,
  transporte ou recibo. O instalador não tenta corrigir IAM sozinho.
- Timeout sem recibo preserva a chave idempotente; após retomada, recibo remoto
  `DUPLICATE` confirma que o servidor já havia aceitado a operação.
- `--send` sempre revalida o tenant por ping e repete o POST do mesmo payload
  normalizado e chave, inclusive com recibo cached. Isso permite ao pipeline
  existente retomar uma projeção pendente sem duplicar a ingestão.
- `--connect` continua somente ping. `PREVIOUS_RECEIPT_CACHED` e proof histórico
  não comprovam processamento atual; `receiptVerifiedThisRun` e
  `processingVerifiedThisRun` permanecem false nessa execução.
- `SAMPLE_RECEIPT_VERIFIED` comprova o recibo atual. A conclusão da primeira
  operação exige proof do POST para o mesmo documento, sistema, sourceVersion,
  hash canônico e versão imutável/revision; o ping não fornece essa prova.
  Proof válido com `operationalComplete=false` confirma a primeira ingestão e
  preserva recibo/campos de versão; exige `COMPLETE_AUTHENTICATED_SETUP` no fluxo
  autenticado existente. Só `operationalComplete=true` libera a próxima ação de
  verificar continuidade, sem declarar sincronização completa. Resposta antiga
  ou projeção pendente mantém processamento pendente. Proof divergente bloqueia
  e preserva o recibo anterior. `fullSynchronizationVerified`
  e `productionReleased` permanecem false mesmo com primeira ingestão confirmada.
- Mudança de destino/amostra, arquivo adulterado, schema incompatível, link ou
  lock concorrente bloqueia e preserva o estado. Lock após encerramento abrupto
  requer verificar ausência de processo em andamento e revisão local; não é
  removido automaticamente por tempo decorrido.
- Diretório privado POSIX é exigido; no Windows usar a instalação por usuário
  com ACLs herdadas do perfil. Este componente não altera ACLs nem políticas.

## Rollback e limites

O preparo é idempotente quando hashes coincidem. Conteúdo diferente na mesma
versão é conflito: não sobrescrever. A versão 1.0.1 preserva `integration/1.0.0`
e guarda a prova de processamento separada do recibo v1, permitindo retornar ao
componente anterior sem alterar a identidade da amostra. Suspender invocações ou
selecionar o componente anterior preserva checkpoint e fontes; não remove dados
do gateway. O rollback não confirma processamento pendente.

O Release Cockpit e o registro nativo apresentam a capacidade como implementada,
aguardando validação real. Testes cobrem Linux/Windows no CI; execução nesta
estação, instalação física, autenticação, reconciliação e deploy exigem evidência
própria. Não há espelhamento SQLite nem captura automática de dados reais.
