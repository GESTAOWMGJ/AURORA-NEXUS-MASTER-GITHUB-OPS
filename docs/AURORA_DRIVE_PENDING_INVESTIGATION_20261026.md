# Investigação das pendências do READBACK 40194120781

26/10/2026. Produto 1.1.0-beta.2, sem promoção de release.
Baseline: `3440cf6c8508804e6dbd723ebc75c3ef637355ee` (main, PR #326).
Estado: candidato testado localmente; sem deploy, ingestão ou novo READBACK real.

## Evidência e limites

Artefato GitHub Actions `12598449534`, execução `40194120781`, recuperado pela API.
ZIP SHA-256: `2f464afa44e7e7bb2fb5be9fb4f41b6e88234580c231374194bccb8003cbb413`.
Contém somente `aurora-drive-intake-summary.json` (2140 bytes).
Runtime observado: Apps Script v46, fonte `602528812bffc443a48a4d52fc115c6ab2af6081`.
Resumo: 255 registros, 51 canônicos, 192 aliases, 12 pendências; 51 readbacks canônicos,
recibos conferidos, `sourceMutation=false`, `fullSynchronizationVerified=false`.

O resumo conserva distribuições marginais, sem IDs, nomes, MIME original, exceção do
provedor ou associação entre código, estado e mídia. Planos privados não integram o
artefato público. Não é possível identificar individualmente os 12 arquivos, reconstruir
as causas das dez conversões nem ligar as duas ocorrências sem código aos tipos.
As 99 tentativas são uma soma; não provam falha transitória nem tentativas por documento.

| Categoria | Quantidade | Diagnóstico sustentado | Pendência |
|---|---:|---|---|
| `AURORA_DRIVE_CONVERSION_FAILED` | 10 | Código genérico, causa específica não preservada | Diagnóstico privado por registro e etapa; não inferir indisponibilidade, senha ou corrupção |
| `NOT_RECORDED` | 2 | `scope.lastCode` ausente, não significa sucesso | Identificar as duas linhas no tenant, reconciliar estado/versão/recibo e obter decisão humana |
| `ERRO_REPROCESSAR` | 10 | Estado de candidatura à retomada governada | Não equivale a autorização ou recuperabilidade comprovada |
| `REVISAR_HUMANO` | 2 | Duas pendências no estado de revisão | Associação com os dois `NOT_RECORDED` vem do relato; o ZIP isolado não preserva o cruzamento |

Não somar códigos e estados: são distribuições dos mesmos 12 registros.

| Classe de mídia | Quantidade | Contrato atual e condição de recuperação |
|---|---:|---|
| `OTHER` | 9 | Classe residual da lista MIME; não equivale a formato não suportado. Pode incluir OFX octet-stream. Exige MIME/diagnóstico individual; não presumir Office ou imagens |
| `GOOGLE_SHEETS` | 1 | Leitura direta com limites; manifesto criptográfico quando excede texto. Conteúdo e fatos permanecem sob revisão |
| `ZIP` | 1 | Manifesto dos membros com limites de quantidade/tamanho; conteúdo interno não é automaticamente extraído ou aprovado |
| `PDF` | 1 | OCR/conversão ou manifesto estrutural de PDF criptografado; texto não garantido, credencial legítima e revisão quando protegido |

Sheets nativo e ZIP não usam a conversão Office/OCR no caminho normal atual. Isso exige
conferir cruzamento, etapa e versão histórica; não prova que sejam os dois `NOT_RECORDED`.
O PR #324 corrigiu o gate de publicação, consta na baseline e o resumo confirma igualdade
dos 30 módulos publicados. Esse problema resolvido não explica as pendências documentais.

## Correções mínimas e causas reproduzidas

1. **Perda de diagnóstico:** o coordenador agregava código/estado/mídia separadamente e
   convertia três códigos ZIP válidos em `UNKNOWN`. Preserva agora os códigos e acrescenta
   `byCodeStatusMediaType`, apenas com labels fechados, sem identificadores ou mensagens.
   Extensão aditiva do resumo v1; não reconstrói dados históricos descartados.
2. **Indisponibilidade explícita classificada genericamente:** mensagens de serviço/backend
   indisponível viravam `CONVERSION_FAILED` ou `CONVERSION_NOT_READY`. Agora recebem
   `AURORA_DRIVE_EXTRACTION_SERVICE_UNAVAILABLE`; autorização/quota conservam prioridade,
   mensagens opacas conservam fallback. Sem retry novo. Não demonstra a causa dos dez casos.
3. **Identidade original sem proteção na conversão Excel:** resposta sintética com ID igual
   ao original podia levar à leitura e tentativa de envio do original à lixeira. Agora exige
   ID válido e distinto antes de registrar a cópia; limpeza também exige essa diferença.
   MIME incorreto limpa somente cópia distinta validada. Nenhum dano real foi observado.

Escopo organizacional, hashes, chaves idempotentes, recibos, revisão financeira, gates,
autorização e schedulers permanecem iguais. Testes existentes cobrem isolamento, replay,
fontes e ausência de efeitos em READBACK.

## Validação

- Novos testes contra os dois módulos da baseline: falha, exit 1.
- Candidato: 79 testes aprovados com `node --test tools/test-drive-full-ingest.js tools/test-aurora-drive-ingest-run.cjs`.
- `node tools/audit-appscript.js`: aprovado, apenas avisos preexistentes de fontes legadas fora de src.
- CI: consultar checks do SHA candidato no PR; testes locais não comprovam CI/runtime.
- Release Cockpit: nenhum gate promovido. Sincronização completa não comprovada.
- Rollback: reverter patch; não alterar fila, recibos ou originais. Não houve deploy a reverter.

## Recuperação e próximos gates

**Recuperados: zero. Recuperáveis automaticamente comprovados: zero.** Trata-se de falta
de evidência, não impossibilidade de recuperação. Dez ocorrências continuam em triagem técnica.
Somente falha transitória comprovada ou formato suportado, com versão/hash, vínculo organizacional
e autorização válidos, pode seguir para retomada limitada no processador existente.
Conversão bem-sucedida ainda requer revisão documental e não promove fatos financeiros.

As duas ocorrências sem código exigem identificação privada e revisão humana da linha,
versão, estado e eventual recibo antes de reprocessar/reconciliar. Não alterar para PENDENTE,
fabricar causa ou publicar IDs no PR.

Responsável pela decisão documental/renovação: gestor autorizado do tenant. Responsável
pela reprodução técnica: manutenção do extrator. Próxima evidência: exportação privada já
existente por registro, ou inspeção expressamente autorizada. Campos mínimos: org/escopo,
fileId privado, sourceVersion, MIME, estado, tentativas, código fixo, etapa e recibo existente.
Sanitizar mensagem do provedor antes de compartilhar. Não transportar dados entre tenants.

A autorização informada terminou em 26/10/2026 às 00h de Brasília. Nenhuma operação real foi
disparada. Nova inspeção/extração/processamento requer autorização renovada e gates existentes.
Após eventual recuperação, comprovar recibos, versões imutáveis, replay e contagens;
fila vazia e CI verde não bastam para declarar sincronização integral.
