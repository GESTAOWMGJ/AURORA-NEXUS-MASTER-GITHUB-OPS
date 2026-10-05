# Recuperação de uma mensagem — M01/M08/M10

Estado do candidato: **implementado e testado com fixtures sintéticas; não implantado**.
PR #148 reconciliado com `main` `19937d96be37a570caa9e074a9c03d51543cdbc8`.
A conciliação preserva os perfis, instalação e IA Master acrescentados na main.
Não houve replay real, merge do PR, deploy nem alteração de gatilhos.

## Escopo implementado

`replayMensagemGmailWMGJ(messageId, options)` aceita um ID hexadecimal exato.
`dryRun` é `true` por padrão. A função usa `GmailApp.getMessageById`, sem query,
varredura de irmãos da thread, OCR, Gemini, parser, pipeline global ou lançamento financeiro.
Não altera mensagem, label, arquivo-fonte ou histórico de erros.

O diagnóstico somente leitura anterior, `diagnosticarMensagemGmailWMGJ`, permanece disponível.
Inventário de gatilhos mostra apenas os pertencentes ao executor; não demonstra ausência de
execuções de outras contas. Schema misto continua bloqueado: não reparar trocando cabeçalho.

## Preparação e dry-run

No projeto Apps Script canônico e sob identidade autorizada, exigir configurações existentes:
`WMGJ_SPREADSHEET_ID`, `WMGJ_FIRESTORE_ORG_ID`, `WMGJ_PASTA_ENTRADA_ID` (ou `PASTA_ENTRADA_ID`).
Ausência bloqueia; não há descoberta/criação automática de pasta ou tenant.
O índice deve respeitar as 25 colunas; a fila existente `15_FILA_PROCESSAMENTO`, as 10 colunas
V3/extração (aliases `NOME_ARQUIVO`/`MIME_TYPE` aceitos). Fila antiga de 7 colunas exige
reconciliação separada, com backup e preservação das fontes.

Primeiro gerar o dry-run. Ele não escreve propriedades, arquivo, índice ou fila e não reserva
IDs Drive. O manifesto vincula organização, planilha, pasta, projeto, identidade executora,
ID exato, nomes, tamanhos, MIME, SHA-256 completo e identidade legada por anexo.
O retorno contém `manifestHash`, recibos encontrados e destinos faltantes.

A reconciliação lê referências persistidas e inventaria a pasta configurada, verificando os
bytes por SHA-256. Um órfão íntegro é reutilizado mesmo sem metadados de replay. Ambiguidade,
arquivo referenciado ausente/alterado/lixeira, índice duplicado, fila conflitante ou leitura
negada bloqueiam antes das escritas. O inventário não prova ausência fora da pasta autorizada;
fontes movidas e sem qualquer referência precisam de conciliação humana anterior.

## Gate para uma execução futura, separada

Esta entrega **não configura nem executa** o gate abaixo. Após revisão do dry-run e autorização
operacional, um administrador do projeto pode registrar em Script Properties
`AURORA_GMAIL_REPLAY_AUTHORIZATION` com `messageId`, `manifestHash`, `actor`, `expiresAt` ISO e
`dataClassification` (`INTERNAL` ou `RESTRICTED`). Dado clínico sensível permanece bloqueado.
A propriedade não é um segredo nem substitui IAM, MFA e a revisão do administrador do projeto.
Não há endpoint público, scheduler ou habilitação automática pela inteligência.

A execução exige explicitamente `dryRun:false` e `expectedManifestHash` correspondente ao
manifesto revisado, autorização não expirada e a mesma identidade/escopo. O manifesto é
recalculado sob trava antes de qualquer mutação. Conteúdo ou destino alterado exige novo dry-run.
Manter backup restrito de índice/fila/propriedades e gates institucionais antes de dado real.

## Concorrência, idempotência e retomada

- V1/V2, importador Gmail legado, produtores da fila e watchdog compartilham a mesma instância
  de `ScriptLock`. Chamadas aninhadas não liberam a trava externa; flush precede liberação.
  Escritores externos/outros projetos não são protegidos por ScriptLock e devem ser suspensos
  durante a manutenção. O lock não é um bloqueio distribuído entre projetos.
- Antes de criar arquivos, a mensagem é reservada persistentemente. Os indexadores e o
  importador legado deixam essa mensagem para o replay, inclusive após interrupção.
  A reserva continua após conclusão, evitando nova cópia pelo importador legado.
- Checkpoint por anexo em Script Properties: chave escopada, SHA-256, tentativa, ator,
  manifesto, estágio, ID reservado, recibos e erro sanitizado. Usa armazenamento existente;
  não cria banco, projeto, planilha ou propriedade com conteúdo de anexos.
- Antes do upload, `files.generateIds` aloca um ID e o checkpoint persiste esse ID.
  Upload multipart grava bytes + ID + chave de replay + SHA-256 em uma única criação.
  Perda de resposta nunca aloca novo ID; uma resposta 409 exige releitura e hash correto.
- Índice usa a chave legada `messageId|nome|hashLegado`, preservando compatibilidade com V1/V2.
  Erro/parcial histórico permanece e recebe uma única linha terminal quando reparado.
- Fila é reconciliada por arquivo/versão; não reabre nem duplica item existente. Novo item
  recebe SHA-256 e chave na observação. Conteúdo idêntico com nomes distintos compartilha
  arquivo e fila, mantendo as duas identidades legadas no índice.
- Cada etapa é relida, confirmada e persistida. `COMPLETE` exige recibos de arquivo, índice
  e fila. Repetição em runtime novo reconcilia novamente e cria zero duplicatas.
  Recibo de fila comprova enfileiramento, não extração concluída nem receita reconhecida.

Limites do executor mínimo: 20 anexos, 5 MiB por anexo, 25 MiB por mensagem, 1.000 arquivos
na pasta por inventário e 10 tentativas por anexo. Limites, quota de propriedades, identidades
ambíguas ou anexos anteriormente ignorados bloqueiam para revisão, sem apagar checkpoints.
A mesma identidade legada repetida dentro da mensagem também exige revisão.

## Validação e integração ao motor

```sh
node --test tools/test-gmail-ingestion.cjs tools/test-gmail-replay.cjs
node tools/audit-appscript.js
cd firebase-migration/functions
node --import tsx --test test/aurora-native-routines.test.ts
npm run build
```

Fixtures sintéticas exercitam o adaptador Apps Script/Drive, multipart, reserva anterior ao
upload, falhas antes/depois de cada destino, perda de resposta, reinício de runtime, 409,
repetição, órfãos, hash alterado, isolamento de escopo, schema inválido, travas e recibos.
Isso não comprova execução/concorrência em Google Workspace real; ensaio HML continua pendente.

O registro nativo apresenta `WMGJ-LEGACY-GMAIL-SINGLE-REPLAY` como `LEGACY_MIRRORED`, com
`ingestionRecoveryPolicy.executorState=IMPLEMENTED_SYNTHETIC_TESTED_PENDING_RUNTIME_VALIDATION`.
Somente regra abstrata e regressões entram no motor; incidente real continua aberto até
conciliação comprovada e revisão humana. Não há promoção automática para NATIVE_ACTIVE.

## Rollback

Antes de qualquer execução real, remover/revogar somente a autorização de replay interrompe
novas execuções mutantes. Preservar reservas/checkpoints e fontes para retomar ou reconciliar.
Reverter código não desfaz documentos já escritos; versões antigas não respeitam as reservas,
portanto suspender os escritores antes de rollback. Não limpar todas as propriedades nem
retomar ingestão sobre schema misto. PR permanece draft para revisão e validação de runtime.

Referências técnicas oficiais: [IDs pré-gerados](https://developers.google.com/workspace/drive/api/guides/create-file),
[upload multipart](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[Lock](https://developers.google.com/apps-script/reference/lock/lock).
