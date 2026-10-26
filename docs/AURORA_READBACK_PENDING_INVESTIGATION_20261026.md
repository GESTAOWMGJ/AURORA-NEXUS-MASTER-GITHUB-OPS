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
