# Investigação das 12 pendências do READBACK 40194120781

Identificação e classificação concluídas em diagnóstico somente leitura.
Correção candidata no PR #327; nenhuma recuperação real, ingestão ou implantação executada.
Baseline main: `3440cf6c8508804e6dbd723ebc75c3ef637355ee`.
Produto permanece 1.1.0-beta.2. Não há alteração de release, autorização ou gate operacional.

## Evidência e escopo

Artefato GitHub 12598449534, `aurora-drive-intake-40194120781`, recuperado.
ZIP SHA-256: `2f464afa44e7e7bb2fb5be9fb4f41b6e88234580c231374194bccb8003cbb413`.
Contém somente `aurora-drive-intake-summary.json` (2140 bytes).
Logs do job 121171196410 confirmam upload desse resumo e remoção das respostas
privadas do runner. O artefato comprova 255 registros: 51 canônicos, 192 aliases e
12 pendentes; não contém identidades individuais nem exceções originais do provedor.

A autorização direta do titular por 24 horas restringe-se ao diagnóstico somente
leitura no mesmo HML, sem ingestão. Foram consultadas as 12 linhas previamente
identificadas e metadados dessas fontes. Evidência privada preservada de 24/10 foi
confrontada com os IDs, versões, MIME, tamanho e pasta observados em 26/10.
Os dez PDFs não foram baixados novamente; igualdade de bytes refere-se à prova
histórica. Nenhum executor de ingestão foi acionado.

A relação individual, linhas, identidades e recibos está no relatório privado.
Nenhum identificador de fonte, conteúdo, hash documental privado ou credencial
é incluído neste repositório. O hash do escopo de aquisição do run e o marcador
histórico persistido na fila representam contratos distintos: não são
intercambiáveis. O vínculo foi conferido individualmente, não pela coincidência
de contagens ou desses hashes.

## Resultado por categoria

| Categoria | Qtd. | Causa e evidência | Recuperabilidade e residual |
|---|---:|---|---|
| PDF criptografado | 10 | Dez identidades de um conteúdo historicamente idêntico, protegido por senha; fila com CONVERSION_FAILED e ERRO_REPROCESSAR | Manifesto estrutural reconhecido offline pelo leitor existente. Conteúdo exige senha legítima ou versão acessível. Nenhuma recuperação real comprovada |
| Planilha mestre | 1 | SOURCE_MANIFESTED_REVIEW_PENDING e recibo registrados na fila; lastCode vazio produz NOT_RECORDED | Revisão humana de fatos/conteúdo. A planilha mudou depois da versão manifestada; o manifesto não cobre automaticamente essas alterações |
| Pacote ZIP de reembolso | 1 | SOURCE_MANIFESTED_REVIEW_PENDING e recibo registrados; lastCode vazio produz NOT_RECORDED. Cópia histórica íntegra, com 7 membros | Revisão humana do conteúdo dos membros e da correspondência documental; manifesto não aprova fatos financeiros |

As tentativas persistidas somam 99: 86 nos PDFs, 7 na planilha e 6 no ZIP.
São contagens observadas na fila; não são novas tentativas desta investigação.

O bloqueio criptográfico dos PDFs é comprovado. A exceção exata das conversões
históricas não foi preservada e não foi reconstruída. Não há evidência para atribuir
esses dez casos a indisponibilidade transitória, corrupção ou ao problema de versão
publicada já corrigido pelo PR #324. O nome do PDF não comprova o conteúdo financeiro.

As duas ocorrências NOT_RECORDED são distintas das dez falhas: o código representa
ausência de lastCode, não inexistência de arquivo, tentativa ou recibo.
Os recibos e replayVerified foram observados na fila. A correspondência direta com
documentos canônicos e versões imutáveis do Firestore não foi revalidada neste
diagnóstico. A planilha também hospeda a fila; essa dependência deve ser considerada
antes de eventual reprocessamento.

## Contratos de extração e correções mínimas

- PDF criptografado: o leitor atual reconhece assinatura PDF, /Encrypt, startxref e
  EOF e gera manifesto estrutural. Não descriptografa nem aprova conteúdo.
- Google Sheets: leitura nativa, com manifesto criptográfico quando os limites
  textuais são atingidos. Não usa conversão de PDF nesse caminho.
- ZIP: manifesto limitado dos membros, com erros próprios de abertura e expansão.
  Não implica extração/aprovação dos documentos internos.
- Manifestos mantêm SOURCE_MANIFESTED_REVIEW_PENDING; não equivalem a extração
  integral, decisão financeira ou sincronização completa.

Defeitos reproduzidos e corrigidos na candidata:

1. Nove PDFs eram classificados como OTHER porque linhas antigas guardam o MIME em
   TIPO, com MIME_TYPE vazio. O diagnóstico passa a consultar TIPO somente quando
   MIME_TYPE estiver ausente. MIME explícito prevalece; desconhecido continua OTHER.
   Não há inferência pelo nome, leitura adicional ou alteração da linha.
2. Mensagens explícitas de indisponibilidade passam a conservar o código fixo
   AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE. Auth/quota mantêm precedência.
   Essa correção não é atribuída como causa dos dez erros históricos.
3. O sanitizador Node preserva os três códigos ZIP já emitidos pelo extrator:
   AURORA_ZIP_EXTRACTION_FAILED, AURORA_ZIP_ENTRY_LIMIT e
   AURORA_ZIP_UNCOMPRESSED_SIZE_LIMIT.
4. O resumo acrescenta byCodeMediaStatus com contagens conjuntas de enums
   sanitizados, sem publicar nomes, IDs, URLs ou mensagens livres.

Não foram adicionados retry, parser alternativo, remoção de duplicatas na origem,
mutação de fila ou encerramento automático.

## Validação

100 testes determinísticos aprovados nas suítes test-drive-full-ingest.js,
test-drive-activation.js e test-aurora-drive-ingest-run.cjs.
Auditoria Apps Script aprovada, sem erros; aviso conhecido sobre fontes legadas
fora de src/. Testes cobrem isolamento, escopo, recibos, replay idempotente,
preservação dos originais, limpeza de temporários e sanitização.

Teste offline da cópia privada preservada reconheceu pdf_encrypted_manifest,
conservou o hash original e realizou zero chamadas ao provedor e zero escritas
canônicas. O documento real não integra as fixtures públicas.

CI aprovado no código do commit `3c6b59919b061aab6e08c15607b9979ef21430b1`:

- Validate Gmail Ingestion Contract: run 40267199482, success.
- Security - CodeQL: run 40267199481, success.
- Validate Aurora Onboarding: run 40267199623, success.

Código testado com árvore `a1cf83dccbf317a4886546d848c5def1257d5cd1`;
a consolidação posterior deste relatório altera apenas documentação.
Testes locais e CI não comprovam deploy ou recuperação documental.

## Encaminhamento e fechamento

Diagnóstico: concluído. Recuperações reais: zero. Escritas em fonte/fila/canônico:
zero. As 12 pendências operacionais permanecem abertas.

- PDFs: operador autorizado pode futuramente registrar manifesto estrutural sob
  autorização de processamento válida e verificar recibos/idempotência.
  Extração do conteúdo depende da senha legítima ou de fonte acessível fornecida
  pelo responsável documental; a autorização atual não permite replay.
- Planilha e ZIP: revisor humano deve confrontar conteúdo, versão e evidência
  canônica antes de decidir. Recibo de manifesto não substitui essa revisão.

Correções disponíveis em branch/PR, sem merge/deploy. A integração na main aciona
o workflow de publicação Apps Script; ela não foi realizada sob a autorização
restrita a diagnóstico. Rollback de código: reverter os commits candidatos;
não existe mutação documental desta sessão a reverter.

`fullSynchronizationVerified=false`. A investigação encerra a lacuna de
identificação, preservando as pendências de conteúdo e revisão.
