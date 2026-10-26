# Investigação das pendências do READBACK 40194120781

Estado: investigação parcial, correção candidata; nenhuma recuperação real executada.
Baseline: main `3440cf6c8508804e6dbd723ebc75c3ef637355ee`.
Produto permanece 1.1.0-beta.2. Nenhuma alteração de release ativa, deploy ou autorização.

## Evidência recuperada

Artefato GitHub 12598449534, `aurora-drive-intake-40194120781`.
ZIP SHA-256 verificado: `2f464afa44e7e7bb2fb5be9fb4f41b6e88234580c231374194bccb8003cbb413`.
Contém somente `aurora-drive-intake-summary.json` (2140 bytes).
Logs do job 121171196410 confirmam upload de apenas esse resumo e remoção de
`RUNNER_TEMP/aurora-drive-private` no encerramento. O resumo não contém linhas
individuais, MIME exato, etapa, IDs ou mensagens do provedor. A recuperação do
artefato foi confirmada pelo conector e a cópia local tem o digest publicado.

Comprovados: 255 registros, 51 canônicos, 192 aliases, 12 pendentes, 99 tentativas
registradas no conjunto pendente. Não é possível distribuir essas 99 tentativas
por item. `unknownSourceVersion=0` e `unknownAttempts=0` não revelam os valores
individuais. Recibos válidos não comprovam extração dos pendentes.

## Classificação sustentada

| Categoria | Quantidade | Causa comprovada | Recuperação |
|---|---:|---|---|
| AURORA_DRIVE_CONVERSION_FAILED / ERRO_REPROCESSAR | 10 | Falha genérica registrada; causa técnica específica não preservada no artefato | Nenhum item demonstrado recuperável automaticamente; requer diagnóstico individual antes de replay autorizado |
| NOT_RECORDED / REVISAR_HUMANO | 2 | Ausência de lastCode no escopo persistido, conforme auroraDrivePendingDiagnostic_; não prova ausência de tentativa, arquivo ou conteúdo | Revisão humana obrigatória; identidade documental não disponível no artefato |

Mídias do conjunto de 12: OTHER=9, GOOGLE_SHEETS=1, ZIP=1, PDF=1.
São marginais independentes: não se pode atribuir, por exemplo, o PDF aos dez erros
ou o ZIP aos dois casos humanos. OTHER não é tipo documental nem prova corrupção.
Não inferir nota fiscal, contrato, extrato ou qualquer semântica pelo agregado.

## Confronto com contratos atuais

- Google Sheets: leitura nativa; limite textual pode produzir manifesto criptográfico.
  Não usa conversão nesse caminho. Um erro genérico antigo não prova falha atual desse leitor.
- ZIP: manifesto limitado de membros; não extrai nem aprova fatos internos. Falhas
  de abertura, número de entradas e expansão possuem códigos próprios.
- PDF/imagens/Word: conversão/OCR temporária; identidade e MIME convertidos validados;
  cópia temporária removida, original preservado. PDF criptografado pode gerar
  manifesto estrutural, que exige credencial legítima/revisão para conteúdo.
- Excel: conversão temporária para Sheets, seguida de leitura.
- Texto UTF-8: leitura direta; bytes inválidos usam recuperação governada pelo provedor.
- Octet-stream: somente OFX com extensão, assinatura e encoding aceitos.
- Manifesto é SOURCE_MANIFESTED_REVIEW_PENDING, não extração textual integral,
  aprovação financeira ou sincronização completa.

## Defeitos reproduzidos e correções mínimas

1. Indisponibilidade explícita do serviço era reduzida a CONVERSION_FAILED ou
   CONVERSION_NOT_READY. O classificador agora preserva código fixo
   AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE para mensagens reconhecidas.
   Nenhuma mensagem livre é publicada. Auth/quota mantêm precedência.
2. Três códigos ZIP emitidos pelo extrator e aceitos no plano eram descartados
   pelo sanitizador Node como UNKNOWN. A allowlist foi alinhada ao contrato existente.
3. O resumo perdia o vínculo código/mídia/status ao agregar. Campo aditivo
   byCodeMediaStatus conserva contagens conjuntas usando exclusivamente enums
   sanitizados, sem IDs, nomes, hashes privados, URLs ou mensagens livres.

Esses defeitos de diagnóstico são reproduzíveis por fixtures. Não há evidência
para atribuí-los aos dez erros históricos. As mudanças não implementam retry,
novo parser, nova leitura, escrita na fila ou encerramento automático.

## Validação e invariantes

99 testes determinísticos aprovados nas suítes test-drive-full-ingest.js,
test-drive-activation.js e test-aurora-drive-ingest-run.cjs; auditoria Apps Script aprovada.
Incluem isolamento, rejeição de escopo, recibos/replay, preservação dos originais,
limpeza somente de temporários, códigos ZIP e ausência de dados privados no resumo.
Repetição da agregação sintética produz resultado idêntico, sem efeitos externos.
CI, deploy, recuperação real e HML da candidata: não comprovados neste registro.

## Próximo passo e residual

Responsável: operador autorizado do tenant; decisão documental: revisor humano.
Obter primeiro evidência privada já preservada, se existir: vínculo org/source/file,
versão, MIME exato, hash original, tentativa, etapa e código fixo por pendência.
Não procurar novas fontes para suprir essa lacuna sem autorização.
Se inexistente, renovar autorização específica para diagnóstico somente leitura
no mesmo escopo, com prazo e limites; não executar workflow de ingestão para coletá-lo.

Após diagnóstico: indisponibilidade/quota transitória pode ser candidata a nova
 tentativa limitada; formato inválido, criptografia, permissão e decisão de conteúdo
exigem tratamento/evidência próprios. A elegibilidade depende da causa observada,
nunca só do status ERRO_REPROCESSAR. Os dois NOT_RECORDED permanecem humanos.

Replay real exige autorização renovada, versão/hash conferidos, mesmo tenant,
mesma chave idempotente e recibos canônico/imutável verificados. Só então medir
quantos foram recuperados. Nesta investigação: zero recuperações reais comprovadas,
12 pendências mantidas; fullSynchronizationVerified=false.

Rollback: reverter o commit candidato; nenhum dado ou fonte precisa ser revertido.
A falha de versão publicada corrigida no PR #324 é independente destes achados.

## Adendo R2 — identificação por diagnóstico somente leitura

O titular renovou expressamente a autorização por 24 horas, restrita ao mesmo
escopo HML e sem ingestão. Nenhuma autorização de processamento/deploy foi inferida.
Foram lidas somente as 12 linhas previamente identificadas e seus metadados Drive,
sem acionar o executor Apps Script, escrever fila ou repetir ingestão.

A lacuna do artefato foi suprida por evidência privada preservada de 24/10 e pela
consulta atual ao conector autorizado. Este adendo supera as limitações de
identificação da primeira análise, mas não transforma o artefato agregado em prova
individual retroativa. Identificadores, nomes e recibos completos permanecem fora
do repositório. O escopo de aquisição do run e o marcador histórico persistido na
fila têm hashes distintos; não são tratados como campos intercambiáveis. O vínculo
individual foi conferido por fileId, sourceId, versão e metadados, não pela igualdade
desses dois hashes nem pela coincidência das contagens.

| Categoria atual | Qtd. | Evidência/correção | Recuperabilidade |
|---|---:|---|---|
| PDF criptografado, cópias idênticas | 10 | Bytes históricos: um conteúdo único, senha exigida; MIME/ID/versão/tamanho/pasta atuais correspondem aos preservados | Manifesto estrutural candidato a processamento futuro; conteúdo exige credencial legítima ou versão acessível |
| Planilha mestre | 1 | SOURCE_MANIFESTED_REVIEW_PENDING, recibo e replayVerified registrados na fila; lastCode vazio gera NOT_RECORDED | Cobertura por manifesto já registrada; revisão de fatos/conteúdo obrigatória |
| Pacote ZIP de reembolso | 1 | SOURCE_MANIFESTED_REVIEW_PENDING, recibo registrado; lastCode vazio gera NOT_RECORDED; arquivo histórico íntegro com 7 membros | Manifesto já registrado; conteúdo dos membros e correspondência canônica exigem revisão |

Os dez PDFs são um único conteúdo criptografado em dez identidades de origem.
Metadados atuais correspondem aos históricos; os bytes das dez fontes não foram
baixados novamente. A igualdade de bytes está comprovada na evidência histórica,
não por uma nova comparação byte a byte. Não há prova de corrupção ou falha
transitória do serviço como causa desses dez casos. O erro genérico persistido
oculta o bloqueio de conteúdo cifrado; não se pode reconstruir a exceção exata
original do provedor. Nenhum PDF foi desbloqueado nem removido/deduplicado na origem.

As duas ocorrências NOT_RECORDED não representam falha de conversão: são manifestos
aguardando revisão. Recibos foram observados na fila, sem nova verificação direta
do documento canônico e versão imutável no Firestore neste diagnóstico. A planilha
é mutável e seu modifiedTime atual é posterior à versão do manifesto; portanto o
manifesto não comprova cobertura das alterações subsequentes. A própria fila reside
nessa planilha, exigindo cuidado adicional com essa dependência antes de reprocessar.

### Correção adicional reproduzida

Nove linhas antigas guardam `application/pdf` em TIPO, com MIME_TYPE vazio. O leitor
de diagnóstico usava somente MIME_TYPE, publicando OTHER. A candidata consulta TIPO
apenas quando MIME_TYPE está ausente. Continua aceitando exclusivamente os MIME
conhecidos, sem inferir formato pelo nome, ler fontes adicionais ou alterar a fila.
MIME_TYPE explícito tem precedência; valor desconhecido permanece OTHER.

100 testes determinísticos aprovados nas três suítes; auditoria Apps Script aprovada.
Teste offline da cópia privada de PDF preservada confirmou que o leitor atual gera
pdf_encrypted_manifest, com hash original inalterado, zero chamadas ao provedor e
zero escritas canônicas. O arquivo real não foi incorporado às fixtures públicas.
Esse teste prova capacidade local de manifesto, não recuperação real dos dez itens.

### Resultado e próximo gate

Identificação e classificação das 12 pendências: concluídas com os limites acima.
Recuperações reais nesta sessão: zero. Escritas em fonte/fila/canônico: zero.
Não existe autorização de replay neste adendo. Os dez PDFs podem seguir apenas para
manifestação estrutural em execução futura autorizada e comprovada; extrair conteúdo
exige senha legítima ou versão acessível. Os dois manifestos continuam em revisão
humana. `fullSynchronizationVerified=false` permanece.
